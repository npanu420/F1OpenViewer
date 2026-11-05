import { useCallback, useEffect, useRef, useState } from 'react';
import type { SyncStatus, SyncStreamInfo } from '../components/SyncOverlay';
import {
  getSyncOffsetThreshold,
  getSyncDoneDelayMs,
  getSyncKeepLocked,
  getSyncReferenceMode,
} from '../../services/syncSettings';
import { COARSE_SEEK_THRESHOLD, liveEntries, planCorrection, type SeekRange } from '../../domain/syncPlan';

/**
 * Multi-stage sync engine for VOD/live multiview.
 *
 * Reference selection (priority order):
 *   1. The entry flagged `isMainFeed` always wins when present, even
 *      when it's behind the others. Rationale: onboards/data should follow the race; if the
 *      race rebuffers we want everyone to wait for it, not the inverse.
 *   2. User preference from settings: 'first' (legacy) or 'latest' (most-ahead).
 *
 * Continuous mode:
 *   When `keepLocked` is true, the engine checks for drift after initial convergence.
 *
 * Buffering protection:
 *   When the reference video stalls (paused without user action, or readyState < HAVE_FUTURE_DATA)
 *   the engine pauses the other streams instead of seeking them backwards. As soon as the
 *   reference recovers, the auto-paused streams resume. This avoids the "everyone re-buffers
 *   every time the world feed hiccups" failure mode of pure offset-driven sync.
 *
 * Per-stream correction (decided by planCorrection in domain/syncPlan.ts, unit-tested):
 *   - Drift at or above the coarse threshold seeks to the reference time. Live/DVR streams seek
 *     too, but only inside their own seekable window and with a higher threshold.
 *   - Smaller drift adjusts playback rate until it falls within the target threshold.
 *   - Drift below the target threshold restores normal playback speed.
 *
 * This hook is the only drift corrector in the multiview; MultiViewer just relays the clock.
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
const WATCH_MS = 500;
const SEEK_STAGGER_MS = 60;
/** HTMLMediaElement.readyState constant (avoids relying on the named constant in strict TS). */
const HAVE_FUTURE_DATA = 3;

type RuntimeEntry = SyncEntry & { video: HTMLVideoElement };

/** The stream's own seekable window, or null when the element reports none yet. */
function seekRangeOf(video: HTMLVideoElement): SeekRange | null {
  try {
    const s = video.seekable;
    if (s && s.length > 0) return { start: s.start(0), end: s.end(s.length - 1) };
  } catch (_) {}
  return null;
}

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

/** Same streams, reference, done flags and (2-decimal) rates: what the UI shows without the overlay. */
export function sameSyncShape(a: SyncStreamInfo[], b: SyncStreamInfo[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.label !== y.label ||
      x.isReference !== y.isReference ||
      x.done !== y.done ||
      Math.round(x.rate * 100) !== Math.round(y.rate * 100)
    ) return false;
  }
  return true;
}

export function useSyncEngine() {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [syncStreams, setSyncStreamsState] = useState<SyncStreamInfo[]>([]);
  const [showSyncOverlay, setShowSyncOverlayState] = useState(false);
  /** Latest computed infos (even when not published), so restoring the overlay shows fresh values. */
  const latestInfosRef = useRef<SyncStreamInfo[]>([]);
  const publishedRef = useRef<SyncStreamInfo[]>([]);
  const overlayOpenRef = useRef(false);
  const setShowSyncOverlay = useCallback((open: boolean) => {
    overlayOpenRef.current = open;
    setShowSyncOverlayState(open);
    if (open) {
      publishedRef.current = latestInfosRef.current;
      setSyncStreamsState(latestInfosRef.current);
    }
  }, []);
  /**
   * Publish tick results to React. The ticker/watcher run every 100-500 ms forever (keepLocked) and
   * every publish re-renders the whole multiview, so while the overlay is closed only publish when
   * something the closed-overlay UI reads changes (stream set, reference, done, rate): offsets only
   * matter to the open overlay.
   */
  const setSyncStreams = useCallback((infos: SyncStreamInfo[]) => {
    latestInfosRef.current = infos;
    if (!overlayOpenRef.current && sameSyncShape(publishedRef.current, infos)) return;
    publishedRef.current = infos;
    setSyncStreamsState(infos);
  }, []);
  /**
   * True while either the convergence ticker or the drift-watch interval is active. Consumers
   * use this to decide whether to render the "minimized" floating badge (engine running but
   * overlay hidden).
   */
  const [isEngineActive, setIsEngineActive] = useState(false);

  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const convergeDeadlineRef = useRef<number>(0);
  /** The streams being synced; their video elements are re-resolved on every tick (see liveEntries). */
  const entriesRef = useRef<SyncEntry[]>([]);
  const refIdRef = useRef<string>('');
  const thresholdRef = useRef<number>(0.05);
  const keepLockedRef = useRef<boolean>(true);
  /** Streams that the engine paused itself (so we resume only those, not user-paused ones). */
  const enginePausedRef = useRef<Set<string>>(new Set());
  /** True after the reference has played once, to avoid false buffering before autoplay. */
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
    for (const e of liveEntries(entriesRef.current)) {
      try {
        if (Math.abs(e.video.playbackRate - 1) > 0.001) e.video.playbackRate = 1;
      } catch (_) {}
    }
  }, []);

  const resumeEnginePausedStreams = useCallback(() => {
    for (const e of liveEntries(entriesRef.current)) {
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
      const entries: RuntimeEntry[] = liveEntries(entriesRef.current);
      // Reference not attached right now (its panel is remounting or was stopped): hold nothing,
      // correct nothing. Letting a detached, paused element act as reference froze every stream.
      const refEntry = entries.find((e) => e.id === refIdRef.current);
      if (!refEntry || entries.length < 2) {
        for (const e of entries) {
          if (enginePausedRef.current.has(e.id) && e.video.paused) e.video.play().catch(() => {});
          enginePausedRef.current.delete(e.id);
          if (Math.abs(e.video.playbackRate - 1) > 0.001) e.video.playbackRate = 1;
        }
        return { infos: [], allDone: true };
      }
      const refVideo = refEntry.video;
      const refTime = refVideo.currentTime;
      const threshold = thresholdRef.current;
      const refIsLive = isLikelyLiveVideo(refVideo);

      // Record the first reference playback to filter initial autoplay stalls.
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
          // catches up. Avoid seek and rate correction during this window because it causes more
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

        // Resume streams paused while the reference was buffering.
        if (enginePausedRef.current.has(e.id) && v.paused) {
          v.play().catch(() => {});
          enginePausedRef.current.delete(e.id);
        }

        const streamLive = isLikelyLiveVideo(v);
        const plan = planCorrection({
          offset,
          threshold,
          canSeek,
          refBuffering: false, // handled above (hold)
          refLive: refIsLive,
          streamLive,
          refTime,
          seekable: streamLive || refIsLive ? seekRangeOf(v) : null,
          streamTime: v.currentTime,
        });
        if (plan.kind === 'seek') {
          try { v.currentTime = plan.to; } catch (_) {}
          if (Math.abs(rate - 1) > 0.001) v.playbackRate = 1;
          rate = 1;
          allDone = false;
        } else if (plan.kind === 'rate') {
          if (Math.abs(rate - plan.rate) > 0.001) {
            v.playbackRate = clampRate(plan.rate);
            rate = plan.rate;
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
    (entries: SyncEntry[], opts?: { silent?: boolean }) => {
      stopTimers();
      resetRates();
      enginePausedRef.current.clear();
      refHasStartedRef.current = false;

      const withVideos: RuntimeEntry[] = liveEntries(entries).filter((e) => Number.isFinite(e.video.currentTime));

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

      entriesRef.current = entries;
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
      // Auto-triggered syncs (a new stream starting) run in the background. The minimized
      // floating badge (isSyncEngineRunning && !showSyncOverlay) still shows it's working.
      // Only a user-clicked Sync shows the full popup.
      setShowSyncOverlay(!opts?.silent);
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
            // Continuous drift watcher, including buffer pause and resume handling. If the main
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
    [stopTimers, resetRates, computeAndCorrect, setSyncStreams, setShowSyncOverlay]
  );

  const minimizeOverlay = useCallback(() => {
    // Hide the dialog but keep the engine running. Use restoreOverlay (or the floating badge)
    // to bring it back.
    setShowSyncOverlay(false);
  }, [setShowSyncOverlay]);

  const restoreOverlay = useCallback(() => {
    setShowSyncOverlay(true);
  }, [setShowSyncOverlay]);

  const closeOverlay = useCallback(() => {
    setShowSyncOverlay(false);
    cancelSync();
    setSyncStatus((prev) => (prev === 'syncing' ? 'idle' : prev));
  }, [cancelSync, setShowSyncOverlay]);

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
    /** Whether a watch or convergence cycle is active. */
    isSyncEngineRunning: isEngineActive,
  };
}
