import { useCallback, useEffect, useRef, useState } from 'react';
import type { SyncStatus, SyncStreamInfo } from '../components/SyncOverlay';
import {
  getSyncOffsetThreshold,
  getSyncDoneDelayMs,
  getSyncKeepLocked,
  getSyncReferenceMode,
} from '../../services/syncSettings';

/**
 * Multi-stage sync engine for VOD/live multiview.
 *
 * Reference selection (priority order):
 *   1. The entry flagged `isMainFeed` (the race / world feed) — always wins when present, even
 *      when it's behind the others. Rationale: onboards/data should follow the race; if the
 *      race rebuffers we want everyone to wait for it, not the inverse.
 *   2. User preference from settings: 'first' (legacy) or 'latest' (most-ahead).
 *
 * Continuous mode:
 *   When `keepLocked` is true (the default) the engine never goes idle — after the initial
 *   convergence it keeps watching every WATCH_MS and re-corrects drift. This is what the user
 *   actually wants: sync once, stay synced.
 *
 * Buffering protection:
 *   When the reference video stalls (paused without user action, or readyState < HAVE_FUTURE_DATA)
 *   the engine pauses the other streams instead of seeking them backwards. As soon as the
 *   reference recovers, the auto-paused streams resume. This avoids the "everyone re-buffers
 *   every time the world feed hiccups" failure mode of pure offset-driven sync.
 *
 * Per-stream correction:
 *   - |Δ| ≥ COARSE_SEEK_THRESHOLD (0.5s) → seek to the reference time.
 *   - threshold ≤ |Δ| < 0.5s → playbackRate nudge (1.05× behind / 0.95× ahead) until inside.
 *   - |Δ| < threshold → done (rate snaps to 1.0×).
 */

export interface SyncEntry {
  id: string;
  label: string;
  getVideo: () => HTMLVideoElement | null;
  /** True for the race / world feed. The engine always picks this entry as reference. */
  isMainFeed?: boolean;
}

const TICK_MS = 150;
const MAX_CONVERGE_MS = 6000;
const WATCH_MS = 1000;
const COARSE_SEEK_THRESHOLD = 0.5;
const RATE_FAST = 1.05;
const RATE_SLOW = 0.95;
const SEEK_STAGGER_MS = 60;
/** HTMLMediaElement.readyState constant (avoids relying on the named constant in strict TS). */
const HAVE_FUTURE_DATA = 3;

type RuntimeEntry = SyncEntry & { video: HTMLVideoElement };

function clampRate(r: number): number {
  if (!Number.isFinite(r) || r <= 0) return 1;
  return Math.max(0.5, Math.min(2, r));
}

/** Live DASH/HLS often reports a non-finite or very large duration in the video element. */
function isLikelyLiveVideo(video: HTMLVideoElement): boolean {
  const d = video.duration;
  if (!Number.isFinite(d)) return true;
  return d > 60 * 60 * 24;
}

export function useSyncEngine() {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [syncStreams, setSyncStreams] = useState<SyncStreamInfo[]>([]);
  const [showSyncOverlay, setShowSyncOverlay] = useState(false);
  /**
   * True while either the convergence ticker or the drift-watch interval is active. Consumers
   * use this to decide whether to render the "minimized" floating badge (engine running but
   * overlay hidden).
   */
  const [isEngineActive, setIsEngineActive] = useState(false);

  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const convergeDeadlineRef = useRef<number>(0);
  const entriesRef = useRef<RuntimeEntry[]>([]);
  const refIdRef = useRef<string>('');
  const thresholdRef = useRef<number>(0.05);
  const keepLockedRef = useRef<boolean>(true);
  /** Streams that the engine paused itself (so we resume only those, not user-paused ones). */
  const enginePausedRef = useRef<Set<string>>(new Set());
  /** True after the reference has played at least once — prevents pre-autoplay false buffers. */
  const refHasStartedRef = useRef<boolean>(false);

  const stopTimers = useCallback(() => {
    if (tickTimerRef.current != null) {
      clearInterval(tickTimerRef.current);
      tickTimerRef.current = null;
    }
    if (watchTimerRef.current != null) {
      clearInterval(watchTimerRef.current);
      watchTimerRef.current = null;
    }
    setIsEngineActive(false);
  }, []);

  const resetRates = useCallback(() => {
    for (const e of entriesRef.current) {
      try {
        if (Math.abs(e.video.playbackRate - 1) > 0.001) e.video.playbackRate = 1;
      } catch (_) {}
    }
  }, []);

  const resumeEnginePausedStreams = useCallback(() => {
    for (const e of entriesRef.current) {
      if (enginePausedRef.current.has(e.id) && e.video.paused) {
        e.video.play().catch(() => {});
      }
    }
    enginePausedRef.current.clear();
  }, []);

  const cancelSync = useCallback(() => {
    stopTimers();
    resetRates();
    resumeEnginePausedStreams();
  }, [stopTimers, resetRates, resumeEnginePausedStreams]);

  /**
   * One sync tick: read all videos, build the SyncStreamInfo[] for the overlay, and apply
   * corrections (seek / rate-nudge / pause-when-ref-buffering).
   */
  const computeAndCorrect = useCallback(
    (canSeek: boolean): { infos: SyncStreamInfo[]; allDone: boolean } => {
      const entries = entriesRef.current;
      const refEntry = entries.find((e) => e.id === refIdRef.current) ?? entries[0];
      if (!refEntry) return { infos: [], allDone: true };
      const refVideo = refEntry.video;
      const refTime = refVideo.currentTime;
      const threshold = thresholdRef.current;
      const refIsLive = isLikelyLiveVideo(refVideo);

      // Update "ref has started" once — used to filter false buffers during initial autoplay.
      if (!refHasStartedRef.current) {
        if (refVideo.played?.length > 0 || refTime > 0.1 || (!refVideo.paused && refVideo.readyState >= HAVE_FUTURE_DATA)) {
          refHasStartedRef.current = true;
        }
      }

      const refIsBuffering =
        refHasStartedRef.current &&
        (refVideo.paused || refVideo.readyState < HAVE_FUTURE_DATA);

      let allDone = true;

      const infos: SyncStreamInfo[] = entries.map((e) => {
        const isReference = e.id === refEntry.id;
        const v = e.video;
        const offset = v.currentTime - refTime;
        const absOffset = Math.abs(offset);
        let rate = v.playbackRate || 1;

        if (isReference) {
          if (Math.abs(rate - 1) > 0.001) v.playbackRate = 1;
          return { id: e.id, label: e.label, offset: 0, rate: 1, isReference: true, done: true };
        }

        if (refIsBuffering) {
          // Hold the line: stop everyone else so we don't accumulate drift while the reference
          // catches up. Don't try to seek/rate-correct during this window — it only causes more
          // buffering noise.
          if (Math.abs(rate - 1) > 0.001) v.playbackRate = 1;
          if (!v.paused) {
            try { v.pause(); } catch (_) {}
            enginePausedRef.current.add(e.id);
          }
          allDone = false;
          return {
            id: e.id,
            label: e.label,
            offset,
            rate: 1,
            isReference: false,
            done: false,
          };
        }

        // Reference is healthy — resume any stream we paused, then run normal correction.
        if (enginePausedRef.current.has(e.id) && v.paused) {
          v.play().catch(() => {});
          enginePausedRef.current.delete(e.id);
        }

        if (canSeek && absOffset >= COARSE_SEEK_THRESHOLD && !refIsLive && !isLikelyLiveVideo(v)) {
          try { v.currentTime = Math.max(0, refTime); } catch (_) {}
          if (Math.abs(rate - 1) > 0.001) v.playbackRate = 1;
          rate = 1;
          allDone = false;
        } else if (absOffset >= threshold) {
          const desired = offset < 0 ? RATE_FAST : RATE_SLOW;
          if (Math.abs(rate - desired) > 0.001) {
            v.playbackRate = clampRate(desired);
            rate = desired;
          }
          allDone = false;
        } else {
          if (Math.abs(rate - 1) > 0.001) v.playbackRate = 1;
          rate = 1;
        }

        return {
          id: e.id,
          label: e.label,
          offset,
          rate,
          isReference: false,
          done: absOffset < threshold,
        };
      });

      return { infos, allDone };
    },
    []
  );

  const startSync = useCallback(
    (entries: SyncEntry[]) => {
      stopTimers();
      resetRates();
      enginePausedRef.current.clear();
      refHasStartedRef.current = false;

      const withVideos: RuntimeEntry[] = entries
        .map((e) => ({ ...e, video: e.getVideo() }))
        .filter((e): e is RuntimeEntry => e.video != null && Number.isFinite(e.video.currentTime));

      if (withVideos.length < 2) return;

      // Reference: main feed always wins when flagged. Otherwise fall back to user preference.
      const mainEntry = withVideos.find((e) => e.isMainFeed);
      let refEntry: RuntimeEntry;
      if (mainEntry) {
        refEntry = mainEntry;
      } else {
        const referenceMode = getSyncReferenceMode();
        if (referenceMode === 'latest') {
          refEntry = withVideos.reduce(
            (best, cur) => (cur.video.currentTime > best.video.currentTime ? cur : best),
            withVideos[0]
          );
        } else {
          refEntry = withVideos[0];
        }
      }

      entriesRef.current = withVideos;
      refIdRef.current = refEntry.id;
      thresholdRef.current = getSyncOffsetThreshold();
      keepLockedRef.current = getSyncKeepLocked();
      convergeDeadlineRef.current = Date.now() + MAX_CONVERGE_MS;

      // Initial pass: stagger seeks so all streams don't flush their buffer at the same instant.
      const refTime = refEntry.video.currentTime;
      const refIsLive = isLikelyLiveVideo(refEntry.video);
      withVideos.forEach((e, i) => {
        if (e.id === refEntry.id) return;
        if (refIsLive || isLikelyLiveVideo(e.video)) return;
        const offset = e.video.currentTime - refTime;
        if (Math.abs(offset) >= COARSE_SEEK_THRESHOLD) {
          window.setTimeout(() => {
            try { e.video.currentTime = Math.max(0, refTime); } catch (_) {}
          }, i * SEEK_STAGGER_MS);
        }
      });

      const initial = computeAndCorrect(false);
      setSyncStreams(initial.infos);
      setSyncStatus('syncing');
      setShowSyncOverlay(true);
      setIsEngineActive(true);

      const minDoneDelay = getSyncDoneDelayMs();
      const convergeStartedAt = Date.now();
      tickTimerRef.current = setInterval(() => {
        const { infos, allDone } = computeAndCorrect(true);
        setSyncStreams(infos);

        const enoughTime = Date.now() - convergeStartedAt >= minDoneDelay;
        const deadlineHit = Date.now() >= convergeDeadlineRef.current;
        if ((allDone && enoughTime) || deadlineHit) {
          if (tickTimerRef.current != null) {
            clearInterval(tickTimerRef.current);
            tickTimerRef.current = null;
          }
          // Final read with everyone snapped to rate=1.
          resetRates();
          const final = computeAndCorrect(false);
          setSyncStreams(final.infos.map((s) => ({ ...s, rate: 1 })));
          setSyncStatus('done');

          if (keepLockedRef.current) {
            // Continuous drift watcher. Also handles the buffer-pause/resume logic — if the main
            // feed rebuffers, this is what catches the offset growth and pauses the others.
            watchTimerRef.current = setInterval(() => {
              const { infos: w } = computeAndCorrect(true);
              setSyncStreams(w);
            }, WATCH_MS);
          } else {
            setIsEngineActive(false);
          }
        }
      }, TICK_MS);
    },
    [stopTimers, resetRates, computeAndCorrect]
  );

  const minimizeOverlay = useCallback(() => {
    // Hide the dialog but keep the engine running. Use restoreOverlay (or the floating badge)
    // to bring it back.
    setShowSyncOverlay(false);
  }, []);

  const restoreOverlay = useCallback(() => {
    setShowSyncOverlay(true);
  }, []);

  const closeOverlay = useCallback(() => {
    setShowSyncOverlay(false);
    cancelSync();
    setSyncStatus((prev) => (prev === 'syncing' ? 'idle' : prev));
  }, [cancelSync]);

  useEffect(() => () => stopTimers(), [stopTimers]);

  return {
    startSync,
    cancelSync,
    closeOverlay,
    minimizeOverlay,
    restoreOverlay,
    syncStatus,
    syncStreams,
    showSyncOverlay,
    /** True iff a watch/converge cycle is active — drives the floating "minimized" badge. */
    isSyncEngineRunning: isEngineActive,
  };
}
