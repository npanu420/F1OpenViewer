import { expect, test } from 'vitest';
import { snapLayoutItemToStreamAspect } from './gridAspect';

test.each([1024, 1440, 1920])('fits video without changing default column placement at width %s', (width) => {
  const item = { i: 'slot-1', x: 8, y: 0, w: 4, h: 3, minW: 2, minH: 2 };
  const fitted = snapLayoutItemToStreamAspect(item, item, 16 / 9, width, 80, 88, 12);
  const col = (width - 12 * 11) / 12;
  const pixelWidth = Math.round(col * fitted.w + 12 * (fitted.w - 1));
  const pixelHeight = fitted.h * 80 + (fitted.h - 1) * 12;
  expect((pixelWidth - 2) / (pixelHeight - 88)).toBeCloseTo(16 / 9, 6);
  expect(fitted.x).toBe(item.x);
  expect(fitted.w).toBe(item.w);
});

test('invalid video dimensions leave the layout intact', () => {
  const item = { i: 'a', x: 0, y: 0, w: 8, h: 7 };
  expect(snapLayoutItemToStreamAspect(item, item, NaN, 1440, 80, 88, 12)).toBe(item);
});

test('vertical resize changes width and keeps it inside the grid', () => {
  const old = { i: 'a', x: 0, y: 0, w: 4, h: 3 };
  const result = snapLayoutItemToStreamAspect({ ...old, h: 6 }, old, 16 / 9, 1440, 80, 88, 12);
  expect(result.w).toBeGreaterThan(old.w);
  expect(result.x + result.w).toBeLessThanOrEqual(12);
});
