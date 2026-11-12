import React, { useRef, useCallback, useState, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Plus, GripVertical, ChevronRight, X, MoreHorizontal, Check } from 'lucide-react';
import type { EventCallback, Layout, LayoutItem } from 'react-grid-layout';
import { calcGridColWidth, calcGridItemWHPx } from 'react-grid-layout/core';
import { ReactGridLayout, WidthProvider } from 'react-grid-layout/legacy';
import { useLocale } from '../../i18n/LocaleContext';
import type { CatalogItem } from '../../domain/catalog';
import type { PlaybackInfo } from '../../services/entitlement';
import { StreamPanel, type StreamPanelHandle } from './StreamPanel';

/** MIME type for DriverShelf drag onto a grid slot. */
export const DRIVER_SHELF_DRAG_TYPE = 'application/x-f1ov-stream-id';
/** MIME type for dragging an auto tile onto another one to swap them. */
const SLOT_DRAG_TYPE = 'application/x-f1ov-slot-id';

import 'react-grid-layout/css/styles.css';
import { snapLayoutItemToStreamAspect } from './gridAspect';
import { movePanel } from './layoutOperations';
import { AutoTileGrid } from './AutoTileGrid';
import { DriverHud } from './DriverHud';
import { useHudRows } from '../../services/driverHud';

// react-grid-layout 2.2.2 /legacy types disagree on ref callback (null vs undefined).
// Bug is in their .d.ts, not our usage. Hand-declare the props we pass to GridLayoutWithWidth.
interface GridLayoutWithWidthProps {
  className?: string;
  layout: Layout;
  onLayoutChange: (layout: Layout) => void;
  onResizeStop?: EventCallback;
  onResizeStart?: EventCallback;
  onDragStart?: EventCallback;
  onDragStop?: EventCallback;
  cols: number;
  rowHeight: number;
  margin: [number, number];
  containerPadding: [number, number];
  isDraggable?: boolean;
  isResizable?: boolean;
  draggableHandle?: string;
  resizeHandles?: string[];
  compactType?: 'vertical' | 'horizontal' | null;
  preventCollision?: boolean;
  useCSSTransforms?: boolean;
  autoSize?: boolean;
  children?: React.ReactNode;
}

const GridLayoutWithWidth = WidthProvider(ReactGridLayout) as unknown as React.ComponentType<GridLayoutWithWidthProps>;

export type StreamOption = {
  item: CatalogItem;
  label: string;
  type: 'main' | 'driver' | 'data';
  driverNumber?: number;
  driverName?: string;
  teamName?: string;
};

/** Default grid: big main (4/6), two 2/6 columns, four 1/2 rows. */
const DEFAULT_LAYOUT: Layout = [
  { i: 'slot-0', x: 0, y: 0, w: 8, h: 7, minW: 2, minH: 2 }, // 4/6 main
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

/** Fraction -> grid w/h (12 cols, ROWS_BASE rows). */
const COLS = 12;
const ROWS_BASE = 10;

/** Context-menu size presets, largest area first. */
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
/** Approx. chrome above the video before it is measured: slot header in layout flow + borders. */
const SLOT_CHROME_TOP_PX = 45;


interface ResizableStreamGridProps {
  editing?: boolean;
  onRemoveSlot?: (id: string) => void;
  streamOptions: StreamOption[];
  layout: Layout;
  onLayoutChange: (layout: Layout) => void;
  slotToItemId: Record<string, string>;
  onSlotToItemIdChange: (slotId: string, itemId: string) => void;
  embeddedPlayback: Record<string, PlaybackInfo>;
  loadingItemIds: Record<string, boolean>;
  onPlayEmbedded?: (item: CatalogItem) => void;
  onEmbedError?: (msg: string) => void;
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
  /** DriverShelf pick waiting for a slot click (fallback if drag-drop fails). */
  pickingItemId?: string | null;
  /** Slot consumed the pick (assigned or cancelled). */
  onPickingConsumed?: () => void;
  /** Auto layout (`AutoTileGrid`) instead of the 12-column grid; `layout` is ignored. */
  auto?: boolean;
  autoSlotIds?: string[];
  maxTiles?: number;
  preferredTiles?: number;
  onAutoCount?: (count: number) => void;
  autoFixedCount?: number | null;
  onSwapSlots?: (fromSlotId: string, toSlotId: string) => void;
  /** Draw the live-timing HUD over playing onboards (when timing rows are available). */
  showDriverHud?: boolean;
}

const NO_SLOTS: string[] = [];

const DEFAULT_ROW_HEIGHT = 80;
/** Minimum on-screen height change (px) that justifies re-laying out the grid. */
const REFIT_THRESHOLD_PX = 3;

function layoutHeightDeltaPx(a: number, b: number, rowHeight: number): number {
  return Math.abs(a - b) * (rowHeight + GRID_MARGIN[1]);
}

/** ABR renditions differ slightly (854x480 vs 1280x720): treat near-16:9 as exactly 16:9. */
function normalizeAspect(ar: number): number {
  return Math.abs(ar - 16 / 9) < 0.02 ? 16 / 9 : Math.round(ar * 1000) / 1000;
}

export function ResizableStreamGrid({
  streamOptions,
  editing = false,
  onRemoveSlot,
  layout,
  onLayoutChange,
  slotToItemId,
  onSlotToItemIdChange,
  embeddedPlayback,
  loadingItemIds,
  onPlayEmbedded,
  onEmbedError,
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
  pickingItemId = null,
  onPickingConsumed,
  auto = false,
  autoSlotIds = NO_SLOTS,
  maxTiles,
  preferredTiles = 3,
  onAutoCount,
  autoFixedCount = null,
  onSwapSlots,
  showDriverHud = false,
}: ResizableStreamGridProps) {
  const hudRows = useHudRows();
  const slotCount = auto ? autoSlotIds.length : layout.length;
  const { t } = useLocale();
  const refsByItemId = useRef<Map<string, StreamPanelHandle>>(new Map());
  /** Panel menu: at the pointer (right click) or under its "..." button. */
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; slotId: string; anchor: DOMRect | null } | null>(null);
  const [sizesSubmenuVisible, setSizesSubmenuVisible] = useState(false);
  const [streamListVisible, setStreamListVisible] = useState(false);
  const [dragOverSlotId, setDragOverSlotId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  /** Video aspect ratio for each active slot. */
  const [slotStreamAspectRatio, setSlotStreamAspectRatio] = useState<Record<string, number>>({});
  const prevSlotToItemId = useRef<Record<string, string>>({});
  /** Aspect metadata is reset when a slot changes stream, then fitted in a single layout update. */


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
    setSlotStreamAspectRatio((ratios) => {
      const next = { ...ratios };
      for (const sid of slotIds) {
        if (prev[sid] !== cur[sid]) delete next[sid];
      }
      return next;
    });
  }, [slotToItemId]);

  const [measuredChrome, setMeasuredChrome] = useState<Record<string, number>>({});
  /** True while the user drags or resizes a panel: auto-fit must not fight the gesture. */
  const resizing = useRef(false);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || auto) return;
    const measure = () => {
      const next: Record<string, number> = {};
      el.querySelectorAll<HTMLElement>('[data-slot-id]').forEach((slot) => {
        let height = 4; // Slot and StreamPanel borders.
        slot.querySelectorAll<HTMLElement>('[data-stream-header], .grid-slot-header').forEach((header) => {
          // offsetHeight: integer and immune to transforms/animations, so sub-pixel noise can't retrigger a refit.
          if (getComputedStyle(header).position !== 'absolute') height += header.offsetHeight;
        });
        next[slot.dataset.slotId!] = height;
      });
      setMeasuredChrome((prev) => JSON.stringify(prev) === JSON.stringify(next) ? prev : next);
    };
    const observer = new ResizeObserver(measure);
    el.querySelectorAll('[data-stream-header], .grid-slot-header').forEach((header) => observer.observe(header));
    measure();
    return () => observer.disconnect();
  }, [auto, hideSlotHeadersUntilHover, editing, slotToItemId, layout.length]);
  const chromeTopPx = hideSlotHeadersUntilHover ? 4 : SLOT_CHROME_TOP_PX;

  const rowHeight =
    disableCompact && containerWidth > 0
      ? Math.max(20, (containerWidth / 12) * 0.65)
      : DEFAULT_ROW_HEIGHT;

  // Fit all panels in one update, preserving widths and ordering. Refit when window
  // width, header visibility or video metadata changes, including fullscreen.
  const fitLayout = useCallback(
    (items: Layout): Layout =>
      items.map((li) =>
        snapLayoutItemToStreamAspect(li, li, slotStreamAspectRatio[li.i] ?? 16 / 9,
          containerWidth, rowHeight, measuredChrome[li.i] ?? chromeTopPx, COLS)
      ),
    [containerWidth, rowHeight, chromeTopPx, measuredChrome, slotStreamAspectRatio]
  );
  useEffect(() => {
    if (auto || containerWidth <= 0 || resizing.current) return;
    const fitted = fitLayout(layout);
    // Only apply changes visible on screen; tiny deltas just make panels jitter (CSS transition on every update).
    if (fitted.some((li, i) => layoutHeightDeltaPx(li.h, layout[i].h, rowHeight) >= REFIT_THRESHOLD_PX)) onLayoutChange(fitted);
  }, [auto, containerWidth, rowHeight, fitLayout, layout, onLayoutChange]);

  /**
   * react-grid-layout reports its compacted layout one update late, so after two quick refits it
   * echoes the first one and the panels bounce between the two forever. Outside a gesture the
   * reported layout is fitted again before it is stored.
   */
  const handleGridLayoutChange = useCallback(
    (next: Layout) => onLayoutChange(resizing.current || containerWidth <= 0 ? next : fitLayout(next)),
    [onLayoutChange, fitLayout, containerWidth]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, slotId: string, fromButton = false) => {
      e.preventDefault();
      e.stopPropagation();
      menuTriggerRef.current = e.currentTarget as HTMLElement;
      setSizesSubmenuVisible(false);
      setStreamListVisible(false);
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        slotId,
        anchor: fromButton ? (e.currentTarget as HTMLElement).getBoundingClientRect() : null,
      });
    },
    []
  );

  // Placed once its real size is known (it grows with a submenu), flipped or clamped to the window.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!contextMenu || !menu) return;
    const margin = 8;
    const { width, height } = menu.getBoundingClientRect();
    const { anchor } = contextMenu;
    let left = anchor ? anchor.right - width : contextMenu.x;
    let top = anchor ? anchor.bottom + 4 : contextMenu.y;
    if (top + height > window.innerHeight - margin) {
      top = anchor ? anchor.top - 4 - height : window.innerHeight - margin - height;
    }
    left = Math.max(margin, Math.min(left, window.innerWidth - margin - width));
    top = Math.max(margin, top);
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
    menu.style.visibility = 'visible';
  }, [contextMenu, sizesSubmenuVisible, streamListVisible]);

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
      resizing.current = false;
      if (!newItem || !oldItem || containerWidth <= 0) return;
      const ar = slotStreamAspectRatio[newItem.i] ?? 16 / 9;
      if (!ar || ar <= 0) return;
      const snapped = snapLayoutItemToStreamAspect(
        newItem,
        oldItem,
        ar,
        containerWidth,
        rowHeight,
        measuredChrome[newItem.i] ?? chromeTopPx,
        COLS
      );
      if (snapped.w === newItem.w && snapped.h === newItem.h) return;
      const nextLayout = layout.map((li) => (li.i === snapped.i ? snapped : li));
      onLayoutChange(nextLayout);
    },
    [containerWidth, rowHeight, chromeTopPx, measuredChrome, slotStreamAspectRatio, onLayoutChange]
  );

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => {
      setContextMenu(null);
      setSizesSubmenuVisible(false);
      setStreamListVisible(false);
    };
    menuRef.current?.querySelector('button')?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { close(); menuTriggerRef.current?.focus(); } };
    window.addEventListener('keydown', onKey);
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    return () => {
      window.removeEventListener('keydown', onKey);
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

  // Auto tiles are exactly 16:9, so their headers always overlay the video.
  const headerMode: 'flow' | 'hover' | 'overlay' = hideSlotHeadersUntilHover ? 'hover' : auto ? 'overlay' : 'flow';

  const renderSlot = (slotId: string) => {
    const itemId = slotToItemId[slotId] || '';
    const option = streamOptions.find((o) => o.item.id === itemId);
    const isDropTarget = dragOverSlotId === slotId;
    const isPickTarget = pickingItemId != null;
    const highlighted = isDropTarget || (isPickTarget && itemId !== pickingItemId);
    // The HUD names the driver itself, so it replaces the slot header (except while editing).
    const hudRow = showDriverHud && !editing && option?.type === 'driver' && option.driverNumber != null && embeddedPlayback[itemId]
      ? hudRows.find((row) => row.number === String(option.driverNumber)) ?? null
      : null;
    const menuButton = (
      <button type="button" className="ui-button ui-button-ghost !p-1 !min-h-7" aria-haspopup="menu" aria-label={`${t('experience.panelOptions')}: ${option?.label ?? slotId}`} onClick={(event) => handleContextMenu(event, slotId, true)}><MoreHorizontal className="w-4 h-4" /></button>
    );

    return (
      <div
        key={slotId}
        data-slot-id={slotId}
        data-target={highlighted ? 'true' : undefined}
        className={`grid-slot group relative overflow-hidden flex flex-col min-h-0 w-full h-full ${
          auto
            ? 'grid-slot-auto'
            : `rounded-lg border transition-colors bg-card ${highlighted ? 'border-primary ring-2 ring-primary/50' : 'border-border/50'}`
        } ${headerMode === 'hover' ? 'grid-slot-hide-header-until-hover' : ''} ${isPickTarget ? 'cursor-pointer' : ''}`}
        style={{ minHeight: 0 }}
        onContextMenu={(e) => handleContextMenu(e, slotId)}
        onDragOver={(e) => {
          const swap = auto && editing && e.dataTransfer.types.includes(SLOT_DRAG_TYPE);
          if (!swap && !e.dataTransfer.types.includes(DRIVER_SHELF_DRAG_TYPE)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = swap ? 'move' : 'copy';
          setDragOverSlotId(slotId);
        }}
        onDragLeave={() => setDragOverSlotId((cur) => (cur === slotId ? null : cur))}
        onDrop={(e) => {
          const fromSlotId = e.dataTransfer.getData(SLOT_DRAG_TYPE);
          if (fromSlotId) {
            e.preventDefault();
            setDragOverSlotId(null);
            if (fromSlotId !== slotId) onSwapSlots?.(fromSlotId, slotId);
            return;
          }
          const droppedId = e.dataTransfer.getData(DRIVER_SHELF_DRAG_TYPE);
          if (!droppedId) return;
          e.preventDefault();
          setDragOverSlotId(null);
          onSlotToItemIdChange(slotId, droppedId);
        }}
        onClick={() => {
          if (!pickingItemId) return;
          onSlotToItemIdChange(slotId, pickingItemId);
          onPickingConsumed?.();
        }}
      >
        {hudRow && <DriverHud row={hudRow}><span className="driver-hud-menu">{menuButton}</span></DriverHud>}
        {/* Slot header: drag, label, clear. Overlaid (absolute) unless it is in layout flow. */}
        <div
          hidden={hudRow != null}
          className={`grid-slot-header flex items-center gap-2 px-2 py-1.5 shrink-0 ${
            headerMode === 'flow'
              ? 'border-b border-border/50 bg-card'
              : `absolute top-0 left-0 right-0 z-10 ${auto ? 'grid-slot-header-overlay' : 'border-b border-border/50 bg-card'}`
          }`}
        >
          <div
            hidden={!editing}
            className="grid-drag-handle cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-0.5 touch-none"
            onClick={(e) => e.stopPropagation()}
            // Manual grid: react-grid-layout drags by this handle. Auto tiles: drop on another tile to swap.
            draggable={auto && editing}
            onDragStart={(e) => {
              if (!auto) return;
              e.dataTransfer.setData(SLOT_DRAG_TYPE, slotId);
              e.dataTransfer.effectAllowed = 'move';
              const tile = e.currentTarget.closest<HTMLElement>('[data-slot-id]');
              if (tile) e.dataTransfer.setDragImage(tile, 24, 16);
            }}
            onDragEnd={() => setDragOverSlotId(null)}
          >
            <GripVertical className="w-4 h-4" />
          </div>
          <span className="flex-1 min-w-0 text-xs font-medium truncate text-foreground">
            {option ? option.label : t('dashboard.gridEmptySlot')}
          </span>
          {option?.driverNumber != null && (
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">#{option.driverNumber}</span>
          )}
          {menuButton}
          {editing && onRemoveSlot && (
            <button
              type="button"
              aria-label={`${t('experience.removeSlot')}: ${option?.label ?? slotId}`}
              title={t('experience.removeSlot')}
              disabled={slotCount <= 1}
              onClick={(e) => {
                e.stopPropagation();
                onRemoveSlot(slotId);
              }}
              className="shrink-0 p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-40 disabled:pointer-events-none"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {isPickTarget && <button type="button" className="absolute inset-0 z-30 bg-black/60 text-white text-sm" onClick={(event) => { event.stopPropagation(); onSlotToItemIdChange(slotId, pickingItemId!); onPickingConsumed?.(); }}>{t('experience.chooseSlot')}</button>}
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
              onClick={() => onOpen?.(option.item)}
              fillHeight
              bare={auto}
              // The slot header already names the stream.
              hideHeader
              audioFocusedItemId={audioFocusedItemId}
              onAudioFocus={onAudioFocus}
              initialSeekSeconds={initialSeekSecondsByItemId?.[option.item.id]}
              onVideoIntrinsicSize={(vw, vh) => {
                if (vw <= 0 || vh <= 0) return;
                const ar = normalizeAspect(vw / vh);
                setSlotStreamAspectRatio((prev) =>
                  prev[slotId] === ar ? prev : { ...prev, [slotId]: ar });
              }}
            />
          ) : (
            <div className="flex-1 min-h-0 flex items-center justify-center w-full h-full">
              <button
                type="button"
                className="ui-button"
                aria-haspopup="menu"
                onClick={(event) => { handleContextMenu(event, slotId, true); setStreamListVisible(true); }}
              >
                <Plus className="w-4 h-4" aria-hidden />{t('experience.chooseStream')}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      className={`resizable-stream-grid ${auto || fillHeight ? 'flex-1 min-h-0 flex flex-col' : ''}`}
    >
      {auto ? (
        <AutoTileGrid
          slotIds={autoSlotIds}
          maxTiles={maxTiles ?? streamOptions.length}
          preferredCount={preferredTiles}
          fixedCount={autoFixedCount}
          onCountChange={(count) => onAutoCount?.(count)}
          renderTile={renderSlot}
        />
      ) : (
      <GridLayoutWithWidth
        className={`layout ${fillHeight ? 'flex-1 min-h-0' : ''}`}
        layout={layout}
        onLayoutChange={handleGridLayoutChange}
        onResizeStart={() => { resizing.current = true; }}
        onDragStart={() => { resizing.current = true; }}
        onDragStop={() => { resizing.current = false; }}
        onResizeStop={handleResizeStop}
        cols={12}
        rowHeight={rowHeight}
        margin={[GRID_MARGIN[0], GRID_MARGIN[1]]}
        containerPadding={[GRID_CONTAINER_PADDING[0], GRID_CONTAINER_PADDING[1]]}
        isDraggable={editing}
        isResizable={true}
        draggableHandle=".grid-drag-handle"
        resizeHandles={['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']}
        compactType="vertical"
        preventCollision={false}
        useCSSTransforms={true}
        autoSize={true}
      >
        {layout.map((item: LayoutItem) => renderSlot(item.i))}
      </GridLayoutWithWidth>
      )}

      {contextMenu && createPortal((() => {
        const menuSlotId = contextMenu.slotId;
        const itemId = slotToItemId[menuSlotId] || '';
        const closeMenu = () => { setContextMenu(null); setSizesSubmenuVisible(false); setStreamListVisible(false); };
        const assignedElsewhere = new Set(Object.entries(slotToItemId).filter(([slot, id]) => slot !== menuSlotId && id).map(([, id]) => id));
        const row = 'panel-menu-item';
        return (
          <div
            ref={menuRef}
            data-panel-menu
            role="menu" aria-label={t('experience.panelOptions')}
            className="panel-menu thin-scrollbar"
            // Positioned and revealed by the layout effect above.
            style={{ left: 0, top: 0, visibility: 'hidden' }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.stopPropagation()}
          >
            <button type="button" role="menuitem" aria-expanded={streamListVisible} className={`${row} justify-between`} onClick={() => setStreamListVisible((open) => !open)}>
              <span>{t('experience.changeStream')}</span>
              <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${streamListVisible ? 'rotate-90' : ''}`} aria-hidden />
            </button>
            {streamListVisible && (
              <div className="panel-menu-list thin-scrollbar">
                {streamOptions.map((o) => {
                  const current = o.item.id === itemId;
                  return (
                    <button
                      key={o.item.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={current}
                      className={`${row} ${current ? 'text-foreground' : assignedElsewhere.has(o.item.id) ? 'text-muted-foreground' : ''}`}
                      onClick={() => { if (!current) onSlotToItemIdChange(menuSlotId, o.item.id); closeMenu(); }}
                    >
                      <Check className={`w-3.5 h-3.5 shrink-0 ${current ? '' : 'invisible'}`} aria-hidden />
                      <span className="truncate">{o.label}</span>
                      {o.driverNumber != null && <span className="ml-auto pl-2 text-xs tabular-nums text-muted-foreground">#{o.driverNumber}</span>}
                    </button>
                  );
                })}
              </div>
            )}
            {itemId && onReloadStream && (
              <button type="button" role="menuitem" className={row} onClick={() => { onReloadStream(itemId); closeMenu(); }}>
                {t('dashboard.reloadStream')}
              </button>
            )}
            {itemId && !auto && (
              <button type="button" role="menuitem" className={row} onClick={() => { onSlotToItemIdChange(menuSlotId, ''); closeMenu(); }}>
                {t('dashboard.gridClearSlot')}
              </button>
            )}
            {editing && !auto && <>
              <div className="panel-menu-separator" />
              <button type="button" role="menuitem" aria-expanded={sizesSubmenuVisible} className={`${row} justify-between`} onClick={() => setSizesSubmenuVisible((open) => !open)}>
                <span>{t('dashboard.sizesSubmenu')}</span>
                <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${sizesSubmenuVisible ? 'rotate-90' : ''}`} aria-hidden />
              </button>
              {sizesSubmenuVisible && (
                <div className="panel-menu-list thin-scrollbar grid grid-cols-3">
                  {SIZE_RATIOS.map(({ num, den }) => (
                    <button key={`${num}-${den}`} type="button" role="menuitem" className={`${row} justify-center tabular-nums`} onClick={() => { applyRatio(menuSlotId, num, den); closeMenu(); }}>
                      {num}/{den}
                    </button>
                  ))}
                </div>
              )}
              <button type="button" role="menuitem" className={row} onClick={() => { onLayoutChange(movePanel(layout, menuSlotId, -1)); closeMenu(); }}>{t('experience.moveUp')}</button>
              <button type="button" role="menuitem" className={row} onClick={() => { onLayoutChange(movePanel(layout, menuSlotId, 1)); closeMenu(); }}>{t('experience.moveDown')}</button>
            </>}
            {onRemoveSlot && <>
              <div className="panel-menu-separator" />
              <button type="button" role="menuitem" className={`${row} text-destructive`} disabled={slotCount <= 1} onClick={() => { onRemoveSlot(menuSlotId); closeMenu(); }}>{t('experience.removeSlot')}</button>
            </>}
          </div>
        );
      })(), document.body)}

      {canAddSlot && onAddSlot && (
        <button
          type="button"
          onClick={onAddSlot}
          className="mt-3 shrink-0 flex items-center gap-2 py-2 px-3 rounded-lg border border-dashed border-border hover:bg-accent/30 text-muted-foreground hover:text-foreground text-sm font-heading transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('dashboard.gridAddSlot')}
        </button>
      )}
    </div>
  );
}
