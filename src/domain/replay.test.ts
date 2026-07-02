import { test } from 'vitest';
import assert from 'node:assert/strict';
import { buildTimeline, sliceUntil, timelineDuration } from './replay';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
const randInt = (r: () => number, n: number) => Math.floor(r() * n);

test('buildTimeline: merges feeds and sorts by offset', () => {
  const tl = buildTimeline({
    WeatherData: [{ offsetMs: 100, data: { a: 1 } }, { offsetMs: 300, data: { a: 2 } }],
    TrackStatus: [{ offsetMs: 200, data: { s: 1 } }],
  });
  assert.deepEqual(tl.map((e) => e.offsetMs), [100, 200, 300]);
  assert.deepEqual(tl.map((e) => e.feed), ['WeatherData', 'TrackStatus', 'WeatherData']);
});

test('buildTimeline: stable within equal offsets (snapshot before delta)', () => {
  // Same offset, same feed: original order must be preserved.
  const tl = buildTimeline({
    TimingData: [
      { offsetMs: 5, data: { tag: 'snapshot' } },
      { offsetMs: 5, data: { tag: 'delta' } },
    ],
  });
  assert.deepEqual(tl.map((e) => e.data.tag), ['snapshot', 'delta']);
});

test('buildTimeline: skips malformed records', () => {
  const tl = buildTimeline({
    F: [{ offsetMs: 1, data: {} }, null as any, { data: {} } as any, { offsetMs: 2, data: {} }],
  });
  assert.deepEqual(tl.map((e) => e.offsetMs), [1, 2]);
});

test('sliceUntil: returns records ≤ target and the resume index', () => {
  const tl = buildTimeline({ F: [{ offsetMs: 0, data: 0 }, { offsetMs: 10, data: 1 }, { offsetMs: 20, data: 2 }] });
  const s0 = sliceUntil(tl, 0, 10);
  assert.deepEqual(s0.records.map((rec) => rec.data), [0, 1]);
  assert.equal(s0.nextIndex, 2);
  const s1 = sliceUntil(tl, s0.nextIndex, 25);
  assert.deepEqual(s1.records.map((rec) => rec.data), [2]);
  assert.equal(s1.nextIndex, 3);
});

test('sliceUntil: empty when nothing new ≤ target', () => {
  const tl = buildTimeline({ F: [{ offsetMs: 0, data: 0 }, { offsetMs: 10, data: 1 }] });
  const s = sliceUntil(tl, 2, 9999);
  assert.deepEqual(s.records, []);
  assert.equal(s.nextIndex, 2);
});

test('timelineDuration', () => {
  assert.equal(timelineDuration([]), 0);
  assert.equal(timelineDuration(buildTimeline({ F: [{ offsetMs: 7, data: 0 }, { offsetMs: 42, data: 1 }] })), 42);
});

test('property: incremental slicing covers every record exactly once, in order', () => {
  const r = rng(2024);
  for (let trial = 0; trial < 200; trial++) {
    const byFeed: Record<string, any[]> = { A: [], B: [], C: [] };
    const feeds = Object.keys(byFeed);
    const total = randInt(r, 60);
    for (let i = 0; i < total; i++) {
      byFeed[feeds[randInt(r, feeds.length)]].push({ offsetMs: randInt(r, 1000), data: i });
    }
    const tl = buildTimeline(byFeed);
    assert.equal(tl.length, total);
    // Walk the timeline in random target steps; concatenation must equal the full timeline.
    let idx = 0;
    let target = 0;
    const seen: any[] = [];
    while (idx < tl.length) {
      target += randInt(r, 150);
      const s = sliceUntil(tl, idx, target);
      for (const rec of s.records) seen.push(rec);
      idx = s.nextIndex;
      if (target > 1000 && idx < tl.length) {
        // guarantee termination: jump past the end
        const fin = sliceUntil(tl, idx, Number.MAX_SAFE_INTEGER);
        for (const rec of fin.records) seen.push(rec);
        idx = fin.nextIndex;
      }
    }
    assert.equal(seen.length, tl.length);
    for (let i = 0; i < tl.length; i++) assert.equal(seen[i], tl[i]);
    // sorted non-decreasing
    for (let i = 1; i < tl.length; i++) assert.ok(tl[i].offsetMs >= tl[i - 1].offsetMs);
  }
});

test('property: full rebuild from 0 (seek-back) yields all records ≤ target', () => {
  const r = rng(55);
  for (let trial = 0; trial < 200; trial++) {
    const recs = Array.from({ length: randInt(r, 40) }, (_, i) => ({ offsetMs: randInt(r, 500), data: i }));
    const tl = buildTimeline({ F: recs });
    const target = randInt(r, 500);
    const s = sliceUntil(tl, 0, target);
    const expected = tl.filter((e) => e.offsetMs <= target);
    assert.equal(s.records.length, expected.length);
    assert.ok(s.records.every((rec) => rec.offsetMs <= target));
  }
});
