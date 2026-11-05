/**
 * Drives a timing store along a replay timeline by playback offset. Forward seeks apply only the
 * new records. Deltas aren't invertible, so backward seeks restore the nearest earlier checkpoint
 * (a deep copy of the store taken while playing forward) and re-apply from there, instead of
 * rebuilding a multi-hour session from record 0 on every scrub. Pure, so the React hook and any
 * future video-synced clock just call seekTo().
 */

import { createStore, applyRecord, type TimingStore } from './timing';
import { sliceUntil, type TimelineEntry } from './replay';

/** Distance between checkpoints. ~2.5h race => ~75 snapshots of a few hundred KB each. */
export const CHECKPOINT_INTERVAL_MS = 120_000;

interface Checkpoint {
  /** Index of the first timeline record NOT included in `store`. */
  idx: number;
  store: TimingStore;
}

export class ReplayController {
  store: TimingStore = createStore();
  /**
   * Bumped whenever the store content changes (records applied or state restored), so callers can
   * skip re-deriving view models on ticks where nothing new arrived.
   */
  version = 0;
  private idx = 0;
  private lastTarget = -1;
  /** k -> state after applying every record with offset <= k * CHECKPOINT_INTERVAL_MS. */
  private checkpoints = new Map<number, Checkpoint>();
  /** k of the next checkpoint boundary that has not been passed yet by the forward cursor. */
  private nextBoundaryK = 1;

  constructor(private readonly timeline: TimelineEntry[]) {}

  /** Apply the timeline up to `targetMs` and return the current store. */
  seekTo(targetMs: number): TimingStore {
    if (targetMs < this.lastTarget) this.rewindTo(targetMs);

    // Cross checkpoint boundaries one at a time so each snapshot is taken at exactly its boundary.
    while (this.nextBoundaryK * CHECKPOINT_INTERVAL_MS <= targetMs) {
      const k = this.nextBoundaryK;
      this.applyUntil(k * CHECKPOINT_INTERVAL_MS);
      if (!this.checkpoints.has(k)) {
        this.checkpoints.set(k, { idx: this.idx, store: structuredClone(this.store) });
      }
      this.nextBoundaryK = k + 1;
    }
    this.applyUntil(targetMs);
    this.lastTarget = targetMs;
    return this.store;
  }

  reset(): void {
    this.store = createStore();
    this.idx = 0;
    this.lastTarget = -1;
    this.nextBoundaryK = 1;
    this.version++;
  }

  private applyUntil(targetMs: number): void {
    const { records, nextIndex } = sliceUntil(this.timeline, this.idx, targetMs);
    if (records.length) {
      for (const r of records) applyRecord(this.store, r.feed, r.data);
      this.version++;
    }
    this.idx = nextIndex;
  }

  /** Restore the newest checkpoint at or before `targetMs` (or the empty state if none). */
  private rewindTo(targetMs: number): void {
    let k = Math.floor(targetMs / CHECKPOINT_INTERVAL_MS);
    while (k >= 1 && !this.checkpoints.has(k)) k--;
    if (k >= 1) {
      const cp = this.checkpoints.get(k)!;
      this.store = structuredClone(cp.store);
      this.idx = cp.idx;
      this.nextBoundaryK = k + 1;
    } else {
      this.store = createStore();
      this.idx = 0;
      this.nextBoundaryK = 1;
    }
    this.version++;
  }
}
