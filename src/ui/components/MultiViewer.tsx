import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MoreHorizontal, RefreshCw, X, LayoutGrid, LayoutDashboard, Volume2, ChevronDown, ChevronUp, Plus, BarChart3 } from 'lucide-react';
import type { Layout } from 'react-grid-layout';
import { useLocale } from '../../i18n/LocaleContext';
import { MultiViewerCommandBar } from './MultiViewerCommandBar';
import { DriverShelf } from './DriverShelf';
import { StreamPicker } from './StreamPicker';
import { LayoutMenu } from './LayoutMenu';
import { LiveTimingDock, type DockSessionQuery } from './LiveTimingDock';

import { applyLayoutPreset, layoutPresets, manualLayoutForSlots, nextPanelId } from './layoutOperations';
import { orderAutoStreams, parseTimingStateKey, planAutoSlots, resizeAutoSlotIds, timingStateKey } from './autoSlots';
import { useFavoriteDrivers } from '../../services/favoriteDrivers';
import { getMultiviewBarCollapsed, setMultiviewBarCollapsed } from '../../services/headerSettings';
import { usePointerIdle } from '../hooks/usePointerIdle';
import { usePreferences } from '../../services/preferences';
import { emitLocalClock, hasLocalClockListeners, useHudSelector } from '../../services/driverHud';
import { DriverHudSource } from './DriverHudSource';

const SAVED_GRIDS_KEY = 'f1openviewer-saved-grids';
const STANDALONE_MULTIVIEW_KEY_BASE = 'f1openviewer-standalone-multiview';

/** Storage key for one multiview window. Per-instance (mv=N) so two windows don't collide. */
function standaloneStateKey(multiviewInstanceId?: number): string {
  if (multiviewInstanceId == null || !Number.isFinite(multiviewInstanceId)) {
    return STANDALONE_MULTIVIEW_KEY_BASE;
  }
  return `${STANDALONE_MULTIVIEW_KEY_BASE}:${multiviewInstanceId}`;
}

export type StandaloneMultiviewState = {
  layout: Layout;
  slotToItemId: Record<string, string>;
  session: import('../../domain/vod').VodSession;
  streams: import('../../services/vod').SessionStreams | null;
  seasonYear: number;
  /** PlaybackInfo for streams already playing when the popout opens (skip contentPlay). */
  embeddedPlayback?: Record<string, import('../../services/entitlement').PlaybackInfo>;
  /** Seek target (seconds) when porting a stream into the popout. */
  currentTimes?: Record<string, number>;
  /** Old snapshots only: which items were playing at save time. */
  playingItemIds?: string[];
  /** Live-timing session query of the source window (meeting/session info the popout can't derive). */
  liveTimingQuery?: DockSessionQuery;
  /** Absent in old snapshots, which were always manual. */
  autoLayout?: boolean;
  autoSlotIds?: string[];
  autoTileLimit?: number | null;
};

/** Saved layout slot: main, data index, or onboard by car number. Resolved at apply time. */
export type SlotAssignment =
  | { type: 'main' }
  | { type: 'data'; index: number }
  | { type: 'onboard'; racingNumber: number; driverName?: string };

export type SavedGrid = {
  id: string;
  name: string;
  layout: Layout;
  /** Old format: raw slot -> itemId map. */
  slotToItemId: Record<string, string>;
  /** New format: slot -> main/data/onboard assignment. */
  slotAssignments?: Record<string, SlotAssignment>;
};

function loadSavedGrids(): SavedGrid[] {
  try {
    const raw = localStorage.getItem(SAVED_GRIDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedGrid[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSavedGrids(grids: SavedGrid[]) {
  const raw = JSON.stringify(grids);
  try {
    localStorage.setItem(SAVED_GRIDS_KEY, raw);
  } catch (_) {}
  window.f1?.setSetting?.(SAVED_GRIDS_KEY, raw);
}

/** Build slotAssignments from a saved slotToItemId + current stream list. */
function buildSlotAssignments(
  slotToItemId: Record<string, string>,
  streamOptions: StreamOption[]
): Record<string, SlotAssignment> {
  const dataOptions = streamOptions.filter((o) => o.type === 'data');
  const onboardOptions = streamOptions.filter((o) => o.type === 'driver');
  const out: Record<string, SlotAssignment> = {};
  for (const [slotId, itemId] of Object.entries(slotToItemId)) {
    if (!itemId) continue;
    const opt = streamOptions.find((o) => o.item.id === itemId);
    if (!opt) continue;
    if (opt.type === 'main') {
      out[slotId] = { type: 'main' };
    } else if (opt.type === 'data') {
      const index = dataOptions.findIndex((o) => o.item.id === itemId);
      if (index >= 0) out[slotId] = { type: 'data', index };
    } else if (opt.type === 'driver') {
      out[slotId] = {
        type: 'onboard',
        racingNumber: opt.driverNumber ?? 0,
        driverName: opt.label,
      };
    }
  }
  return out;
}

/** Apply saved slotAssignments to current streams. Missing drivers stay empty. */
function resolveSlotAssignments(
  layout: Layout,
  slotAssignments: Record<string, SlotAssignment> | undefined,
  legacySlotToItemId: Record<string, string>,
  streamOptions: StreamOption[]
): Record<string, string> {
  const dataOptions = streamOptions.filter((o) => o.type === 'data');
  const onboardOptions = streamOptions.filter((o) => o.type === 'driver');
  const mainOption = streamOptions.find((o) => o.type === 'main');
  const result: Record<string, string> = {};

  for (const item of layout) {
    const slotId = item.i;
    if (slotAssignments && slotAssignments[slotId]) {
      const a = slotAssignments[slotId];
      if (a.type === 'main' && mainOption) {
        result[slotId] = mainOption.item.id;
      } else if (a.type === 'data' && dataOptions[a.index]) {
        result[slotId] = dataOptions[a.index].item.id;
      } else if (a.type === 'onboard') {
        const ob = onboardOptions.find((o) => o.driverNumber === a.racingNumber);
        result[slotId] = ob ? ob.item.id : '';
      } else {
        result[slotId] = '';
      }
    } else if (legacySlotToItemId[slotId]) {
      const itemId = legacySlotToItemId[slotId];
      const exists = streamOptions.some((o) => o.item.id === itemId);
      result[slotId] = exists ? itemId : '';
    } else {
      result[slotId] = '';
    }
  }
  return result;
}

export function saveStandaloneMultiviewState(
  state: StandaloneMultiviewState,
  multiviewInstanceId?: number
): void {
  try {
    const key = standaloneStateKey(multiviewInstanceId);
    localStorage.setItem(key, JSON.stringify(state));
    // Also write the unkeyed slot for the next opened window to pick up (it doesn't yet know its mv id).
    if (multiviewInstanceId != null) {
      localStorage.setItem(STANDALONE_MULTIVIEW_KEY_BASE, JSON.stringify(state));
    }
  } catch (_) {}
}

export function loadStandaloneMultiviewState(
  multiviewInstanceId?: number
): StandaloneMultiviewState | null {
  try {
    const candidates = [standaloneStateKey(multiviewInstanceId), STANDALONE_MULTIVIEW_KEY_BASE];
    for (const key of candidates) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        return JSON.parse(raw) as StandaloneMultiviewState;
      } catch {
        // try next
      }
    }
    return null;
  } catch {
    return null;
  }
}

import type { VodSession, VodOnboard } from '../../domain/vod';
import type { SessionStreams } from '../../services/vod';
import type { CatalogItem } from '../../domain/catalog';
import type { PlaybackInfo } from '../../services/entitlement';
import { sessionMatches } from '../../domain/clockFilter';
import type { StreamPanelHandle } from './StreamPanel';
import {
  ResizableStreamGrid,
  getDefaultGridLayout,
  getDefaultNewSlotGridSize,
  type StreamOption,
} from './ResizableStreamGrid';
import { SyncOverlay } from './SyncOverlay';
import { useSyncEngine } from '../hooks/useSyncEngine';
import { useMultiviewWindows } from '../hooks/useMultiviewWindows';

interface MultiViewerProps {
  session: VodSession;
  streams: SessionStreams | null;
  seasonYear: number;
  onOpen: (item: CatalogItem) => void;
  toCatalogItem: (session: VodSession, year: number) => CatalogItem;
  toCatalogItemOnboard: (ob: VodOnboard) => CatalogItem;
  embeddedPlayback?: Record<string, PlaybackInfo>;
  loadingItemIds?: Record<string, boolean>;
  onPlayEmbedded?: (item: CatalogItem) => void;
  onPlayAllEmbedded?: (items: CatalogItem[]) => void;
  onEmbedError?: (msg: string) => void;
  isFullscreen?: boolean;
  onEnterFullscreen?: () => void;
  /**
   * Parent gets stream IDs before the popout opens so it can stop playing them here.
   * Streams keep running only in the new window (no double decode/bandwidth).
   */
  onPortStreamsToWindow?: (transferredItemIds: string[]) => void;
  /** @deprecated use onPortStreamsToWindow. Kept for callsites that still need the broader hook. */
  onBeforeEnterFullscreen?: () => void;
  onExitFullscreen?: () => void;
  /** Standalone window: don't overwrite layout/slots from session effect. */
  initialLayout?: Layout;
  initialSlotToItemId?: Record<string, string>;
  /** Initial seek (seconds) when resuming a ported stream in the popout. */
  initialSeekSecondsByItemId?: Record<string, number>;
  /** Electron multiview window instance id (hash ?mv=). */
  multiviewInstanceId?: number;
  /** Live timing session info for popout + in-window dock. */
  liveTimingQuery?: DockSessionQuery;
  /** Stops streams that no longer have a panel. */
  onReleasePlayback?: (itemIds: string[]) => void;
  /** Standalone window: auto layout state of the source window. */
  initialAutoLayout?: boolean;
  initialAutoSlotIds?: string[];
  initialAutoTileLimit?: number | null;
}

export function MultiViewer({
  session,
  streams,
  seasonYear,
  onOpen,
  toCatalogItem,
  toCatalogItemOnboard,
  embeddedPlayback = {},
  loadingItemIds = {},
  onPlayEmbedded,
  onPlayAllEmbedded,
  onEmbedError,
  isFullscreen = false,
  onEnterFullscreen,
  onPortStreamsToWindow,
  onBeforeEnterFullscreen,
  onExitFullscreen,
  initialLayout,
  initialSlotToItemId,
  initialSeekSecondsByItemId,
  multiviewInstanceId,
  liveTimingQuery,
  onReleasePlayback,
  initialAutoLayout,
  initialAutoSlotIds,
  initialAutoTileLimit,
}: MultiViewerProps) {
  const { t } = useLocale();
  const multiviewOpenIds = useMultiviewWindows();
  const [canOpenMultiviewWindow, setCanOpenMultiviewWindow] = useState(false);
  const [liveTimingDockOpen, setLiveTimingDockOpen] = useState(false);
  /** A live timing window or dock is open in some window. */
  const [timingListening, setTimingListening] = useState(false);
  const favoriteDrivers = useFavoriteDrivers();
  const prefs = usePreferences();
  const openLiveTimingPopout = useCallback(() => {
    if (!liveTimingQuery) return;
    window.f1?.liveTiming
      ?.openWindow(liveTimingQuery)
      .catch((e) => onEmbedError?.(e?.message || 'Live timing unavailable.'));
  }, [liveTimingQuery, onEmbedError]);

  useEffect(() => {
    setCanOpenMultiviewWindow(typeof window.f1?.openMultiviewWindow === 'function');
  }, []);

  const mainItem = toCatalogItem(session, seasonYear);
  // Memoize streamOptions or DriverShelf's per-card effects loop forever.
  const streamOptions: StreamOption[] = useMemo(() => [
    { item: mainItem, label: session.title || t('ui.worldFeed'), type: 'main' },
    ...(streams?.dataChannel?.map((dc) => ({
      item: toCatalogItemOnboard(dc),
      label: dc.title,
      type: 'data' as const,
    })) ?? []),
    ...(streams?.onboard?.map((ob) => ({
      item: toCatalogItemOnboard(ob),
      label: ob.title || ob.driverName || `Onboard ${ob.racingNumber ?? ''}`,
      type: 'driver' as const,
      driverNumber: ob.racingNumber,
      driverName: ob.driverName,
      teamName: ob.teamName,
    })) ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [session.contentId, session.channelId, session.title, seasonYear, streams]);

  const allItems: CatalogItem[] = streamOptions.map((o) => o.item);
  const hasEmbedSupport = Boolean(onPlayEmbedded && onPlayAllEmbedded);
  const playingCount = allItems.filter((it) => embeddedPlayback[it.id]).length;
  const anyLoading = allItems.some((it) => loadingItemIds[it.id]);
  const hasMultipleStreams = allItems.length >= 2;
  const canSync = hasMultipleStreams && playingCount >= 2;
  const showSyncButton = hasMultipleStreams;

  const [layout, setLayout] = useState<Layout>(() => initialLayout ?? getDefaultGridLayout());
  const [slotToItemId, setSlotToItemId] = useState<Record<string, string>>(() => initialSlotToItemId ?? {});
  /** Auto layout (default): exact 16:9 tiles, count follows the area. Manual is the 12-column grid. */
  const [autoLayout, setAutoLayout] = useState(initialAutoLayout ?? true);
  const [autoSlotIds, setAutoSlotIds] = useState<string[]>(() => initialAutoSlotIds ?? []);
  const [preferredTiles, setPreferredTiles] = useState(3);
  /** Tile count picked by removing or adding panels; null means as many as fit. */
  const [autoTileLimit, setAutoTileLimit] = useState<number | null>(initialAutoTileLimit ?? null);
  /** Streams whose panel was removed; auto layout does not bring them back. */
  const [autoExcluded, setAutoExcluded] = useState<string[]>([]);
  const [layoutDraft, setLayoutDraft] = useState<{
    layout: Layout;
    mapping: Record<string, string>;
    auto: boolean;
    autoSlotIds: string[];
    autoTileLimit: number | null;
    autoExcluded: string[];
    pinned: string[];
  } | null>(null);
  /** Multiview window toolbar, hidden to give the streams the whole window (editing shows it). */
  const [barCollapsed, setBarCollapsed] = useState(() => getMultiviewBarCollapsed());
  /** Main window: app header, session bar and toolbar hidden so the streams get the height. */
  const [streamFocus, setStreamFocus] = useState(false);
  const collapsed = isFullscreen ? barCollapsed : streamFocus;
  const toggleBarCollapsed = () => {
    if (!isFullscreen) {
      setStreamFocus((v) => !v);
      return;
    }
    const next = !barCollapsed;
    setMultiviewBarCollapsed(next);
    setBarCollapsed(next);
  };
  // The header and session bar live outside this component; they hide through a body flag.
  useEffect(() => {
    if (isFullscreen || !streamFocus) return;
    document.body.dataset.streamFocus = 'true';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('dialog[open], [data-panel-menu]')) setStreamFocus(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      delete document.body.dataset.streamFocus;
      window.removeEventListener('keydown', onKey);
    };
  }, [isFullscreen, streamFocus]);
  const [layoutNotice, setLayoutNotice] = useState('');
  const editingLayout = layoutDraft != null;
  const visibleSlotIds = useMemo(
    () => (autoLayout ? autoSlotIds : layout.map((item) => item.i)),
    [autoLayout, autoSlotIds, layout]
  );
  // Live timing in this window (dock or headless source), reduced to what the auto layout uses.
  const timingKey = useHudSelector(timingStateKey);
  const smartLayout = prefs.smartAutoLayout && autoLayout;
  /** Auto layout stream priority (see orderAutoStreams). */
  const autoOrder = useMemo(
    () => orderAutoStreams(
      streamOptions
        .filter((o) => !autoExcluded.includes(o.item.id))
        .map((o) => ({ id: o.item.id, type: o.type, name: o.driverName || o.label, driverNumber: o.driverNumber })),
      favoriteDrivers,
      prefs.hideDataWithTiming && (liveTimingDockOpen || timingListening),
      smartLayout
        ? { drivers: parseTimingStateKey(timingKey), shown: new Set(autoSlotIds.map((slot) => slotToItemId[slot]).filter(Boolean)) }
        : null
    ),
    [streamOptions, autoExcluded, favoriteDrivers, liveTimingDockOpen, timingListening, prefs.hideDataWithTiming, smartLayout, timingKey, autoSlotIds, slotToItemId]
  );
  /** Panels filled by hand, left alone by auto layout. */
  const pinnedSlotsRef = useRef(new Set<string>());
  const latest = useRef({ autoLayout, autoSlotIds, slotToItemId, streamOptions, autoOrder, embeddedPlayback, loadingItemIds, onPlayEmbedded, favoriteDrivers, timingOpen: prefs.hideDataWithTiming && (liveTimingDockOpen || timingListening), layout });
  latest.current = { layout, autoLayout, autoSlotIds, slotToItemId, streamOptions, autoOrder, embeddedPlayback, loadingItemIds, onPlayEmbedded, favoriteDrivers, timingOpen: prefs.hideDataWithTiming && (liveTimingDockOpen || timingListening) };
  /** Start new tiles right away if this multiview is already playing. */
  const startAddedStreams = (added: string[]) => {
    const cur = latest.current;
    const isActive = (itemId: string) => Boolean(cur.embeddedPlayback[itemId] || cur.loadingItemIds[itemId]);
    if (!cur.onPlayEmbedded || !cur.streamOptions.some((o) => isActive(o.item.id))) return;
    for (const itemId of added) {
      const item = cur.streamOptions.find((o) => o.item.id === itemId)?.item;
      if (item) cur.onPlayEmbedded(item);
    }
  };

  const beginLayoutEdit = () => {
    // Auto layout is edited in place so the edit view matches what is shown. Free sizing is the
    // manual grid (a preset, or Auto off).
    setLayoutDraft({
      layout: layout.map((item) => ({ ...item })), mapping: { ...slotToItemId }, auto: autoLayout, autoSlotIds,
      autoTileLimit, autoExcluded, pinned: [...pinnedSlotsRef.current],
    });
    setLayoutNotice('');
  };
  const cancelLayoutEdit = () => {
    if (layoutDraft) {
      setLayout(layoutDraft.layout);
      setSlotToItemId(layoutDraft.mapping);
      setAutoSlotIds(layoutDraft.autoSlotIds);
      setAutoTileLimit(layoutDraft.autoTileLimit);
      setAutoExcluded(layoutDraft.autoExcluded);
      pinnedSlotsRef.current = new Set(layoutDraft.pinned);
      setAutoLayout(layoutDraft.auto);
    }
    setLayoutDraft(null);
  };
  const toggleAutoLayout = () => {
    if (autoLayout) {
      setLayout(manualLayoutForSlots(autoSlotIds));
      setAutoLayout(false);
      return;
    }
    // Main feed first, since the first auto tile is the big one; the rest in reading order.
    const mainId = streamOptions.find((o) => o.type === 'main')?.item.id;
    const isMain = (item: Layout[number]) => (mainId != null && slotToItemId[item.i] === mainId ? 0 : 1);
    const ordered = [...layout].sort((a, b) => isMain(a) - isMain(b) || a.y - b.y || a.x - b.x);
    const ids = ordered.map((item) => item.i);
    setAutoSlotIds(ids);
    setPreferredTiles(ids.length);
    setAutoTileLimit(null);
    setAutoExcluded([]);
    setAutoLayout(true);
  };
  const removeAutoSlot = (slotId: string) => {
    const cur = latest.current;
    if (cur.autoSlotIds.length <= 1 || !cur.autoSlotIds.includes(slotId)) return;
    const ids = cur.autoSlotIds.filter((id) => id !== slotId);
    const removedItem = cur.slotToItemId[slotId];
    pinnedSlotsRef.current.delete(slotId);
    setAutoSlotIds(ids);
    setAutoTileLimit(ids.length);
    setPreferredTiles(ids.length);
    if (removedItem) setAutoExcluded((prev) => (prev.includes(removedItem) ? prev : [...prev, removedItem]));
    setSlotToItemId((prev) => { const next = { ...prev }; delete next[slotId]; return next; });
  };
  /** Swap two auto tiles by moving slot ids, so neither player reloads. */
  const swapAutoSlots = (a: string, b: string) => {
    const cur = latest.current;
    const ia = cur.autoSlotIds.indexOf(a);
    const ib = cur.autoSlotIds.indexOf(b);
    if (ia < 0 || ib < 0 || ia === ib) return;
    const ids = [...cur.autoSlotIds];
    [ids[ia], ids[ib]] = [ids[ib], ids[ia]];
    for (const id of [a, b]) if (cur.slotToItemId[id]) pinnedSlotsRef.current.add(id);
    setAutoSlotIds(ids);
  };
  const applyAutoSlots = useCallback((count: number) => {
    const cur = latest.current;
    if (!cur.autoLayout) return;
    const ids = resizeAutoSlotIds(cur.autoSlotIds, count);
    for (const slot of [...pinnedSlotsRef.current]) if (!ids.includes(slot)) pinnedSlotsRef.current.delete(slot);
    const { mapping, added } = planAutoSlots(ids, cur.slotToItemId, cur.autoOrder, pinnedSlotsRef.current);
    setAutoSlotIds(ids);
    setSlotToItemId(mapping);
    // The re-plan effect below reads this ref.
    latest.current = { ...cur, autoSlotIds: ids, slotToItemId: mapping };
    startAddedStreams(added);
  }, []);
  // Re-plan when the priority changes (streams loaded, favourite toggled, timing opened).
  const autoOrderKey = autoOrder.join('|');
  const plannedOrderKeyRef = useRef(autoOrderKey);
  const plannedSessionRef = useRef(session.contentId);
  useEffect(() => {
    if (plannedSessionRef.current !== session.contentId) {
      plannedSessionRef.current = session.contentId;
      pinnedSlotsRef.current.clear();
      setAutoExcluded([]);
    }
    if (plannedOrderKeyRef.current === autoOrderKey) return;
    plannedOrderKeyRef.current = autoOrderKey;
    const cur = latest.current;
    if (!cur.autoLayout || cur.autoSlotIds.length === 0) return;
    const { mapping, added } = planAutoSlots(cur.autoSlotIds, cur.slotToItemId, cur.autoOrder, pinnedSlotsRef.current);
    setSlotToItemId(mapping);
    latest.current = { ...cur, slotToItemId: mapping };
    startAddedStreams(added);
  }, [autoOrderKey, session.contentId]);
  useEffect(() => { setLayoutDraft(null); setLayoutNotice(''); }, [session.contentId]);
  useEffect(() => {
    if (!layoutNotice) return;
    const id = window.setTimeout(() => setLayoutNotice(''), 3000);
    return () => window.clearTimeout(id);
  }, [layoutNotice]);
  const [savedGrids, setSavedGrids] = useState<SavedGrid[]>(() => loadSavedGrids());
  const [audioFocusedItemId, setAudioFocusedItemId] = useState<string | null>(null);
  const panelRefsByItemId = useRef<Map<string, StreamPanelHandle>>(new Map());
  // Start with the main feed's audio on, when the user asked for it: once per session, after its player exists.
  const startAudioDoneRef = useRef<number | null>(null);
  const mainPlaying = Boolean(embeddedPlayback[mainItem.id]);
  useEffect(() => {
    if (prefs.startAudio !== 'main' || !mainPlaying || startAudioDoneRef.current === session.contentId) return;
    let tries = 0;
    const id = window.setInterval(() => {
      const video = panelRefsByItemId.current.get(mainItem.id)?.getVideoElement();
      if (video || ++tries > 40) window.clearInterval(id);
      if (!video) return;
      startAudioDoneRef.current = session.contentId;
      for (const [itemId, panel] of panelRefsByItemId.current) {
        const other = panel.getVideoElement();
        if (other) other.muted = itemId !== mainItem.id;
      }
      setAudioFocusedItemId(mainItem.id);
    }, 250);
    return () => window.clearInterval(id);
  }, [prefs.startAudio, mainPlaying, mainItem.id, session.contentId]);

  // Relay the main-feed clock to live timing windows. Ref mirror keeps the interval stable.
  // Drift correction between streams is owned solely by useSyncEngine (a second corrector here
  // used to fight it: it reset playbackRate while the engine was nudging it).
  const clockSrcRef = useRef({ mainId: '', slotToItemId: {} as Record<string, string>, embeddedPlayback, audioFocusedItemId: null as string | null });
  clockSrcRef.current = { mainId: mainItem.id, slotToItemId, embeddedPlayback, audioFocusedItemId };
  const sessionContentIdRef = useRef(session.contentId);
  sessionContentIdRef.current = session.contentId;
  // Only relay while a timing window or dock listens (main pushes changes). Unknown = relay.
  const clockListenersRef = useRef(true);
  useEffect(() => {
    const lt = window.f1?.liveTiming;
    const update = (has: boolean) => { clockListenersRef.current = has; setTimingListening(has); };
    lt?.hasClockListeners?.().then(update).catch(() => {});
    return lt?.onClockListeners?.(update);
  }, []);
  useEffect(() => {
    const lt = window.f1?.liveTiming;
    const id = window.setInterval(() => {
      // The driver HUD's own timing source lives in this window and listens locally.
      const local = hasLocalClockListeners();
      if (!clockListenersRef.current && !local) return;
      const { mainId, slotToItemId: s2i, embeddedPlayback: emb } = clockSrcRef.current;
      if (!mainId || !emb[mainId]) return;                       // main feed not playing
      if (!Object.values(s2i).includes(mainId)) return;          // not mapped to a slot
      const panel = panelRefsByItemId.current.get(mainId);
      const v = panel?.getVideoElement?.();
      if (!v || !Number.isFinite(v.currentTime)) return;

      // Live timing: DASH has wall clock for auto-sync; HLS falls back to session_start.
      const clock = { timeSec: v.currentTime, paused: v.paused, wallClockMs: panel?.getWallClockMs?.() ?? null, contentId: sessionContentIdRef.current };
      if (clockListenersRef.current) lt?.reportClock?.(clock);
      if (local) emitLocalClock(clock);
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const lt = window.f1?.liveTiming;
    if (!lt?.onSeekRequest) return;
    return lt.onSeekRequest(({ timeSec, contentId }) => {
      if (!sessionMatches(sessionContentIdRef.current, contentId)) return; // another session's timing bar
      const { mainId, slotToItemId: s2i, embeddedPlayback: emb } = clockSrcRef.current;
      if (!mainId || !emb[mainId] || !Object.values(s2i).includes(mainId)) return;
      const v = panelRefsByItemId.current.get(mainId)?.getVideoElement?.();
      if (!v || !Number.isFinite(timeSec)) return;
      try { v.currentTime = timeSec; } catch (_) {}
    });
  }, []);

  const handleAudioFocus = useCallback((itemId: string) => {
    setAudioFocusedItemId(itemId);
  }, []);

  const {
    startSync,
    closeOverlay,
    minimizeOverlay,
    restoreOverlay,
    syncStatus,
    syncStreams,
    showSyncOverlay,
    isSyncEngineRunning,
  } = useSyncEngine();

  // Fill default slots when session/streams change. Skip if standalone passed its own layout.
  useEffect(() => {
    if (initialLayout != null && initialSlotToItemId != null) return;

    const baseLayout = getDefaultGridLayout();
    setLayout(baseLayout);

    const main = toCatalogItem(session, seasonYear);
    const orderedItems: CatalogItem[] = [
      main,
      ...(streams?.dataChannel?.map((dc) => toCatalogItemOnboard(dc)) ?? []),
      ...(streams?.onboard?.map((ob) => toCatalogItemOnboard(ob)) ?? []),
    ];

    // Auto layout: the re-plan effect assigns the streams.
    if (latest.current.autoLayout) return;

    const initialMapping: Record<string, string> = {};
    baseLayout.forEach((slot, index) => {
      const item = orderedItems[index];
      if (item) initialMapping[slot.i] = item.id;
    });

    setSlotToItemId(initialMapping);
  }, [session.contentId, seasonYear, streams, initialLayout, initialSlotToItemId]);

  const handleRegisterPanelRef = useCallback((itemId: string, ref: StreamPanelHandle | null) => {
    if (ref) panelRefsByItemId.current.set(itemId, ref);
    else panelRefsByItemId.current.delete(itemId);
  }, []);

  const handleSlotToItemIdChange = useCallback((slotId: string, itemId: string) => {
    // Placed by hand, so auto layout keeps it here.
    if (itemId) pinnedSlotsRef.current.add(slotId);
    else pinnedSlotsRef.current.delete(slotId);
    if (itemId) setAutoExcluded((prev) => (prev.includes(itemId) ? prev.filter((id) => id !== itemId) : prev));
    setSlotToItemId((prev) => {
      const next = { ...prev };
      // One player per stream: it leaves its previous panel.
      if (itemId) for (const key of Object.keys(next)) if (next[key] === itemId) next[key] = '';
      next[slotId] = itemId;
      return next;
    });
  }, []);

  /** Streams list click: add the stream to the grid, or take its panel out. */
  const toggleStreamShown = (itemId: string) => {
    const cur = latest.current;
    const visible = cur.autoLayout ? cur.autoSlotIds : cur.layout.map((cell) => cell.i);
    const shownIn = visible.find((slot) => cur.slotToItemId[slot] === itemId);
    if (shownIn) {
      if (visible.length <= 1) return;
      if (cur.autoLayout) {
        removeAutoSlot(shownIn);
      } else {
        setLayout((current) => current.filter((cell) => cell.i !== shownIn));
        setSlotToItemId((current) => { const next = { ...current }; delete next[shownIn]; return next; });
      }
      return;
    }
    const empty = visible.find((slot) => !cur.slotToItemId[slot]);
    if (empty) {
      handleSlotToItemIdChange(empty, itemId);
    } else if (cur.autoLayout) {
      const ids = resizeAutoSlotIds(cur.autoSlotIds, cur.autoSlotIds.length + 1);
      const slot = ids[ids.length - 1];
      for (const id of ids) if (id === slot || cur.slotToItemId[id]) pinnedSlotsRef.current.add(id);
      setAutoSlotIds(ids);
      setAutoTileLimit(ids.length >= cur.streamOptions.length ? null : ids.length);
      setPreferredTiles(ids.length);
      setAutoExcluded((prev) => prev.filter((id) => id !== itemId));
      setSlotToItemId((prev) => ({ ...prev, [slot]: itemId }));
    } else {
      const { w, h } = getDefaultNewSlotGridSize();
      const slot = nextPanelId(cur.layout);
      const maxY = Math.max(0, ...cur.layout.map((cell) => cell.y + cell.h));
      setLayout((current) => [...current, { i: slot, x: 0, y: maxY, w, h, minW: 2, minH: 2 }]);
      setSlotToItemId((prev) => ({ ...prev, [slot]: itemId }));
    }
    startAddedStreams([itemId]);
  };

  function handleSync(silent?: boolean) {
    const entries: Array<{
      id: string;
      label: string;
      getVideo: () => HTMLVideoElement | null;
      isMainFeed?: boolean;
    }> = [];
    for (const [, itemId] of Object.entries(slotToItemId)) {
      if (!itemId || !embeddedPlayback[itemId]) continue;
      const option = streamOptions.find((o) => o.item.id === itemId);
      if (!option) continue;
      entries.push({
        id: itemId,
        label: option.label,
        // Looked up on every call: a panel that remounts (slot moved, reload) registers a new handle.
        getVideo: () => panelRefsByItemId.current.get(itemId)?.getVideoElement() ?? null,
  // Main feed is always sync reference, even if an onboard is ahead.
        isMainFeed: option.type === 'main',
      });
    }
    startSync(entries, { silent });
  }

  // Auto-sync on new streams only (not reload/seek). Debounced for Play All.
  const latestPrefsRef = useRef(prefs);
  latestPrefsRef.current = prefs;
  const prevPlayingIdsRef = useRef<Set<string>>(new Set());
  const autoSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const curIds = new Set(Object.keys(embeddedPlayback));
    const prevIds = prevPlayingIdsRef.current;
    let hasNewStart = false;
    for (const id of curIds) {
      if (!prevIds.has(id)) { hasNewStart = true; break; }
    }
    prevPlayingIdsRef.current = curIds;
    if (!hasNewStart || curIds.size < 2 || !latestPrefsRef.current.autoSync) return;

    if (autoSyncTimerRef.current != null) clearTimeout(autoSyncTimerRef.current);
    autoSyncTimerRef.current = setTimeout(() => {
      autoSyncTimerRef.current = null;
      handleSync(true); // auto-triggered: run in the background, no popup to dismiss
    }, 500);
  }, [embeddedPlayback]);
  useEffect(() => () => {
    if (autoSyncTimerRef.current != null) clearTimeout(autoSyncTimerRef.current);
  }, []);

  const handleAddSlot = useCallback(() => {
    const { w, h } = getDefaultNewSlotGridSize();
    const cur = latest.current;
    if (cur.autoLayout) {
      const ids = resizeAutoSlotIds(cur.autoSlotIds, cur.autoSlotIds.length + 1);
      const order = orderAutoStreams(
        cur.streamOptions.map((o) => ({ id: o.item.id, type: o.type, name: o.driverName || o.label })),
        cur.favoriteDrivers,
        cur.timingOpen
      );
      for (const id of cur.autoSlotIds) if (cur.slotToItemId[id]) pinnedSlotsRef.current.add(id);
      const { mapping, added } = planAutoSlots(ids, cur.slotToItemId, order, pinnedSlotsRef.current);
      // Keeps the priority effect from re-planning right after.
      plannedOrderKeyRef.current = order.join('|');
      setAutoExcluded([]);
      setAutoSlotIds(ids);
      setAutoTileLimit(ids.length >= cur.streamOptions.length ? null : ids.length);
      setPreferredTiles(ids.length);
      setSlotToItemId(mapping);
      startAddedStreams(added);
      return;
    }
    setLayout((prev) => {
      const maxY = Math.max(0, ...prev.map((item) => item.y + item.h));
      const nextId = nextPanelId(prev);
      return [...prev, { i: nextId, x: 0, y: maxY, w, h, minW: 2, minH: 2 }];
    });
  }, []);

  const handleSetSlotSize = useCallback((slotId: string, w: number, h: number) => {
    setLayout((prev) =>
      prev.map((item) =>
        item.i === slotId ? { ...item, w, h } : item
      )
    );
  }, []);

  const handleSaveCurrentLayout = useCallback((rawName: string) => {
    setLayoutNotice(t('experience.layoutSaved'));
    const name = rawName.trim() || t('dashboard.savedLayoutDefaultName');
    const slotAssignments = buildSlotAssignments(slotToItemId, streamOptions);
    const next: SavedGrid = {
      id: crypto.randomUUID?.() ?? `grid-${Date.now()}`,
      name,
      layout: (autoLayout ? manualLayoutForSlots(autoSlotIds) : layout).map((item) => ({ ...item })),
      slotToItemId: { ...slotToItemId },
      slotAssignments,
    };
    setSavedGrids((prev) => {
      const list = [...prev, next];
      saveSavedGrids(list);
      return list;
    });
  }, [layout, autoLayout, autoSlotIds, slotToItemId, streamOptions, t]);

  const handleApplySavedGrid = useCallback(
    (preset: SavedGrid) => {
      setLayoutNotice(t('experience.layoutApplied'));
      setAutoLayout(false);
      setLayout(preset.layout.map((item) => ({ ...item })));
      const resolved = resolveSlotAssignments(
        preset.layout,
        preset.slotAssignments,
        preset.slotToItemId,
        streamOptions
      );
      setSlotToItemId(resolved);
    },
    [streamOptions]
  );

  const handleDeleteSavedGrid = useCallback((id: string) => {
    setSavedGrids((prev) => {
      const next = prev.filter((g) => g.id !== id);
      saveSavedGrids(next);
      return next;
    });
  }, []);

  const [hideSlotTitles, setHideSlotTitles] = useState(true);
  const [pickingItemId, setPickingItemId] = useState<string | null>(null);
  const assignedItemIds = useMemo(
    () => new Set(visibleSlotIds.map((slotId) => slotToItemId[slotId]).filter(Boolean)),
    [visibleSlotIds, slotToItemId]
  );
  // Streams that left the grid stop playing, except while editing (Cancel restores the panels).
  useEffect(() => {
    if (editingLayout || visibleSlotIds.length === 0) return;
    const unused = Object.keys(embeddedPlayback).filter((itemId) => !assignedItemIds.has(itemId));
    if (unused.length === 0) return;
    onReleasePlayback?.(unused);
    setAudioFocusedItemId((current) => (current && unused.includes(current) ? null : current));
  }, [embeddedPlayback, assignedItemIds, editingLayout, visibleSlotIds.length, onReleasePlayback]);
  const playingItemIds = useMemo(() => new Set(Object.keys(embeddedPlayback)), [embeddedPlayback]);
  const [showPlayAllLoadingHint, setShowPlayAllLoadingHint] = useState(false);
  const [fullscreenToolbarOpen, setFullscreenToolbarOpen] = useState(false);
  const fullscreenToolbarRef = useRef<HTMLDivElement>(null);
  const fullscreenToolbarToggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!showPlayAllLoadingHint) return;
    const id = window.setTimeout(() => setShowPlayAllLoadingHint(false), 5500);
    return () => clearTimeout(id);
  }, [showPlayAllLoadingHint]);

  const handlePlayAllEmbedded = useCallback(() => {
    setShowPlayAllLoadingHint(true);
    // Only streams with a panel: resolving every onboard is slow.
    onPlayAllEmbedded?.(allItems.filter((item) => assignedItemIds.has(item.id)));
  }, [onPlayAllEmbedded, allItems, assignedItemIds]);

  useEffect(() => {
    if (!isFullscreen || !onExitFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (fullscreenToolbarOpen) {
          setFullscreenToolbarOpen(false);
        } else {
          onExitFullscreen();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFullscreen, onExitFullscreen, fullscreenToolbarOpen]);

  useEffect(() => {
    if (!isFullscreen) setFullscreenToolbarOpen(false);
  }, [isFullscreen]);

  useEffect(() => {
    if (!fullscreenToolbarOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (fullscreenToolbarRef.current?.contains(t)) return;
      if (fullscreenToolbarToggleRef.current?.contains(t)) return;
      setFullscreenToolbarOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [fullscreenToolbarOpen]);

  // "Waiting for main feed": ref is buffering, engine paused everyone else. Detect via sync output
  // (non-ref streams idle at rate 1, ref marked done).
  const refStream = syncStreams.find((s) => s.isReference);
  const nonRefStreams = syncStreams.filter((s) => !s.isReference);
  const isWaitingForMain =
    syncStatus === 'done' &&
    refStream != null &&
    nonRefStreams.length > 0 &&
    nonRefStreams.every((s) => !s.done && Math.abs(s.rate - 1) < 0.001);

  // keepLocked leaves the engine "running" after done; hide the badge after a few seconds anyway.
  const [badgeDismissed, setBadgeDismissed] = useState(false);
  useEffect(() => {
    if (syncStatus === 'syncing' || isWaitingForMain) {
      setBadgeDismissed(false);
      return;
    }
    if (syncStatus === 'done') {
      const id = setTimeout(() => setBadgeDismissed(true), 3000);
      return () => clearTimeout(id);
    }
  }, [syncStatus, isWaitingForMain]);
  // Minimized sync badge while engine runs and overlay is hidden.
  const showMinimizedSyncBadge = isSyncEngineRunning && !showSyncOverlay && !badgeDismissed;

  const streamsPicker = (
    <StreamPicker streamOptions={streamOptions} shownItemIds={assignedItemIds} playingItemIds={playingItemIds} onToggle={toggleStreamShown} />
  );
  const layoutMenu = (
    <LayoutMenu
      autoLayout={autoLayout}
      onToggleAuto={toggleAutoLayout}
      showNames={!hideSlotTitles}
      onToggleNames={() => setHideSlotTitles((v) => !v)}
      onEdit={beginLayoutEdit}
      savedGrids={savedGrids}
      onSaveLayout={handleSaveCurrentLayout}
      onApplyLayout={handleApplySavedGrid}
      onDeleteLayout={handleDeleteSavedGrid}
    />
  );
  const editControls = (
    <>
      <button type="button" className="ui-button ui-primary" onClick={() => setLayoutDraft(null)}>{t('experience.done')}</button>
      <button type="button" className="ui-button" onClick={cancelLayoutEdit}>{t('experience.cancel')}</button>
      {autoLayout && <p className="min-w-0 text-xs text-muted-foreground">{t('experience.autoEditHint')}</p>}
    </>
  );
  const audioSelect = (
    <label className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
      <Volume2 className="w-4 h-4 shrink-0" aria-hidden /><span>{t('experience.audio')}</span>
      <select className="ui-input w-[150px] truncate" aria-label={t('experience.audio')} value={audioFocusedItemId ?? ''} onChange={(event) => {
        const id = event.target.value;
        for (const [itemId, panel] of panelRefsByItemId.current) {
          const video = panel.getVideoElement();
          if (video) video.muted = itemId !== id;
        }
        setAudioFocusedItemId(id || null);
      }}>
        <option value="">{t('experience.muted')}</option>
        {streamOptions.filter((option) => embeddedPlayback[option.item.id] && assignedItemIds.has(option.item.id)).map((option) => <option key={option.item.id} value={option.item.id}>{option.label}</option>)}
      </select>
    </label>
  );

  // Driver HUD over onboards: only worth computing while an onboard is actually playing.
  const onboardPlaying = streamOptions.some((o) => o.type === 'driver' && assignedItemIds.has(o.item.id) && embeddedPlayback[o.item.id]);
  const hudWanted = prefs.driverHud !== 'off' && !editingLayout && onboardPlaying
    && (prefs.driverHud === 'always' || liveTimingDockOpen || timingListening);
  // The smart auto layout needs timing too, while streams play (car telemetry is left out then).
  const layoutWantsTiming = smartLayout && playingCount > 0 && streamOptions.some((o) => o.type === 'driver');
  const idle = usePointerIdle((isFullscreen || streamFocus) && prefs.autoHideSeconds > 0, prefs.autoHideSeconds * 1000) && !fullscreenToolbarOpen;
  const toggleDock = () => setLiveTimingDockOpen((v) => !v);
  const timingToggle = liveTimingQuery && (
    <button type="button" className="ui-button" aria-pressed={liveTimingDockOpen} onClick={toggleDock} title={t('timing.dockTitle')}>
      <BarChart3 className="w-4 h-4" aria-hidden />{t('timing.title')}
    </button>
  );
  const presetButtons = (Object.keys(layoutPresets) as Array<keyof typeof layoutPresets>).map((preset) => (
    <button key={preset} type="button" className="ui-button layout-preset" onClick={() => {
      // Presets are manual grids; the auto panels move into them.
      setLayout((current) => applyLayoutPreset(autoLayout ? manualLayoutForSlots(autoSlotIds) : current, preset));
      setAutoLayout(false);
    }}>
      <svg viewBox="0 0 120 100" aria-hidden>{layoutPresets[preset].map((cell, index) => <rect key={index} x={cell.x * 10 + 2} y={cell.y * 9 + 2} width={cell.w * 10 - 4} height={cell.h * 9 - 4} rx="3" fill="currentColor" opacity={index === 0 ? .8 : .3} />)}</svg>
      {t(`experience.${preset}`)}
    </button>
  ));

  return (
    <>
      <SyncOverlay
        isOpen={showSyncOverlay}
        status={syncStatus}
        streams={syncStreams}
        onClose={closeOverlay}
        onMinimize={minimizeOverlay}
      />

      <AnimatePresence>
        {showMinimizedSyncBadge && (
          <motion.button
            type="button"
            onClick={restoreOverlay}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.18 }}
            className="fixed bottom-4 right-4 z-[58] flex items-center gap-2 px-3 py-2 rounded-full border border-border/60 bg-background/95 shadow-lg hover:bg-accent/40 transition-colors"
            title={isWaitingForMain ? t('sync.runningBadgeBuffering') : syncStatus === 'done' ? t('sync.synced') : t('sync.runningBadge')}
            aria-label={isWaitingForMain ? t('sync.runningBadgeBuffering') : syncStatus === 'done' ? t('sync.synced') : t('sync.runningBadge')}
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${syncStatus === 'syncing' || isWaitingForMain ? 'animate-spin text-primary' : 'text-emerald-400'}`}
            />
            <span className="font-heading text-[11px] font-bold tracking-wider">
              {isWaitingForMain ? t('sync.runningBadgeBuffering') : syncStatus === 'done' ? t('sync.synced') : t('sync.runningBadge')}
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      <div className="multiview-workspace flex-1 min-h-0 flex items-stretch gap-3" data-idle={idle ? 'true' : undefined}>
      {/* Positioned: the fullscreen floating controls stay over the video, clear of the timing dock. */}
      <div className="relative flex-1 min-w-0 flex flex-col min-h-0">
      <AnimatePresence mode="wait">
        <motion.div
          key={session.contentId}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className={`flex-1 flex flex-col min-h-0 ${isFullscreen ? '' : 'gap-3'}`}
        >
          {isFullscreen && (!barCollapsed || editingLayout) && (
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 pr-14">
              {streamsPicker}
              {editingLayout ? editControls : layoutMenu}
              <div className="ml-auto min-w-0">{audioSelect}</div>
              {timingToggle}
              {!editingLayout && (
                <button type="button" className="ui-button ui-button-ghost !px-2" onClick={toggleBarCollapsed} title={t('experience.hideToolbar')} aria-label={t('experience.hideToolbar')}>
                  <ChevronUp className="w-4 h-4" aria-hidden />
                </button>
              )}
            </div>
          )}
          {(isFullscreen || streamFocus) && (
            // Fade out when the pointer rests, so nothing sits on top of the video.
            <div className="floating-controls" data-idle={idle ? 'true' : undefined}>
              {collapsed && !editingLayout && liveTimingQuery && (
                <button type="button" className="floating-control" aria-pressed={liveTimingDockOpen} onClick={toggleDock} title={t('timing.dockTitle')} aria-label={t('timing.dockTitle')}>
                  <BarChart3 className="h-5 w-5" aria-hidden />
                </button>
              )}
              {collapsed && !editingLayout && (
                <button type="button" className="floating-control" onClick={toggleBarCollapsed} title={isFullscreen ? t('experience.showToolbar') : t('experience.showControls')} aria-label={isFullscreen ? t('experience.showToolbar') : t('experience.showControls')}>
                  <ChevronDown className="h-5 w-5" aria-hidden />
                </button>
              )}
              {isFullscreen && onExitFullscreen && (
                <button
                  ref={fullscreenToolbarToggleRef}
                  type="button"
                  onClick={() => setFullscreenToolbarOpen((v) => !v)}
                  title={fullscreenToolbarOpen ? t('dashboard.fullscreenToolbarHide') : t('dashboard.fullscreenToolbarShow')}
                  aria-label={fullscreenToolbarOpen ? t('dashboard.fullscreenToolbarHide') : t('dashboard.fullscreenToolbarShow')}
                  aria-expanded={fullscreenToolbarOpen}
                  className="floating-control"
                >
                  {fullscreenToolbarOpen ? <X className="h-5 w-5" aria-hidden /> : <MoreHorizontal className="h-5 w-5" aria-hidden />}
                </button>
              )}
            </div>
          )}
          {hasEmbedSupport && allItems.length > 0 && !isFullscreen && !streamFocus && (
            <MultiViewerCommandBar
              variant="bar"
              leading={editingLayout ? editControls : streamsPicker}
              trailing={audioSelect}
              menu={<>{layoutMenu}<button type="button" className="ui-button !px-2.5" onClick={toggleBarCollapsed} title={t('experience.hideControls')} aria-label={t('experience.hideControls')}><ChevronUp className="w-4 h-4" aria-hidden /></button></>}
              hasEmbedSupport={hasEmbedSupport}
              hasStreams={streamOptions.length > 0}
              anyLoading={anyLoading}
              onPlayAll={handlePlayAllEmbedded}
              showSyncButton={showSyncButton}
              canSync={canSync}
              syncStatus={syncStatus}
              onSync={() => handleSync()}
              hideSlotTitles={hideSlotTitles}
              onToggleHideTitles={() => setHideSlotTitles((v) => !v)}
              savedGrids={savedGrids}
              onSaveLayout={handleSaveCurrentLayout}
              layoutEditing={editingLayout}
              onApplyLayout={handleApplySavedGrid}
              onDeleteLayout={handleDeleteSavedGrid}
              showPlayAllLoadingHint={showPlayAllLoadingHint}
              multiviewControl={
                canOpenMultiviewWindow || onEnterFullscreen != null
                  ? {
                      onOpen: async () => {
                        // Save currentTime per playing panel; popout seeks here after Shaka loads.
                        const currentTimes: Record<string, number> = {};
                        const transferredIds: string[] = [];
                        for (const itemId of Object.keys(embeddedPlayback)) {
                          const ref = panelRefsByItemId.current.get(itemId);
                          const v = ref?.getVideoElement?.();
                          if (v && Number.isFinite(v.currentTime)) {
                            currentTimes[itemId] = v.currentTime;
                          }
                          transferredIds.push(itemId);
                        }

                        saveStandaloneMultiviewState({
                          layout: layout.map((item) => ({ ...item })),
                          slotToItemId: { ...slotToItemId },
                          autoLayout,
                          autoSlotIds,
                          autoTileLimit,
                          session,
                          streams,
                          seasonYear,
                          embeddedPlayback:
                            // Only per-play data here (manifest URLs, per-play drm tokens): account tokens never reach the
                            // renderer. main.tsx drops leftover hand-offs on the next start.
                            transferredIds.length > 0 ? { ...embeddedPlayback } : undefined,
                          liveTimingQuery,
                          currentTimes: Object.keys(currentTimes).length > 0 ? currentTimes : undefined,
                          playingItemIds: transferredIds.length > 0 ? transferredIds : undefined,
                        });

                        // Parent drops these streams; they only play in the new window now.
                        onPortStreamsToWindow?.(transferredIds);
                        onBeforeEnterFullscreen?.();
                        if (onEnterFullscreen != null) {
                          await Promise.resolve(onEnterFullscreen());
                        } else if (window.f1?.openMultiviewWindow) {
                          await window.f1.openMultiviewWindow();
                        }
                      },
                      openWindowCount: multiviewOpenIds.length,
                      label:
                        multiviewOpenIds.length > 0
                          ? t('dashboard.multiviewFullscreenExtra')
                          : t('dashboard.multiviewFullscreen'),
                    }
                  : undefined
              }
              liveTiming={
                liveTimingQuery
                  ? {
                      onOpenPopout: openLiveTimingPopout,
                      dockOpen: liveTimingDockOpen,
                      onToggleDock: () => setLiveTimingDockOpen((v) => !v),
                    }
                  : undefined
              }
            />
          )}

          {editingLayout && !autoLayout && <div className="layout-tools">
            <p className="w-full text-xs text-muted-foreground">{t('experience.layoutHint')}</p>
            {presetButtons}
          </div>}
          {layoutNotice && <p role="status" className="text-xs text-muted-foreground">{layoutNotice}</p>}

          {/* Fullscreen toolbar toggle; no hover strip (blocks drag to top edge). */}
          {isFullscreen && onExitFullscreen && (
            <>

              {fullscreenToolbarOpen && (
                <div
                  ref={fullscreenToolbarRef}
                  className="absolute top-14 right-2 z-[59] flex max-w-[min(calc(100%-1rem),26rem)] max-h-[min(100vh-4rem,32rem)] flex-col gap-2 overflow-y-auto overflow-x-hidden rounded-xl border border-border/80 bg-background/95 p-3 shadow-xl"
                >
                  <div className="shrink-0 border-b border-border/60 pb-2 mb-1">
                    {multiviewInstanceId != null ? (
                      <p className="text-sm font-heading font-bold tracking-wide text-primary">
                        {t('dashboard.multiviewWindowNumber')}
                        {multiviewInstanceId}
                      </p>
                    ) : (
                      <p className="text-sm font-heading font-bold tracking-wide text-muted-foreground">
                        {t('dashboard.multiviewFullscreen')}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground font-heading mt-0.5">
                      {t('dashboard.multiviewWindowsLabel')}:{' '}
                      {multiviewOpenIds.length === 0
                        ? t('dashboard.multiviewWindowsNone')
                        : `${multiviewOpenIds.length} (${t('dashboard.multiviewWindowsList')}: ${multiviewOpenIds
                            .map((id) => `#${id}`)
                            .join(', ')})`}
                    </p>
                  </div>
                  {streamOptions.length > 0 && (
                    <DriverShelf
                      streamOptions={streamOptions}
                      assignedItemIds={assignedItemIds}
                      playingItemIds={playingItemIds}
                      pickingItemId={pickingItemId}
                      onPickCard={setPickingItemId}
                    />
                  )}
                  <MultiViewerCommandBar
                    variant="compact"
                    hasEmbedSupport={hasEmbedSupport}
                    hasStreams={streamOptions.length > 0}
                    anyLoading={anyLoading}
                    onPlayAll={handlePlayAllEmbedded}
                    showSyncButton={showSyncButton}
                    canSync={canSync}
                    syncStatus={syncStatus}
                    onSync={() => handleSync()}
                    hideSlotTitles={hideSlotTitles}
                    onToggleHideTitles={() => setHideSlotTitles((v) => !v)}
                    savedGrids={savedGrids}
                    onSaveLayout={handleSaveCurrentLayout}
              layoutEditing={editingLayout}
                    onApplyLayout={handleApplySavedGrid}
                    onDeleteLayout={handleDeleteSavedGrid}
                    showPlayAllLoadingHint={showPlayAllLoadingHint}
                    liveTiming={
                      liveTimingQuery
                        ? {
                            onOpenPopout: openLiveTimingPopout,
                            dockOpen: liveTimingDockOpen,
                            onToggleDock: () => setLiveTimingDockOpen((v) => !v),
                          }
                        : undefined
                    }
                    compactExtra={{
                      onAddSlot: streamOptions.length > 0 ? handleAddSlot : undefined,
                      onExitFullscreen,
                    }}
                  />
                </div>
              )}
            </>
          )}

          {streamOptions.length > 0 ? (
            <div className={`relative flex-1 flex flex-col ${autoLayout ? 'min-h-[180px]' : 'manual-grid-scroll thin-scrollbar'}`}>
            {/* Floats over the grid so tiles keep their size while editing. */}
            {editingLayout && autoLayout && (
              <div className="layout-tools layout-tools-floating" role="toolbar" aria-label={t('experience.editLayout')} title={t('experience.autoEditHint')}>
                <button type="button" className="ui-button" disabled={autoSlotIds.length >= streamOptions.length} onClick={handleAddSlot}>
                  <Plus className="w-4 h-4" aria-hidden />{t('dashboard.gridAddSlot')}
                </button>
                <span className="toolbar-divider" aria-hidden />
                {presetButtons}
              </div>
            )}
            <ResizableStreamGrid
              streamOptions={streamOptions}
              layout={layout}
              onLayoutChange={setLayout}
              slotToItemId={slotToItemId}
              onSlotToItemIdChange={handleSlotToItemIdChange}
              embeddedPlayback={embeddedPlayback}
              loadingItemIds={loadingItemIds}
              onPlayEmbedded={onPlayEmbedded}
              onEmbedError={onEmbedError}
              onOpen={onOpen}
              onRegisterPanelRef={handleRegisterPanelRef}
              onAddSlot={handleAddSlot}
              canAddSlot={editingLayout && !autoLayout}
              editing={editingLayout}
              onRemoveSlot={(id) => {
                if (autoLayout) { removeAutoSlot(id); return; }
                setLayout((current) => current.filter((cell) => cell.i !== id));
                setSlotToItemId((current) => { const next = { ...current }; delete next[id]; return next; });
              }}
              hideSlotHeadersUntilHover={!editingLayout && hideSlotTitles}
              fillHeight={isFullscreen}
              onSetSlotSize={handleSetSlotSize}
              onReloadStream={
                onPlayEmbedded
                  ? (itemId) => {
                      const opt = streamOptions.find((o) => o.item.id === itemId);
                      if (opt) onPlayEmbedded(opt.item);
                    }
                  : undefined
              }
              disableCompact={isFullscreen}
              audioFocusedItemId={audioFocusedItemId}
              onAudioFocus={handleAudioFocus}
              initialSeekSecondsByItemId={initialSeekSecondsByItemId}
              pickingItemId={pickingItemId}
              onPickingConsumed={() => setPickingItemId(null)}
              auto={autoLayout}
              // While streams load keep the current tiles; removed streams are not available.
              maxTiles={Math.min(
                streams == null ? Math.max(autoSlotIds.length, streamOptions.length) : Math.max(1, streamOptions.length - autoExcluded.length),
                prefs.maxAutoTiles > 0 ? prefs.maxAutoTiles : Infinity
              )}
              autoSlotIds={autoSlotIds}
              preferredTiles={preferredTiles}
              onAutoCount={applyAutoSlots}
              autoFixedCount={autoTileLimit}
              onSwapSlots={swapAutoSlots}
              showDriverHud={hudWanted}
            />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground font-heading tracking-wider">
              {t('dashboard.mainFeedOnlySession')}
            </p>
          )}
        </motion.div>
      </AnimatePresence>
      </div>

      {/* No dock in this window: compute the timing for the HUD without showing it. */}
      {(hudWanted || layoutWantsTiming) && !liveTimingDockOpen && liveTimingQuery && <DriverHudSource query={liveTimingQuery} telemetry={hudWanted} />}
      {liveTimingDockOpen && liveTimingQuery && (
        <LiveTimingDock query={liveTimingQuery} onClose={() => setLiveTimingDockOpen(false)} onPopOut={openLiveTimingPopout} fullscreen={isFullscreen} />
      )}
      </div>
    </>
  );
}
