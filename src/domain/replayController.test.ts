import { test } from 'vitest';
import assert from 'node:assert/strict';
import { buildTimeline } from './replay';
import { ReplayController } from './replayController';

const TL = buildTimeline({
  TimingData: [
    { offsetMs: 0, data: { Lines: { '1': { Position: '1', Line: 1 } } } },
    { offsetMs: 100, data: { Lines: { '1': { Position: '2' } } } },
    { offsetMs: 200, data: { Lines: { '1': { Position: '3' } } } },
  ],
});

test('seekTo forward applies progressive deltas', () => {
  const c = new ReplayController(TL);
  assert.equal(c.seekTo(0).TimingData.Lines['1'].Position, '1');
  assert.equal(c.seekTo(150).TimingData.Lines['1'].Position, '2');
  assert.equal(c.seekTo(999).TimingData.Lines['1'].Position, '3');
});

test('seekTo same offset is idempotent (no double-apply, no advance)', () => {
  const c = new ReplayController(TL);
  c.seekTo(150);
  const again = c.seekTo(150);
  assert.equal(again.TimingData.Lines['1'].Position, '2');
});

test('seekTo backward rebuilds correct earlier state', () => {
  const c = new ReplayController(TL);
  c.seekTo(999);
  assert.equal(c.store.TimingData.Lines['1'].Position, '3');
  const back = c.seekTo(50);
  assert.equal(back.TimingData.Lines['1'].Position, '1'); // rebuilt from 0, not stuck at 3
  assert.equal(back.TimingData.Lines['1'].Line, 1); // snapshot key preserved on rebuild
});

test('property: seekTo(target) state == fresh rebuild to same target', () => {
  let s = 1;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
  const recs = Array.from({ length: 40 }, (_, i) => ({
    offsetMs: i * 10,
    data: { Lines: { '1': { Position: String(i) } } },
  }));
  const tl = buildTimeline({ TimingData: recs });

  const roamer = new ReplayController(tl);
  for (let step = 0; step < 200; step++) {
    const target = Math.floor(rand() * 420);
    roamer.seekTo(target);
    // Independent fresh controller seeking straight to the same target:
    const fresh = new ReplayController(tl).seekTo(target);
    assert.deepEqual(roamer.store.TimingData, fresh.TimingData);
  }
});

// ---- checkpoints -------------------------------------------------------------------------

import { CHECKPOINT_INTERVAL_MS } from './replayController';
import type { TimelineEntry } from './replay';

function rngSeed(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
}

/** Long multi-feed session with nested deltas, array snapshots and keyed deltas. */
function longTimeline(minutes: number): TimelineEntry[] {
  const r = rngSeed(7);
  const feeds: Record<string, Array<{ offsetMs: number; data: unknown }>> = {
    TimingData: [{ offsetMs: 0, data: { Lines: { '1': { Position: '1' }, '2': { Position: '2' } } } }],
    RaceControlMessages: [{ offsetMs: 0, data: { Messages: [] } }],
    ExtrapolatedClock: [{ offsetMs: 0, data: { Remaining: '01:00:00', Extrapolating: false } }],
  };
  let msg = 0;
  for (let ms = 1000; ms < minutes * 60_000; ms += 1000 + Math.floor(r() * 2000)) {
    const drv = String(1 + Math.floor(r() * 2));
    feeds.TimingData.push({ offsetMs: ms, data: { Lines: { [drv]: { Position: String(Math.floor(r() * 20)), Sectors: { [Math.floor(r() * 3)]: { Value: String(r()) } } } } } });
    if (r() < 0.05) feeds.RaceControlMessages.push({ offsetMs: ms, data: { Messages: { [msg++]: { Message: `m${msg}` } } } });
    if (r() < 0.1) feeds.ExtrapolatedClock.push({ offsetMs: ms, data: { Remaining: `00:${String(Math.floor(r() * 59)).padStart(2, '0')}:00` } });
  }
  return buildTimeline(feeds as never);
}

test('property: with checkpoints, random forward/backward seeks always equal a fresh rebuild', () => {
  const tl = longTimeline(30);
  const rand = rngSeed(99);
  const roamer = new ReplayController(tl);
  const span = 30 * 60_000;
  for (let step = 0; step < 150; step++) {
    const target = Math.floor(rand() * span);
    roamer.seekTo(target);
    const fresh = new ReplayController(tl).seekTo(target);
    assert.deepEqual(roamer.store, fresh, `mismatch at target ${target}`);
  }
});

test('backward seeks re-apply only from the nearest checkpoint, not from record 0', () => {
  let applied = 0;
  const tl: TimelineEntry[] = [];
  for (let i = 0; i < 3000; i++) {
    tl.push({
      offsetMs: i * 600,
      feed: 'TimingData',
      get data() { applied++; return { Lines: { '1': { Position: String(i) } } }; },
    } as TimelineEntry);
  }
  const c = new ReplayController(tl);
  c.seekTo(25 * 60_000);
  applied = 0;
  const store = c.seekTo(24 * 60_000);
  assert.equal(store.TimingData.Lines['1'].Position, String(Math.floor((24 * 60_000) / 600)));
  // at most ~one checkpoint interval of records (200) plus slack; a full rebuild would be ~2400
  assert.ok(applied <= CHECKPOINT_INTERVAL_MS / 600 + 5, `re-applied ${applied} records`);
});

test('version only changes when the store content changes', () => {
  const c = new ReplayController(TL);
  c.seekTo(150);
  const v = c.version;
  c.seekTo(150);
  c.seekTo(160); // no record between 150 and 200
  assert.equal(c.version, v);
  c.seekTo(250);
  assert.ok(c.version > v);
  const v2 = c.version;
  c.seekTo(50); // rewind changes content
  assert.ok(c.version > v2);
});

test('restored checkpoints are independent copies (later deltas do not corrupt them)', () => {
  const tl = longTimeline(10);
  const c = new ReplayController(tl);
  c.seekTo(9 * 60_000);
  c.seekTo(5 * 60_000); // restore from checkpoint
  c.seekTo(9 * 60_000); // mutate forward again
  const back = new ReplayController(tl).seekTo(5 * 60_000 + 1);
  assert.deepEqual(c.seekTo(5 * 60_000 + 1), back);
});
