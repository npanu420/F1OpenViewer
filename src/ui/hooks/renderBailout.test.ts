import { test, expect } from 'vitest';
import { sameSyncShape } from './useSyncEngine';
import { sameReplayState, type ReplayTimingState } from './useReplayTiming';

const info = (over: Partial<{ id: string; offset: number; rate: number; done: boolean; isReference: boolean }> = {}) => ({
  id: 'a',
  label: 'A',
  offset: 0.12,
  rate: 1,
  isReference: false,
  done: true,
  ...over,
});

test('sameSyncShape ignores offset noise but not done/rate/reference/stream-set changes', () => {
  expect(sameSyncShape([info()], [info({ offset: 0.31 })])).toBe(true);
  expect(sameSyncShape([info()], [info({ rate: 1.004 })])).toBe(true);
  expect(sameSyncShape([info()], [info({ done: false })])).toBe(false);
  expect(sameSyncShape([info()], [info({ rate: 1.05 })])).toBe(false);
  expect(sameSyncShape([info()], [info({ isReference: true })])).toBe(false);
  expect(sameSyncShape([info()], [info(), info({ id: 'b' })])).toBe(false);
  expect(sameSyncShape([], [])).toBe(true);
});

const state = (over: Partial<ReplayTimingState> = {}): ReplayTimingState => ({
  loading: false,
  error: null,
  drivers: [],
  weather: null,
  trackStatus: null,
  raceControl: [],
  clock: { remaining: '01:00:00', extrapolating: true },
  lapCount: null,
  teamRadio: [],
  offsetMs: 1000,
  durationMs: 5000,
  playing: false,
  speed: 1,
  synced: false,
  autoSynced: false,
  syncOffsetMs: 0,
  detached: false,
  videoAvailable: false,
  ...over,
});

test('sameReplayState: equal content (fresh clock object) bails out, any real change does not', () => {
  const a = state();
  expect(sameReplayState(a, { ...a, clock: { remaining: '01:00:00', extrapolating: true } })).toBe(true);
  expect(sameReplayState(a, { ...a, clock: { remaining: '00:59:59', extrapolating: true } })).toBe(false);
  expect(sameReplayState(a, { ...a, offsetMs: 1200 })).toBe(false);
  expect(sameReplayState(a, { ...a, drivers: [] })).toBe(false); // new array identity = new data
  expect(sameReplayState(a, { ...a, playing: true })).toBe(false);
});
