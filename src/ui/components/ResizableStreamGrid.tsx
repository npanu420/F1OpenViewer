import React, { useRef, useCallback, useState, useEffect } from 'react';
import { Plus, GripVertical, ChevronRight } from 'lucide-react';
import type { EventCallback, Layout, LayoutItem } from 'react-grid-layout';
import { calcGridColWidth, calcGridItemWHPx } from 'react-grid-layout/core';
import { ReactGridLayout, WidthProvider } from 'react-grid-layout/legacy';
import { useLocale } from '../../i18n/LocaleContext';
import type { CatalogItem } from '../../domain/catalog';
import type { PlaybackInfo } from '../../services/entitlement';
import { StreamPanel, type StreamPanelHandle } from './StreamPanel';

import 'react-grid-layout/css/styles.css';

const GridLayoutWithWidth = WidthProvider(ReactGridLayout);

export type StreamOption = {
  item: CatalogItem;
  label: string;
  type: 'main' | 'driver' | 'data';
  driverNumber?: number;
};

/**
 * Initial multiview grid: main feed large (4/6), two onboard-sized columns (2/6), four half-width rows (1/2).
 * Every w×h matches ratioToGridSize for an entry in SIZE_RATIOS.
 */
const DEFAULT_LAYOUT: Layout = [
  { i: 'slot-0', x: 0, y: 0, w: 8, h: 7, minW: 2, minH: 2 }, // 4/6 — main
  { i: 'slot-1', x: 8, y: 0, w: 4, h: 3, minW: 2, minH: 2 }, // 2/6
  { i: 'slot-2', x: 8, y: 3, w: 4, h: 3, minW: 2, minH: 2 }, // 2/6
  { i: 'slot-3', x: 0, y: 7, w: 6, h: 5, minW: 2, minH: 2 }, // 1/2
  { i: 'slot-4', x: 6, y: 7, w: 6, h: 5, minW: 2, minH: 2 }, // 1/2
  { i: 'slot-5', x: 0, y: 12, w: 6, h: 5, minW: 2, minH: 2 }, // 1/2
  { i: 'slot-6', x: 6, y: 12, w: 6, h: 5, minW: 2, minH: 2 }, // 1/2
];

export function getDefaultGridLayout(): Layout {
  return DEFAULT_LAYOUT.map((item) => ({ ...item }));
}

/** (num, den) → grid w (12 cols), h (rows); ROWS_BASE scales vertical units. */
const COLS = 12;
const ROWS_BASE = 10;

/**
 * Preset size fractions for context menu, ordered by grid area (w×h) largest → smallest
 * (same formula as ratioToGridSize).
 */
export const SIZE_RATIOS: { num: number; den: number }[] = [
  { num: 3, den: 4 },
  { num: 4, den: 6 },
  { num: 2, den: 3 },
  { num: 3, den: 5 },
  { num: 1, den: 2 },
  { num: 2, den: 4 },
  { num: 3, den: 6 },
  { num: 2, den: 5 },
  { num: 2, den: 6 },
  { num: 1, den: 3 },
  { num: 1, den: 4 },
];

export function ratioToGridSize(num: number, den: number): { w: number; h: number } {
  const w = Math.max(1, Math.round((COLS * num) / den));
  const h = Math.max(1, Math.round((ROWS_BASE * num) / den));
  return { w, h };
}

/** Grid size for a newly added slot (preset 2/6). */
export function getDefaultNewSlotGridSize(): { w: number; h: number } {
  return ratioToGridSize(2, 6);
}

/** Horizontal + vertical gap between grid cells (must match GridLayoutWithWidth margin). */
const GRID_MARGIN: readonly [number, number] = [12, 12];
const GRID_CONTAINER_PADDING: readonly [number, number] = [0, 0];
/** Approx. chrome above the video: grid slot header + StreamPanel header when both in layout flow. */
const SLOT_CHROME_TOP_PX = 88;

function snapLayoutItemToStreamAspect(
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

  if (dw >= dh) {
    const slotW = calcGridItemWHPx(w, colWidth, GRID_MARGIN[0]);
    const contentW = Math.max(1, slotW);
    const targetContentH = contentW / streamAspectRatio;
    const targetSlotH = targetContentH + chromeTopPx;
    h = Math.round((targetSlotH + GRID_MARGIN[1]) / (rowHeight + GRID_MARGIN[1]));
  } else {
    const slotH = calcGridItemWHPx(h, rowHeight, GRID_MARGIN[1]);
    const contentH = Math.max(1, slotH - chromeTopPx);
    const targetContentW = contentH * streamAspectRatio;
    const targetSlotW = Math.max(1, targetContentW);
    w = Math.round((targetSlotW + GRID_MARGIN[0]) / (colWidth + GRID_MARGIN[0]));
  }

  w = Math.max(minW, w);
  h = Math.max(minH, h);
  w = Math.min(w, cols - x);
  w = Math.max(minW, w);

  return { ...item, w, h, x };
}

interface ResizableStreamGridProps {
  streamOptions: StreamOption[];
  layout: Layout;
  onLayoutChange: (layout: Layout) => void;
  slotToItemId: Record<string, string>;
  onSlotToItemIdChange: (slotId: string, itemId: string) => void;
  embeddedPlayback: Record<string, PlaybackInfo>;
  loadingItemIds: Record<string, boolean>;
  onPlayEmbedded?: (item: CatalogItem) => void;
  onEmbedError?: (msg: string) => void;
  accessToken?: string;
  onOpen?: (item: CatalogItem) => void;
  onRegisterPanelRef?: (itemId: string, ref: StreamPanelHandle | null) => void;
  onAddSlot?: () => void;
  canAddSlot?: boolean;
  /** In fullscreen: when true, slot headers (selector + drag) are hidden until hover */
  hideSlotHeadersUntilHover?: boolean;
  /** When true, grid container fills available height (e.g. fullscreen) */
  fillHeight?: boolean;
  /** Called when user picks a size ratio from context menu for a slot */
  onSetSlotSize?: (slotId: string, w: number, h: number) => void;
  /** Called when user chooses Reload from context menu for a slot that has a stream */
  onReloadStream?: (itemId: string) => void;
  /** In fullscreen: disable re-compaction so proportions stay the same when switching to fullscreen */
  disableCompact?: boolean;
  /** Itemt id of the panel that currently owns audio focus (only it is unmuted). */
  audioFocusedItemId?: string | null;
  /** Called when a panel claims audio focus (user un-mutes it). */
  onAudioFocus?: (itemId: string) => void;
  /** Per-item initial seek position (seconds) for porting playback into the standalone window. */
  initialSeekSecondsByItemId?: Record<string, number>;
}

const DEFAULT_ROW_HEIGHT = 80;

export function ResizableStreamGrid({
  streamOptions,
  layout,
  onLayoutChange,
  slotToItemId,
  onSlotToItemIdChange,
  embeddedPlayback,
  loadingItemIds,
  onPlayEmbedded,
  onEmbedError,
  accessToken,
  onOpen,
  onRegisterPanelRef,
  onAddSlot,
  canAddSlot = true,
  hideSlotHeadersUntilHover = false,
  fillHeight = false,
  onSetSlotSize,
  onReloadStream,
  disableCompact = false,
  audioFocusedItemId = null,
  onAudioFocus,
  initialSeekSecondsByItemId,
}: ResizableStreamGridProps) {
  const { t } = useLocale();
  const refsByItemId = useRef<Map<string, StreamPanelHandle>>(new Map());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; slotId: string } | null>(null);
  const [sizesSubmenuVisible, setSizesSubmenuVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  /** slotId → videoWidth/videoHeight ratio when the slot is playing */
  const [slotStreamAspectRatio, setSlotStreamAspectRatio] = useState<Record<string, number>>({});
  const prevSlotToItemId = useRef<Record<string, string>>({});
  /** slotIds already auto-fitted to their stream's aspect since the current stream was picked;
   *  reset when the slot's stream changes so a newly picked stream gets its own auto-fit. */
  const autoFittedSlots = useRef<Set<string>>(new Set());

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setContainerWidth(el.offsetWidth);
    });
    ro.observe(el);
    setContainerWidth(el.offsetWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const prev = prevSlotToItemId.current;
    const cur = slotToItemId;
    const slotIds = new Set([...Object.keys(prev), ...Object.keys(cur)]);
    let needsClear = false;
    for (const sid of slotIds) {
      if (prev[sid] !== cur[sid]) needsClear = true;
    }
    prevSlotToItemId.current = { ...cur };
    if (!needsClear) return;
    for (const sid of slotIds) {
      if (prev[sid] !== cur[sid]) autoFittedSlots.current.delete(sid);
    }
    setSlotStreamAspectRatio((ratios) => {
      const next = { ...ratios };
      for (const sid of slotIds) {
        if (prev[sid] !== cur[sid]) delete next[sid];
      }
      return next;
    });
  }, [slotToItemId]);

  const chromeTopPx = hideSlotHeadersUntilHover ? 0 : SLOT_CHROME_TOP_PX;

  const rowHeight =
    disableCompact && containerWidth > 0
      ? Math.max(20, (containerWidth / 12) * 0.65)
      : DEFAULT_ROW_HEIGHT;

  // DEFAULT_LAYOUT's h values are plain w:h ratios and don't account for the slot header's
  // pixel height, so the pristine default is never actually 16:9 once that chrome is subtracted
  // (hence bars on first load, before any stream reports its real aspect). Fix it once, at the
  // real container width, the same way manual resize already snaps to a stream's aspect.
  const defaultLayoutFixed = useRef(false);
  useEffect(() => {
    if (defaultLayoutFixed.current || containerWidth <= 0) return;
    defaultLayoutFixed.current = true;
    const isPristineDefault =
      layout.length === DEFAULT_LAYOUT.length &&
      layout.every((li, idx) => {
        const d = DEFAULT_LAYOUT[idx];
        return d && li.i === d.i && li.x === d.x && li.y === d.y && li.w === d.w && li.h === d.h;
      });
    if (!isPristineDefault) return;
    const fitted = layout.map((li) =>
      snapLayoutItemToStreamAspect(li, li, 16 / 9, containerWidth, rowHeight, chromeTopPx, COLS)
    );
    const changed = fitted.some((li, idx) => li.w !== layout[idx].w || li.h !== layout[idx].h);
    if (changed) onLayoutChange(fitted);
  }, [containerWidth, rowHeight, chromeTopPx, layout, onLayoutChange]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, slotId: string) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY, slotId });
    },
    []
  );

  const applyRatio = useCallback(
    (slotId: string, num: number, den: number) => {
      const ar = slotStreamAspectRatio[slotId];
      if (ar && ar > 0 && containerWidth > 0) {
        const colWidth = calcGridColWidth({
          margin: GRID_MARGIN,
          containerPadding: GRID_CONTAINER_PADDING,
          containerWidth,
          cols: COLS,
          rowHeight,
          maxRows: 1_000_000,
        });
        const targetW = Math.max(2, Math.round((COLS * num) / den));
        const slotW = calcGridItemWHPx(targetW, colWidth, GRID_MARGIN[0]);
        const targetContentH = slotW / ar;
        const targetSlotH = targetContentH + chromeTopPx;
        const targetH = Math.max(
          1,
          Math.round((targetSlotH + GRID_MARGIN[1]) / (rowHeight + GRID_MARGIN[1]))
        );
        onSetSlotSize?.(slotId, targetW, targetH);
      } else {
        const { w, h } = ratioToGridSize(num, den);
        onSetSlotSize?.(slotId, w, h);
      }
      setContextMenu(null);
    },
    [onSetSlotSize, slotStreamAspectRatio, containerWidth, rowHeight, chromeTopPx]
  );

  const handleResizeStop: EventCallback = useCallback(
    (layout, oldItem, newItem) => {
      if (!newItem || !oldItem || containerWidth <= 0) return;
      const ar = slotStreamAspectRatio[newItem.i];
      if (!ar || ar <= 0) return;
      const snapped = snapLayoutItemToStreamAspect(
        newItem,
        oldItem,
        ar,
        containerWidth,
        rowHeight,
        chromeTopPx,
        COLS
      );
      if (snapped.w === newItem.w && snapped.h === newItem.h) return;
      const nextLayout = layout.map((li) => (li.i === snapped.i ? snapped : li));
      onLayoutChange(nextLayout);
    },
    [containerWidth, rowHeight, chromeTopPx, slotStreamAspectRatio, onLayoutChange]
  );

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => {
      setContextMenu(null);
      setSizesSubmenuVisible(false);
    };
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
    };
  }, [contextMenu]);

  const registerRef = useCallback(
    (itemId: string, ref: StreamPanelHandle | null) => {
      if (ref) refsByItemId.current.set(itemId, ref);
      else refsByItemId.current.delete(itemId);
      onRegisterPanelRef?.(itemId, ref);
    },
    [onRegisterPanelRef]
  );

  return (
    <div
      ref={containerRef}
      className={`resizable-stream-grid ${fillHeight ? 'flex-1 min-h-0 flex flex-col' : ''}`}
    >
      <GridLayoutWithWidth
        className={`layout ${fillHeight ? 'flex-1 min-h-0' : ''}`}
        layout={layout}
        onLayoutChange={onLayoutChange}
        onResizeStop={handleResizeStop}
        cols={12}
        rowHeight={rowHeight}
        margin={[GRID_MARGIN[0], GRID_MARGIN[1]]}
        containerPadding={[GRID_CONTAINER_PADDING[0], GRID_CONTAINER_PADDING[1]]}
        isDraggable={true}
        isResizable={true}
        draggableHandle=".grid-drag-handle"
        resizeHandles={['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']}
        compactType={disableCompact ? null : 'vertical'}
        preventCollision={false}
        useCSSTransforms={true}
        autoSize={true}
      >
        {layout.map((item: LayoutItem) => {
          const slotId = item.i;
          const itemId = slotToItemId[slotId] || '';
          const option = streamOptions.find((o) => o.item.id === itemId);

          return (
            <div
              key={slotId}
              className={`grid-slot group relative rounded-lg border border-border/50 bg-card overflow-hidden flex flex-col min-h-0 w-full h-full ${hideSlotHeadersUntilHover ? 'grid-slot-hide-header-until-hover' : ''}`}
              style={{ minHeight: 0 }}
              onContextMenu={(e) => handleContextMenu(e, slotId)}
            >
              {/* Header: drag handle + stream selector — when hideSlotHeadersUntilHover it's absolute so content fills full height */}
              <div
                className={`grid-slot-header flex items-center gap-2 px-2 py-1.5 border-b border-border/50 shrink-0 bg-card transition-opacity duration-200 ${hideSlotHeadersUntilHover ? 'absolute top-0 left-0 right-0 z-10 opacity-0 group-hover:opacity-100 border-border/50' : ''}`}
              >
                <div className="grid-drag-handle cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-0.5 touch-none">
                  <GripVertical className="w-4 h-4" />
                </div>
                <select
                  className="flex-1 min-w-0 text-xs font-heading bg-accent/50 border border-border/50 rounded px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  value={itemId}
                  onChange={(e) => onSlotToItemIdChange(slotId, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                >
                  <option value="">{t('dashboard.gridEmptySlot')}</option>
                  {streamOptions.map((opt) => (
                    <option key={opt.item.id} value={opt.item.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Content: fills remaining height (or full height when header is absolute) */}
              <div className="flex-1 min-h-0 flex flex-col min-w-0 bg-black overflow-hidden">
                {option ? (
                  <StreamPanel
                    key={`${slotId}-${option.item.id}`}
                    ref={(r) => registerRef(option.item.id, r)}
                    label={option.label}
                    type={option.type}
                    driverNumber={option.driverNumber}
                    catalogItem={option.item}
                    playback={embeddedPlayback[option.item.id]}
                    loading={loadingItemIds[option.item.id]}
                    onPlayEmbedded={onPlayEmbedded}
                    onEmbedError={onEmbedError}
                    accessToken={accessToken}
                    onClick={() => onOpen?.(option.item)}
                    fillHeight
                    hideHeader={hideSlotHeadersUntilHover}
                    audioFocusedItemId={audioFocusedItemId}
                    onAudioFocus={onAudioFocus}
                    initialSeekSeconds={initialSeekSecondsByItemId?.[option.item.id]}
                    onVideoIntrinsicSize={(vw, vh) => {
                      if (vw <= 0 || vh <= 0) return;
                      const ar = vw / vh;
                      setSlotStreamAspectRatio((prev) => ({ ...prev, [slotId]: ar }));
                      // First real aspect for this stream: snap the slot's default/leftover size
                      // to match (keeps width, fits height) so it doesn't start out letterboxed.
                      if (!autoFittedSlots.current.has(slotId) && containerWidth > 0) {
                        autoFittedSlots.current.add(slotId);
                        const li = layout.find((l) => l.i === slotId);
                        if (li) {
                          const snapped = snapLayoutItemToStreamAspect(li, li, ar, containerWidth, rowHeight, chromeTopPx, COLS);
                          if (snapped.w !== li.w || snapped.h !== li.h) {
                            onLayoutChange(layout.map((l) => (l.i === slotId ? snapped : l)));
                          }
                        }
                      }
                    }}
                  />
                ) : (
                  <div className="flex-1 min-h-0 flex items-center justify-center carbon-texture w-full h-full">
                    <span className="text-[10px] text-muted-foreground font-heading tracking-wider">
                      {t('dashboard.gridSelectStream')}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </GridLayoutWithWidth>

      {contextMenu && (() => {
        const itemId = slotToItemId[contextMenu.slotId] || '';
        const hasStream = Boolean(itemId && onReloadStream);
        return (
          <div
            className="fixed z-[100] min-w-[140px] py-1 rounded-lg border border-border bg-popover shadow-lg"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {hasStream && (
              <>
                <button
                  type="button"
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent/50 transition-colors flex items-center gap-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    onReloadStream?.(itemId);
                    setContextMenu(null);
                  }}
                >
                  {t('dashboard.reloadStream')}
                </button>
                <div className="border-t border-border/50 my-1" />
              </>
            )}
            <div
              className="relative"
              onMouseEnter={() => setSizesSubmenuVisible(true)}
              onMouseLeave={() => setSizesSubmenuVisible(false)}
            >
              <div className="px-3 py-1.5 text-sm flex items-center justify-between hover:bg-accent/50 transition-colors">
                <span>{t('dashboard.sizesSubmenu')}</span>
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              {sizesSubmenuVisible && (
                <div
                  className="absolute left-full top-0 ml-0.5 min-w-[100px] py-1 rounded-lg border border-border bg-popover shadow-lg max-h-[70vh] overflow-y-auto"
                  onClick={(e) => e.stopPropagation()}
                >
                  {SIZE_RATIOS.map(({ num, den }) => (
                    <button
                      key={`${num}-${den}`}
                      type="button"
                      className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent/50 transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        applyRatio(contextMenu.slotId, num, den);
                        setContextMenu(null);
                        setSizesSubmenuVisible(false);
                      }}
                    >
                      {num}/{den}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {canAddSlot && onAddSlot && (
        <button
          type="button"
          onClick={onAddSlot}
          className="mt-3 flex items-center gap-2 py-2 px-3 rounded-lg border border-dashed border-border hover:bg-accent/30 text-muted-foreground hover:text-foreground text-sm font-heading transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('dashboard.gridAddSlot')}
        </button>
      )}
    </div>
  );
}
