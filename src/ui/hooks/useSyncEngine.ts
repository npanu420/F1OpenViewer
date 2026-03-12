import { useCallback, useRef, useState } from 'react';
import type { SyncStatus, SyncStreamInfo } from '../components/SyncOverlay';

/** Consider in sync when within this many seconds of reference */
const OFFSET_THRESHOLD = 0.05;
/** If a stream is more than this many seconds behind ref, seek it to ref instead of only rate correction */
const SEEK_THRESHOLD = 1.5;
/** After seek, place stream this many seconds behind ref (within latency target) */
const LATENCY_TARGET = 0.08;
/** Max playback rate for catch-up */
const MAX_RATE = 1.4;
/** Min playback rate for slow-down */
const MIN_RATE = 0.6;
/** Rate adjustment strength per second of offset */
const RATE_GAIN = 3;

export interface SyncEntry {
  id: string;
  label: string;
  getVideo: () => HTMLVideoElement | null;
}

export function useSyncEngine() {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [syncStreams, setSyncStreams] = useState<SyncStreamInfo[]>([]);
  const [showSyncOverlay, setShowSyncOverlay] = useState(false);
  const rafRef = useRef<number | null>(null);
  const lastUpdateRef = useRef(0);

  const cancelSync = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const startSync = useCallback(
    (entries: SyncEntry[]) => {
      cancelSync();

      const withVideos = entries
        .map((e) => ({ ...e, video: e.getVideo() }))
        .filter((e): e is SyncEntry & { video: HTMLVideoElement } => e.video != null);

      if (withVideos.length < 2) return;

      const refTime = Math.max(...withVideos.map((e) => e.video.currentTime));
      const refEntry = withVideos.find((e) => e.video.currentTime === refTime)!;

      // Phase 1: seek streams that are too far behind to a point just behind ref (within latency target)
      withVideos.forEach((e) => {
        if (e.id === refEntry.id) return;
        const offset = e.video.currentTime - refTime;
        if (offset < -SEEK_THRESHOLD) {
          const targetTime = Math.max(0, refTime - LATENCY_TARGET);
          e.video.currentTime = targetTime;
        }
      });

      const buildInfos = (): SyncStreamInfo[] => {
        const refVideo = refEntry.video;
        const refCurrentTime = refVideo.currentTime;
        return withVideos.map((e) => {
          const currentTime = e.video.currentTime;
          const offset = currentTime - refCurrentTime;
          const isReference = e.id === refEntry.id;
          const absOffset = Math.abs(offset);
          const done = isReference || absOffset < OFFSET_THRESHOLD;

          let rate = 1;
          if (!isReference && !done) {
            const delta = (offset < 0 ? 1 : -1) * Math.min(absOffset * RATE_GAIN, 0.4);
            rate = Math.max(MIN_RATE, Math.min(MAX_RATE, 1 + delta));
          }

          return {
            id: e.id,
            label: e.label,
            offset,
            rate,
            isReference,
            done,
          };
        });
      };

      setSyncStreams(buildInfos());
      setSyncStatus('syncing');
      setShowSyncOverlay(true);

      function tick() {
        const refVideo = refEntry.video;
        if (!refVideo || !refVideo.isConnected) {
          rafRef.current = null;
          return;
        }

        const refCurrentTime = refVideo.currentTime;
        let allDone = true;

        withVideos.forEach((e) => {
          if (e.id === refEntry.id) return;
          const offset = e.video.currentTime - refCurrentTime;
          const absOffset = Math.abs(offset);
          if (absOffset >= OFFSET_THRESHOLD) {
            allDone = false;
            const delta = (offset < 0 ? 1 : -1) * Math.min(absOffset * RATE_GAIN, 0.4);
            const rate = Math.max(MIN_RATE, Math.min(MAX_RATE, 1 + delta));
            e.video.playbackRate = rate;
          } else {
            e.video.playbackRate = 1;
          }
        });

        const now = performance.now();
        if (now - lastUpdateRef.current >= 80) {
          lastUpdateRef.current = now;
          setSyncStreams(buildInfos());
        }

        if (allDone) {
          withVideos.forEach((e) => {
            e.video.playbackRate = 1;
          });
          setSyncStreams(buildInfos().map((s) => ({ ...s, done: true, rate: 1 })));
          setSyncStatus('done');
          rafRef.current = null;
          return;
        }

        rafRef.current = requestAnimationFrame(tick);
      }

      rafRef.current = requestAnimationFrame(tick);
    },
    [cancelSync]
  );

  const closeOverlay = useCallback(() => {
    setShowSyncOverlay(false);
    cancelSync();
    if (syncStatus === 'syncing') setSyncStatus('idle');
  }, [syncStatus, cancelSync]);

  return {
    startSync,
    cancelSync,
    closeOverlay,
    syncStatus,
    syncStreams,
    showSyncOverlay,
  };
}
