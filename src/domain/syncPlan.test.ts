import { test, expect } from 'vitest';
import { DEFAULT_SEEK_LEAD, planCorrection, RATE_FAST, RATE_SLOW, type PlanInput } from './syncPlan';

const base: PlanInput = {
  offset: 0,
  threshold: 0.05,
  canSeek: true,
  refBuffering: false,
  refLive: false,
  streamLive: false,
  refTime: 100,
  seekable: null,
  streamTime: 100,
};
const plan = (over: Partial<PlanInput>) => planCorrection({ ...base, ...over });

test('reference buffering always holds, whatever the drift', () => {
  expect(plan({ refBuffering: true, offset: 30 })).toEqual({ kind: 'hold' });
  expect(plan({ refBuffering: true, offset: 0 })).toEqual({ kind: 'hold' });
});

test('a stream still loading after a seek is left alone, not seeked again', () => {
  expect(plan({ streamBuffering: true, offset: -0.6 })).toEqual({ kind: 'hold' });
  expect(plan({ streamBuffering: true, offset: -30 })).toEqual({ kind: 'hold' });
  expect(plan({ streamBuffering: false, offset: -0.6 })).toEqual({ kind: 'seek', to: 100 });
});

test('VOD: a stream behind, with nothing loaded at the reference, seeks ahead of it by its load time', () => {
  expect(plan({ offset: -1.4, bufferedAtRef: false })).toEqual({ kind: 'seek', to: 100 + DEFAULT_SEEK_LEAD });
  expect(plan({ offset: -1.4, bufferedAtRef: false, seekLead: 3.5 })).toEqual({ kind: 'seek', to: 103.5 });
  // Media already loaded there: straight to the reference.
  expect(plan({ offset: -1.4, bufferedAtRef: true })).toEqual({ kind: 'seek', to: 100 });
});

test('VOD: a stream ahead waits for the reference instead of seeking back into unloaded media', () => {
  expect(plan({ offset: 1.2, bufferedAtRef: false })).toEqual({ kind: 'wait' });
  // Far ahead: waiting would take too long, seek.
  expect(plan({ offset: 60, bufferedAtRef: false }).kind).toBe('seek');
  // Close enough: the gentle rate nudge.
  expect(plan({ offset: 0.3, bufferedAtRef: false })).toEqual({ kind: 'rate', rate: RATE_SLOW });
});

test('VOD: inside the threshold nothing happens', () => {
  expect(plan({ offset: 0.02 })).toEqual({ kind: 'normal' });
  expect(plan({ offset: -0.049 })).toEqual({ kind: 'normal' });
});

test('VOD: small drift uses a rate nudge in the right direction', () => {
  expect(plan({ offset: -0.2 })).toEqual({ kind: 'rate', rate: RATE_FAST }); // behind -> speed up
  expect(plan({ offset: 0.2 })).toEqual({ kind: 'rate', rate: RATE_SLOW }); // ahead -> slow down
});

test('VOD: large drift seeks to the reference time (never below 0)', () => {
  expect(plan({ offset: 5, refTime: 100 })).toEqual({ kind: 'seek', to: 100 });
  expect(plan({ offset: -0.6, refTime: -3 })).toEqual({ kind: 'seek', to: 0 });
});

test('first pass (canSeek=false) only nudges the rate, even for big drift', () => {
  expect(plan({ offset: 8, canSeek: false })).toEqual({ kind: 'rate', rate: RATE_SLOW });
});

test('live: moderate drift stays a rate nudge (no eager seek)', () => {
  expect(plan({ offset: -1, refLive: true, streamLive: true })).toEqual({ kind: 'rate', rate: RATE_FAST });
});

test('live: large drift seeks inside the stream window, clamped away from the edge', () => {
  const seekable = { start: 1000, end: 1600 };
  expect(plan({ offset: -20, refLive: true, streamLive: true, refTime: 1200, streamTime: 1180, seekable }))
    .toEqual({ kind: 'seek', to: 1200 });
  // reference ahead of what this stream has buffered -> clamp to (end - margin)
  expect(plan({ offset: -50, refLive: true, streamLive: true, refTime: 1700, streamTime: 1650, seekable }))
    .toEqual({ kind: 'seek', to: 1599 });
  // reference behind the window start -> clamp to start
  expect(plan({ offset: 40, refLive: true, streamLive: true, refTime: 900, streamTime: 1300, seekable }))
    .toEqual({ kind: 'seek', to: 1000 });
});

test('live: without a usable window, large drift falls back to the rate nudge', () => {
  expect(plan({ offset: -20, refLive: true, streamLive: true, seekable: null })).toEqual({ kind: 'rate', rate: RATE_FAST });
  expect(plan({ offset: -20, refLive: true, streamLive: true, seekable: { start: 5, end: 5 } })).toEqual({ kind: 'rate', rate: RATE_FAST });
});

test('live: does not re-seek when the clamped target is already where the stream is', () => {
  const seekable = { start: 1000, end: 1600 };
  // stream pinned at the window edge already; reference is further ahead
  expect(plan({ offset: -60, refLive: true, streamLive: true, refTime: 1700, streamTime: 1599, seekable }))
    .toEqual({ kind: 'rate', rate: RATE_FAST });
});

import { liveEntries } from './syncPlan';

test('liveEntries re-resolves the element each call and skips detached / missing ones', () => {
  let current: { isConnected: boolean; id: string } | null = { isConnected: true, id: 'v1' };
  const entries = [
    { id: 'main', getVideo: () => current },
    { id: 'onboard', getVideo: () => ({ isConnected: true, id: 'v2' }) },
    { id: 'gone', getVideo: () => null },
  ];
  expect(liveEntries(entries).map((e) => [e.id, e.video.id])).toEqual([['main', 'v1'], ['onboard', 'v2']]);
  // the main panel remounted: old element detached, a new one attached
  const old = current;
  old!.isConnected = false;
  expect(liveEntries(entries).map((e) => e.id)).toEqual(['onboard']);
  current = { isConnected: true, id: 'v1b' };
  expect(liveEntries(entries).find((e) => e.id === 'main')?.video.id).toBe('v1b');
});
