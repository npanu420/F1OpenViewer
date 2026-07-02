/**
 * Replay timeline: flatten per-feed archived records into one time-ordered stream and
 * slice it by playback offset. Pure, it drives the replay clock in the renderer and is the
 * same shape the live transport feeds into the reducer (one record at a time).
 */

import type { Json } from './timing';

export interface FeedRecord {
  offsetMs: number;
  ts?: string;
  data: Json;
}

export interface TimelineEntry {
  offsetMs: number;
  feed: string;
  data: Json;
}

/**
 * Merge `{ feed: records[] }` into one stream sorted by offset. Stable within an offset:
 * ties keep feed/record discovery order so a snapshot never lands after its own delta.
 */
export function buildTimeline(byFeed: Record<string, FeedRecord[]>): TimelineEntry[] {
  const flat: Array<TimelineEntry & { seq: number }> = [];
  let seq = 0;
  for (const feed of Object.keys(byFeed)) {
    for (const rec of byFeed[feed] || []) {
      if (!rec || typeof rec.offsetMs !== 'number') continue;
      flat.push({ offsetMs: rec.offsetMs, feed, data: rec.data, seq: seq++ });
    }
  }
  flat.sort((a, b) => a.offsetMs - b.offsetMs || a.seq - b.seq);
  return flat.map(({ offsetMs, feed, data }) => ({ offsetMs, feed, data }));
}

export interface Slice {
  records: TimelineEntry[];
  nextIndex: number;
}

/**
 * Records in `(fromIndex .. ]` whose offset ≤ targetMs, plus the index to resume from.
 * Timeline is sorted, so scanning stops at the first record past the target.
 */
export function sliceUntil(timeline: TimelineEntry[], fromIndex: number, targetMs: number): Slice {
  let i = Math.max(0, fromIndex);
  const records: TimelineEntry[] = [];
  while (i < timeline.length && timeline[i].offsetMs <= targetMs) {
    records.push(timeline[i]);
    i++;
  }
  return { records, nextIndex: i };
}

/** Total span of the session in ms (last record offset), 0 when empty. */
export function timelineDuration(timeline: TimelineEntry[]): number {
  return timeline.length ? timeline[timeline.length - 1].offsetMs : 0;
}
