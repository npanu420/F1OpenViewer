import { test, expect } from 'vitest';
import { solveTiling } from './autoTiling';

const ASPECT = 16 / 9;

function expectExactAspect(frames: Array<{ width: number; height: number }>) {
  for (const f of frames) expect(f.width / f.height).toBeCloseTo(ASPECT, 6);
}

function expectInside(frames: Array<{ x: number; y: number; width: number; height: number }>, W: number, H: number) {
  for (const f of frames) {
    expect(f.x).toBeGreaterThanOrEqual(-1e-6);
    expect(f.y).toBeGreaterThanOrEqual(-1e-6);
    expect(f.x + f.width).toBeLessThanOrEqual(W + 1e-6);
    expect(f.y + f.height).toBeLessThanOrEqual(H + 1e-6);
  }
}

function expectNoOverlap(frames: Array<{ x: number; y: number; width: number; height: number }>) {
  for (let i = 0; i < frames.length; i++) {
    for (let j = i + 1; j < frames.length; j++) {
      const a = frames[i];
      const b = frames[j];
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      expect(overlapX > 1e-6 && overlapY > 1e-6).toBe(false);
    }
  }
}

test('invalid input yields no arrangement', () => {
  expect(solveTiling({ width: 0, height: 500, maxTiles: 3 })).toBeNull();
  expect(solveTiling({ width: 800, height: 0, maxTiles: 3 })).toBeNull();
  expect(solveTiling({ width: 800, height: 500, maxTiles: 0 })).toBeNull();
});

test('a single stream fills a 16:9 area completely', () => {
  const r = solveTiling({ width: 1600, height: 900, maxTiles: 1 })!;
  expect(r.frames).toHaveLength(1);
  expect(r.coverage).toBeCloseTo(1, 6);
  expect(r.frames[0]).toEqual({ x: 0, y: 0, width: 1600, height: 900 });
});

test('tiles keep the exact video aspect, stay inside the area and never overlap', () => {
  for (const [W, H] of [[1600, 900], [1920, 800], [1100, 900], [900, 1200], [2560, 1300], [640, 400]]) {
    for (const maxTiles of [1, 2, 3, 5, 8, 22]) {
      const r = solveTiling({ width: W, height: H, maxTiles });
      if (!r) continue;
      expect(r.frames.length).toBeLessThanOrEqual(maxTiles);
      expectExactAspect(r.frames);
      expectInside(r.frames, W, H);
      expectNoOverlap(r.frames);
    }
  }
});

test('a wide area is split into several tiles instead of letterboxing one', () => {
  const r = solveTiling({ width: 1700, height: 720, maxTiles: 20 })!;
  // One 16:9 tile would cover 75% of this area.
  expect(r.family).toBe('m3-0');
  expect(r.coverage).toBeGreaterThan(0.95);
  // Column tiles stack exactly to the main height.
  const [main, ...column] = r.frames;
  const last = column[column.length - 1];
  expect(last.y + last.height - column[0].y).toBeCloseTo(main.height, 6);
  expect(column[0].x).toBeCloseTo(main.x + main.width + 8, 6);
});

test('tiles narrower than the minimum are rejected', () => {
  const loose = solveTiling({ width: 500, height: 300, maxTiles: 20, minTileWidth: 220 })!;
  expect(loose.frames).toHaveLength(4);
  const strict = solveTiling({ width: 500, height: 300, maxTiles: 20, minTileWidth: 260 })!;
  expect(strict.frames.length).toBeLessThan(4);
  if (strict.frames.length > 1) for (const f of strict.frames) expect(f.width).toBeGreaterThanOrEqual(260);
});

test('an exact count is honoured even below the minimum tile width', () => {
  const r = solveTiling({ width: 500, height: 300, maxTiles: 20, count: 5 })!;
  expect(r.frames).toHaveLength(5);
  expectExactAspect(r.frames);
  expectInside(r.frames, 500, 300);
});

test('an unreachable exact count falls back to the largest smaller one', () => {
  // 23 tiles: beyond every main + side block + row arrangement and not an r x c grid.
  const r = solveTiling({ width: 1600, height: 900, maxTiles: 40, count: 23 })!;
  expect(r.frames.length).toBeLessThan(23);
  expect(r.frames.length).toBeGreaterThanOrEqual(16);
});

test('a large main tile is preferred over equal tiles when it covers almost as much', () => {
  // 16:9 area: four equal tiles cover 98%, main + 2 column + 3 row covers about the same.
  const r = solveTiling({ width: 1600, height: 900, maxTiles: 20 })!;
  expect(r.family).toBe('m2-3');
  const [main, ...rest] = r.frames;
  for (const f of rest) expect(main.width * main.height).toBeGreaterThan(1.8 * f.width * f.height);
  // Too few streams for that: equal tiles.
  expect(solveTiling({ width: 1600, height: 900, maxTiles: 4, preferredCount: 4 })!.frames).toHaveLength(4);
});

test('the preferred count breaks near ties', () => {
  // With one or four streams wanted and no dominant-main arrangement available (max 4 tiles).
  expect(solveTiling({ width: 1600, height: 900, maxTiles: 4, preferredCount: 1 })!.frames).toHaveLength(1);
  expect(solveTiling({ width: 1600, height: 900, maxTiles: 4, preferredCount: 4 })!.frames).toHaveLength(4);
  // Never more tiles than streams.
  expect(solveTiling({ width: 1600, height: 900, maxTiles: 2, preferredCount: 4 })!.frames.length).toBeLessThanOrEqual(2);
});

test('the arrangement is centred in the leftover space', () => {
  const r = solveTiling({ width: 1000, height: 1000, maxTiles: 1 })!;
  expect(r.frames[0].x).toBeCloseTo(0, 6);
  expect(r.frames[0].y).toBeCloseTo((1000 - 1000 / ASPECT) / 2, 6);
});

test('the main tile is never smaller than another tile', () => {
  for (const [width, height] of [[1600, 900], [900, 1200], [700, 1000], [1200, 500], [2200, 700], [520, 900]]) {
    for (let count = 1; count <= 8; count++) {
      for (const options of [{ maxTiles: 20, count }, { maxTiles: count }]) {
        const r = solveTiling({ width, height, ...options });
        if (!r) continue;
        const [main, ...rest] = r.frames;
        for (const f of rest) expect(f.width * f.height).toBeLessThanOrEqual(main.width * main.height * 1.001);
      }
    }
  }
});

test('ultrawide areas are filled with a multi-column side block', () => {
  const r = solveTiling({ width: 3400, height: 1190, maxTiles: 20, count: 7 })!;
  expect(r.family).toBe('m3x2-0');
  expect(r.coverage).toBeGreaterThan(0.94);
  for (const f of r.frames) expect(f.width / f.height).toBeCloseTo(ASPECT, 5);
});

test('a minimum count is kept, and exceeded only when that fills the area clearly better', () => {
  // 3 tiles already fill a 2.7:1 area: asking for at least 3 stays at 3.
  expect(solveTiling({ width: 3400, height: 1250, maxTiles: 20, preferredCount: 3, minCount: 3 })!.frames.length).toBe(3);
  // 5 tiles would leave about a fifth of it empty: more tiles are used instead.
  const five = solveTiling({ width: 3400, height: 1250, maxTiles: 20, preferredCount: 5, minCount: 5 })!;
  expect(five.frames.length).toBe(6);
  expect(five.coverage).toBeGreaterThan(0.95);
  // A count that already fills the area is kept exactly.
  expect(solveTiling({ width: 1416, height: 800, maxTiles: 20, preferredCount: 4, minCount: 4 })!.frames.length).toBe(4);
  expect(solveTiling({ width: 1416, height: 800, maxTiles: 20, preferredCount: 8, minCount: 8 })!.frames.length).toBe(8);
});

test('while dragging, the arrangement on screen is kept as long as it is nearly as good', () => {
  // Find where the best arrangement changes, then wobble the edge around that point.
  let edge = 900;
  const first = solveTiling({ width: edge, height: 820, maxTiles: 20, count: 5 })!.family;
  while (solveTiling({ width: edge, height: 820, maxTiles: 20, count: 5 })!.family === first) edge += 1;
  const wobble = (keep: boolean) => {
    let family: string | null = null;
    let changes = 0;
    for (let i = 0; i < 40; i++) {
      const width = edge + (i % 2 === 0 ? -6 : 6);
      const r = solveTiling({ width, height: 820, maxTiles: 20, count: 5, keepFamily: keep ? family : null, keepTolerance: 0.08 })!;
      if (family && r.family !== family) changes++;
      family = r.family;
    }
    return changes;
  };
  expect(wobble(false)).toBeGreaterThan(30);
  expect(wobble(true)).toBe(0);
  // A kept arrangement is never much worse than the best one.
  const best = solveTiling({ width: 1700, height: 820, maxTiles: 20, count: 5 })!;
  for (const other of ['g2x3', 'm4-0', 'm2-2', 'm1-3']) {
    const kept = solveTiling({ width: 1700, height: 820, maxTiles: 20, count: 5, keepFamily: other, keepTolerance: 0.08 })!;
    expect(kept.coverage).toBeGreaterThanOrEqual(best.coverage - 0.08);
    expect(kept.frames.length).toBe(best.frames.length);
  }
});
