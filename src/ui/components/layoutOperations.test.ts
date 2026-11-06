import { describe, expect, it } from 'vitest';
import type { Layout } from 'react-grid-layout';
import { applyLayoutPreset, movePanel, nextPanelId } from './layoutOperations';

const original: Layout = [
  { i: 'slot-0', x: 0, y: 0, w: 8, h: 8, minW: 2, minH: 2 },
  { i: 'slot-2', x: 8, y: 0, w: 4, h: 4, minW: 2, minH: 2 },
  { i: 'slot-3', x: 8, y: 4, w: 4, h: 4, minW: 2, minH: 2 },
];

describe('layout editing', () => {
  it('reuses an available ID after removal without duplicating surviving slots', () => {
    expect(nextPanelId(original)).toBe('slot-1');
  });
  it('moves unequal panels without overlap, preserving player identity and the original snapshot', () => {
    const before = structuredClone(original);
    const moved = movePanel(original, 'slot-2', -1);
    expect(moved.map((item) => item.i)).toEqual(original.map((item) => item.i));
    expect(moved[1]).toMatchObject({ x: 0, y: 0, w: 8, h: 8 });
    expect(moved[0]).toMatchObject({ x: 8, y: 0, w: 4, h: 4 });
    expect(original).toEqual(before);
    expect(movePanel(moved, 'slot-2', 1)).toEqual(original);
  });
  it('keeps boundary moves unchanged', () => {
    expect(movePanel(original, 'slot-0', -1)).toBe(original);
    expect(movePanel(original, 'slot-3', 1)).toBe(original);
  });
  it('expands a saved layout with unique IDs while keeping existing panels', () => {
    const next = applyLayoutPreset(original, 'equal');
    expect(next.slice(0, 3).map((item) => item.i)).toEqual(original.map((item) => item.i));
    expect(new Set(next.map((item) => item.i)).size).toBe(4);
    expect(next.every((item) => item.x + item.w <= 12 && item.y >= 0)).toBe(true);
  });
  it('reduces to one panel without mutating the cancellable snapshot', () => {
    expect(applyLayoutPreset(original, 'single')).toEqual([{ i: 'slot-0', x: 0, y: 0, w: 12, h: 8, minW: 2, minH: 2 }]);
    expect(original).toHaveLength(3);
  });
});
