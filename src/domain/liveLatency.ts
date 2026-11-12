/**
 * Live latency tuning.
 *
 * A live stream is held behind the newest video for three separate reasons:
 *  1. the presentation delay: the manifest (DASH `suggestedPresentationDelay`, or three segments
 *     for HLS) tells players to stay that far back, and the player's "live edge" already includes it;
 *  2. the target latency the player keeps behind that edge;
 *  3. the offset used for the first seek.
 *
 * The standard mode trusts the manifest (1) and adds the user's live delay (2). The experimental
 * low-latency mode ignores the manifest's delay, sits about one segment behind the newest video and
 * lets the player back off by itself when that turns out to be too close.
 */

export interface LiveLatencyPrefs {
  liveDelaySeconds: number;
  lowLatencyLive: boolean;
}

/** Lowest latency ever aimed for (s): below this even 1 s segments stall. */
export const LOW_LATENCY_MIN = 1.5;
/** Ceiling the automatic back-off may reach in low-latency mode (s). */
export const LOW_LATENCY_MAX = 12;
/** Presentation delay used instead of the manifest's in low-latency mode (s). */
const LOW_LATENCY_PRESENTATION_DELAY = 1;
/** Until the real segment length is known, assume segments this long (s). */
const ASSUMED_SEGMENT_SECONDS = 2;

export interface LiveTuning {
  /** Shaka `manifest` overrides (empty in standard mode). */
  manifest: Record<string, unknown>;
  /** Shaka `streaming.liveSync`. */
  liveSync: Record<string, unknown>;
  /** Shaka `streaming.rebufferingGoal`, or null to keep the player's own value. */
  rebufferingGoal: number | null;
  /** Distance from the live edge of the first seek (s). */
  edgeOffset: number;
}

/**
 * Target latency for a given segment length: one whole segment has to be downloadable ahead of the
 * playhead, plus a little margin for the request itself.
 */
export function lowLatencyTarget(segmentSeconds: number | null | undefined): number {
  const segment = segmentSeconds != null && Number.isFinite(segmentSeconds) && segmentSeconds > 0 ? segmentSeconds : ASSUMED_SEGMENT_SECONDS;
  return Math.min(LOW_LATENCY_MAX, Math.max(LOW_LATENCY_MIN, segment + 0.5));
}

export function liveTuning(prefs: LiveLatencyPrefs, isHls: boolean, segmentSeconds?: number | null): LiveTuning {
  if (!prefs.lowLatencyLive) {
    return {
      manifest: {},
      liveSync: { enabled: true, targetLatency: prefs.liveDelaySeconds },
      rebufferingGoal: null,
      edgeOffset: Math.max(6, prefs.liveDelaySeconds),
    };
  }
  const target = lowLatencyTarget(segmentSeconds);
  return {
    // HLS has no usable sub-segment delay: stay two segments back instead of the default three.
    manifest: isHls
      ? { hls: { liveSegmentsDelay: 2 } }
      : { defaultPresentationDelay: LOW_LATENCY_PRESENTATION_DELAY, dash: { ignoreSuggestedPresentationDelay: true, ignoreMinBufferTime: true } },
    liveSync: {
      enabled: true,
      targetLatency: target,
      targetLatencyTolerance: 0.5,
      maxPlaybackRate: 1.1,
      minPlaybackRate: 0.95,
      // Slow down instead of stalling when the buffer runs dry.
      panicMode: true,
      panicThreshold: 30,
      // Every stall moves the target one second back, up to the ceiling; a stable minute moves it forward again.
      dynamicTargetLatency: {
        enabled: true,
        minLatency: target,
        maxLatency: LOW_LATENCY_MAX,
        rebufferIncrement: 1,
        stabilityThreshold: 60,
        maxAttempts: 10,
      },
    },
    // Must stay below the target: the player cannot buffer more than exists ahead of the playhead.
    rebufferingGoal: Math.min(1, target / 2),
    edgeOffset: target,
  };
}
