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
