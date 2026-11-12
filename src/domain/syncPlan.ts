/**
 * Pure decision logic for keeping one stream aligned with the reference stream. The engine
 * (useSyncEngine) reads the videos, asks planCorrection what to do per stream, and applies it.
 * Kept free of DOM types so every branch is unit-tested.
 */

export const COARSE_SEEK_THRESHOLD = 0.5;
/** Live streams seek less eagerly: their seekable window moves and a needless seek re-buffers. */
export const LIVE_COARSE_SEEK_THRESHOLD = 1.5;
export const RATE_FAST = 1.05;
export const RATE_SLOW = 0.95;
/** Keep a seek target this far inside the live window so it lands on already-available media. */
const LIVE_EDGE_MARGIN = 1;
/**
 * Seconds a stream takes to show video after a seek to media it has not loaded, until measured.
 * Seeking exactly to the reference would land behind it again once loaded, and seek again: a
 * stream stuck showing one frame per seek.
 */
export const DEFAULT_SEEK_LEAD = 2;
/** A stream ahead of the reference by up to this many seconds pauses until it is caught up. */
export const MAX_WAIT_AHEAD = 10;

export interface SeekRange {
  start: number;
  end: number;
}

export interface PlanInput {
  /** stream.currentTime - reference.currentTime, seconds (negative = stream is behind). */
  offset: number;
  /** Seconds of tolerated drift before a correction is applied. */
  threshold: number;
  /** False during the very first tick, where only rate nudges are allowed. */
  canSeek: boolean;
  /** Reference stalled: hold everyone instead of correcting against a moving target. */
  refBuffering: boolean;
  /**
   * This stream is seeking or has no data at its position yet. Seeking it again would throw away
   * the segments it is fetching, so after a long jump it would never get a frame on screen.
   */
  streamBuffering?: boolean;
  refLive: boolean;
  streamLive: boolean;
  refTime: number;
  /** The stream's own seekable window (needed to seek a live stream). */
  seekable: SeekRange | null;
  /** The stream's current time (to avoid redundant live seeks). */
  streamTime: number;
  /** The stream already has media loaded at the reference time (a seek there is instant). Default true. */
  bufferedAtRef?: boolean;
  /** Seconds this stream needs to show video after a seek to unloaded media (see DEFAULT_SEEK_LEAD). */
  seekLead?: number;
}

export type Plan =
  | { kind: 'hold' }
  | { kind: 'seek'; to: number }
  | { kind: 'rate'; rate: number }
  /** Ahead of the reference: pause until it catches up. */
  | { kind: 'wait' }
  | { kind: 'normal' };

/**
 * The video element each entry currently shows. Panels remount (slot moved, stream reloaded) and
 * then own a NEW <video>: the previous one is detached and paused, so treating it as the reference
 * would hold every other stream forever. Entries without an attached element are skipped this tick.
 */
export function liveEntries<T extends { getVideo: () => { isConnected: boolean } | null }>(
  entries: T[]
): Array<T & { video: NonNullable<ReturnType<T['getVideo']>> }> {
  const out: Array<T & { video: NonNullable<ReturnType<T['getVideo']>> }> = [];
  for (const e of entries) {
    const video = e.getVideo() as ReturnType<T['getVideo']>;
    if (video && video.isConnected) out.push({ ...e, video: video as NonNullable<ReturnType<T['getVideo']>> });
  }
  return out;
}

export function planCorrection(i: PlanInput): Plan {
  if (i.refBuffering || i.streamBuffering) return { kind: 'hold' };

  const abs = Math.abs(i.offset);
  const live = i.refLive || i.streamLive;
  const coarse = live ? LIVE_COARSE_SEEK_THRESHOLD : COARSE_SEEK_THRESHOLD;

  if (i.canSeek && abs >= coarse) {
    if (!live) {
      if (i.bufferedAtRef !== false) return { kind: 'seek', to: Math.max(0, i.refTime) };
      if (i.offset > 0 && i.offset <= MAX_WAIT_AHEAD) return { kind: 'wait' };
      // Aim where the reference will be once this stream has loaded.
      return { kind: 'seek', to: Math.max(0, i.refTime + (i.seekLead ?? DEFAULT_SEEK_LEAD)) };
    }
    // Live/DVR: only seek inside the stream's own window, clamped away from its edge.
    const r = i.seekable;
    if (r && Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start) {
      const hi = Math.max(r.start, r.end - LIVE_EDGE_MARGIN);
      const to = Math.min(Math.max(i.refTime, r.start), hi);
      if (Math.abs(to - i.streamTime) >= i.threshold) return { kind: 'seek', to };
    }
    // No usable window: fall through to the gentle rate correction.
  }

  if (abs >= i.threshold) return { kind: 'rate', rate: i.offset < 0 ? RATE_FAST : RATE_SLOW };
  return { kind: 'normal' };
}
