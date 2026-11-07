import type { LayoutItem } from 'react-grid-layout';
import { calcGridColWidth, calcGridItemWHPx } from 'react-grid-layout/core';
const GRID_MARGIN = [12, 12] as const;
const GRID_CONTAINER_PADDING = [0, 0] as const;

export function snapLayoutItemToStreamAspect(
  item: LayoutItem,
  oldItem: LayoutItem,
  streamAspectRatio: number,
  containerWidth: number,
  rowHeight: number,
  chromeTopPx: number,
  cols: number
): LayoutItem {
  if (!Number.isFinite(streamAspectRatio) || streamAspectRatio <= 0) return item;

  const colWidth = calcGridColWidth({
    margin: GRID_MARGIN,
    containerPadding: GRID_CONTAINER_PADDING,
    containerWidth,
    cols,
    rowHeight,
    maxRows: 1_000_000,
  });

  let w = item.w;
  let h = item.h;
  const x = item.x;
  const minW = item.minW ?? 1;
  const minH = item.minH ?? 1;

  const dw = Math.abs(w - oldItem.w);
  const dh = Math.abs(h - oldItem.h);

  if (dh > dw) {
    const slotH = calcGridItemWHPx(h, rowHeight, GRID_MARGIN[1]);
    const contentH = Math.max(1, slotH - chromeTopPx);
    const targetContentW = contentH * streamAspectRatio;
    const targetSlotW = Math.max(1, targetContentW);
    w = Math.round((targetSlotW + GRID_MARGIN[0]) / (colWidth + GRID_MARGIN[0]));
  }

  w = Math.max(minW, w);
  w = Math.min(w, cols - x);
  w = Math.max(minW, w);

  // Preserve the chosen column width; fractional rows avoid up to half a row of letterboxing.
  const slotWidth = calcGridItemWHPx(w, colWidth, GRID_MARGIN[0]);
  h = Math.max(minH, ((slotWidth - 2) / streamAspectRatio + chromeTopPx + GRID_MARGIN[1]) / (rowHeight + GRID_MARGIN[1]));
  return { ...item, w, h, x };
}
