import { useCallback, useRef, useState } from 'react';
import type { SyncStatus, SyncStreamInfo } from '../components/SyncOverlay';

/**
 * VOD-safe sync: seek-only, no continuous loop.
 * We read the reference (main) stream once, seek all other streams to that time, then stop.
 * No repeated reads and no playback-rate changes, so the main stream never buffers from sync.
 * (RaceControl uses rate-only for live; f1viewer sync is start-alignment via silence. For VOD with main ahead, seek-once is safest.)
 */

/** Consider in sync when within this many seconds of reference (for overlay display). */
const OFFSET_THRESHOLD = 0.05;

export interface SyncEntry {
  id: string;
  label: string;
  getVideo: () => HTMLVideoElement | null;
}

export function useSyncEngine() {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [syncStreams, setSyncStreams] = useState<SyncStreamInfo[]>([]);
  const [showSyncOverlay, setShowSyncOverlay] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelSync = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const startSync = useCallback(
    (entries: SyncEntry[]) => {
      cancelSync();

      const withVideos = entries
        .map((e) => ({ ...e, video: e.getVideo() }))
        .filter((e): e is SyncEntry & { video: HTMLVideoElement } => e.video != null);

      if (withVideos.length < 2) return;

      // Reference = first entry (main stream). Single read, no seek on main, no loop.
      const refEntry = withVideos[0];
      const refVideo = refEntry.video;
      const refTime = refVideo.currentTime;

      // One-time bulk seek: set every other stream to the same time as the reference. No rate loop.
      withVideos.forEach((e) => {
        if (e.id === refEntry.id) return;
        const targetTime = Math.max(0, refTime);
        e.video.currentTime = targetTime;
        e.video.playbackRate = 1;
      });

      const buildInfos = (refCurrentTime: number): SyncStreamInfo[] => {
        return withVideos.map((e) => {
          const currentTime = e.video.currentTime;
          const offset = currentTime - refCurrentTime;
          const isReference = e.id === refEntry.id;
          const absOffset = Math.abs(offset);
          const done = isReference || absOffset < OFFSET_THRESHOLD;
          return {
            id: e.id,
            label: e.label,
            offset,
            rate: 1,
            isReference,
            done,
          };
        });
      };

      setSyncStreams(buildInfos(refTime));
      setSyncStatus('syncing');
      setShowSyncOverlay(true);

      // After a short delay, show "done". Streams may still be buffering to the new position; we don't touch them again.
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        withVideos.forEach((e) => {
          e.video.playbackRate = 1;
        });
        const refNow = refVideo.isConnected ? refVideo.currentTime : refTime;
        setSyncStreams(buildInfos(refNow).map((s) => ({ ...s, done: true, rate: 1 })));
        setSyncStatus('done');
      }, 400);
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
