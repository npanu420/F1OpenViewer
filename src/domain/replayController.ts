/**
 * Drives a timing store along a replay timeline by playback offset. Forward seeks apply only
 * the new records; backward seeks rebuild from scratch (deltas aren't invertible). Pure, so the
 * React hook and any future video-synced clock just call seekTo().
 */

import { createStore, applyRecord, type TimingStore } from './timing';
import { sliceUntil, type TimelineEntry } from './replay';

export class ReplayController {
  store: TimingStore = createStore();
  private idx = 0;
  private lastTarget = -1;

  constructor(private readonly timeline: TimelineEntry[]) {}

  /** Apply the timeline up to `targetMs` and return the current store. */
  seekTo(targetMs: number): TimingStore {
    if (targetMs < this.lastTarget) {
      this.store = createStore();
      this.idx = 0;
    }
    const { records, nextIndex } = sliceUntil(this.timeline, this.idx, targetMs);
    for (const r of records) applyRecord(this.store, r.feed, r.data);
    this.idx = nextIndex;
    this.lastTarget = targetMs;
    return this.store;
  }

  reset(): void {
    this.store = createStore();
    this.idx = 0;
    this.lastTarget = -1;
  }
}
