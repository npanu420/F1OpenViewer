import type { Layout } from 'react-grid-layout';

/** Keep slot identities stable so rearranging a panel does not recreate its player. */
export function movePanel(layout: Layout, id: string, direction: -1 | 1): Layout {
  const ordered = [...layout].sort((a, b) => a.y - b.y || a.x - b.x);
  const index = ordered.findIndex((item) => item.i === id);
  const target = ordered[index + direction];
  const source = ordered[index];
  if (!source || !target) return layout;
  // Swapping complete cells also works for panels with different dimensions.
  return layout.map((item) => {
    const position = item.i === source.i ? target : item.i === target.i ? source : null;
    return position ? { ...item, x: position.x, y: position.y, w: position.w, h: position.h } : item;
  });
}

export function nextPanelId(layout: Layout): string {
  const ids = new Set(layout.map((item) => item.i));
  let index = 0;
  while (ids.has(`slot-${index}`)) index++;
  return `slot-${index}`;
}

export const layoutPresets = {
  single: [{ x: 0, y: 0, w: 12, h: 8 }],
  focus: [{ x: 0, y: 0, w: 8, h: 8 }, { x: 8, y: 0, w: 4, h: 4 }, { x: 8, y: 4, w: 4, h: 4 }],
  equal: [{ x: 0, y: 0, w: 6, h: 5 }, { x: 6, y: 0, w: 6, h: 5 }, { x: 0, y: 5, w: 6, h: 5 }, { x: 6, y: 5, w: 6, h: 5 }],
} as const;

export function applyLayoutPreset(layout: Layout, preset: keyof typeof layoutPresets): Layout {
  const used = [...layout];
  return layoutPresets[preset].map((position, index) => {
    const id = layout[index]?.i ?? nextPanelId(used);
    const cell = { i: id, ...position, minW: 2, minH: 2 };
    used.push(cell);
    return cell;
  });
}
