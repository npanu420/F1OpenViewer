import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { DriverRow } from '../domain/timing';

/**
 * Timing rows for the driver HUD drawn over onboard tiles. Whoever computes the timing in this
 * window publishes here: the Live Timing dock while it is open, otherwise the headless source the
 * multiview mounts (see DriverHudSource). One publisher at a time owns the rows.
 */
type Rows = readonly DriverRow[];
const EMPTY: Rows = [];
let rows: Rows = EMPTY;
let owner: object | null = null;
const listeners = new Set<() => void>();

export function publishHudRows(token: object, next: Rows | null): void {
  if (next == null) {
    if (owner !== token) return;
    owner = null;
    rows = EMPTY;
  } else {
    owner = token;
    rows = next;
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useHudRows(): Rows {
  return useSyncExternalStore(subscribe, () => rows);
}

/**
 * A value derived from the rows, re-rendering only when it changes (rows are republished several
 * times a second; `select` should return a primitive).
 */
export function useHudSelector<T>(select: (rows: Rows) => T): T {
  return useSyncExternalStore(subscribe, () => select(rows));
}

/** Publishes `next` while mounted (null publishes nothing) and clears its rows on unmount. */
export function useHudPublisher(next: Rows | null): void {
  const token = useRef({}).current;
  useEffect(() => {
    if (next != null) publishHudRows(token, next);
  }, [token, next]);
  useEffect(() => () => publishHudRows(token, null), [token]);
}

/**
 * Video clock for a timing source in the same window as the players. The IPC relay
 * (`liveTiming.onClock`) only reaches registered timing windows and docks.
 */
export interface LocalClock { timeSec: number; paused: boolean; wallClockMs: number | null; contentId?: number }
const clockListeners = new Set<(clock: LocalClock) => void>();

export function emitLocalClock(clock: LocalClock): void {
  for (const listener of clockListeners) listener(clock);
}

export function onLocalClock(listener: (clock: LocalClock) => void): () => void {
  clockListeners.add(listener);
  return () => clockListeners.delete(listener);
}

export function hasLocalClockListeners(): boolean {
  return clockListeners.size > 0;
}
