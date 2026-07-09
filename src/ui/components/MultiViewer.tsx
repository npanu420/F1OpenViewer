import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MoreHorizontal, RefreshCw, X } from 'lucide-react';
import type { Layout } from 'react-grid-layout';
import { useLocale } from '../../i18n/LocaleContext';
import { MultiViewerCommandBar } from './MultiViewerCommandBar';
import { DriverShelf } from './DriverShelf';
import { LiveTimingDock, type DockSessionQuery } from './LiveTimingDock';

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
  accessToken?: string;
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
  accessToken,
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
}: MultiViewerProps) {
  const { t } = useLocale();
  const multiviewOpenIds = useMultiviewWindows();
  const [canOpenMultiviewWindow, setCanOpenMultiviewWindow] = useState(false);
  const [liveTimingDockOpen, setLiveTimingDockOpen] = useState(false);
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
  const [savedGrids, setSavedGrids] = useState<SavedGrid[]>(() => loadSavedGrids());
  const [audioFocusedItemId, setAudioFocusedItemId] = useState<string | null>(null);
  const panelRefsByItemId = useRef<Map<string, StreamPanelHandle>>(new Map());

  // Relay main-feed clock to live timing windows. Ref mirror keeps the interval stable.
  const clockSrcRef = useRef({ mainId: '', slotToItemId: {} as Record<string, string>, embeddedPlayback, audioFocusedItemId: null as string | null });
  clockSrcRef.current = { mainId: mainItem.id, slotToItemId, embeddedPlayback, audioFocusedItemId };
  useEffect(() => {
    const lt = window.f1?.liveTiming;
    const id = window.setInterval(() => {
      const { mainId, slotToItemId: s2i, embeddedPlayback: emb, audioFocusedItemId: audioId } = clockSrcRef.current;
      if (!mainId || !emb[mainId]) return;                       // main feed not playing
      if (!Object.values(s2i).includes(mainId)) return;          // not mapped to a slot
      const panel = panelRefsByItemId.current.get(mainId);
      const v = panel?.getVideoElement?.();
      if (!v || !Number.isFinite(v.currentTime)) return;

      // Live timing: DASH has wall clock for auto-sync; HLS falls back to session_start.
      if (lt?.reportClock) {
        const wallClockMs = panel?.getWallClockMs?.() ?? null;
        lt.reportClock({ timeSec: v.currentTime, paused: v.paused, wallClockMs });
      }

      // Lock other panels to main feed. Big drift -> seek; small drift -> playbackRate (not on audio panel).
      for (const itemId of new Set(Object.values(s2i))) {
        if (!itemId || itemId === mainId || !emb[itemId]) continue;
        const v2 = panelRefsByItemId.current.get(itemId)?.getVideoElement?.();
        if (!v2) continue;
        if (v.paused !== v2.paused) { try { v.paused ? v2.pause() : v2.play(); } catch (_) {} }
        if (v.paused || v2.seeking || v2.readyState < 2 || !Number.isFinite(v2.currentTime)) continue;
        const drift = v2.currentTime - v.currentTime;
        const ad = Math.abs(drift);
        if (ad > 0.5) {
          try { v2.currentTime = v.currentTime; } catch (_) {}
          if (v2.playbackRate !== 1) v2.playbackRate = 1;
        } else if (ad > 0.1 && itemId !== audioId) {
          v2.playbackRate = drift > 0 ? 0.95 : 1.05; // converges in a few seconds
        } else if (v2.playbackRate !== 1) {
          v2.playbackRate = 1;
        }
      }
    }, 250);
    return () => window.clearInterval(id);
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
    setSlotToItemId((prev) => ({ ...prev, [slotId]: itemId }));
  }, []);

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
      const ref = panelRefsByItemId.current.get(itemId);
      entries.push({
        id: itemId,
        label: option.label,
        getVideo: () => ref?.getVideoElement() ?? null,
  // Main feed is always sync reference, even if an onboard is ahead.
        isMainFeed: option.type === 'main',
      });
    }
    startSync(entries, { silent });
  }

  // Auto-sync on new streams only (not reload/seek). Debounced for Play All.
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
    if (!hasNewStart || curIds.size < 2) return;

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
    setLayout((prev) => {
      const maxY = Math.max(0, ...prev.map((item) => item.y + item.h));
      const nextIndex = prev.length;
      return [...prev, { i: `slot-${nextIndex}`, x: 0, y: maxY, w, h, minW: 2, minH: 2 }];
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
    const name = rawName.trim() || t('dashboard.savedLayoutDefaultName');
    const slotAssignments = buildSlotAssignments(slotToItemId, streamOptions);
    const next: SavedGrid = {
      id: crypto.randomUUID?.() ?? `grid-${Date.now()}`,
      name,
      layout: layout.map((item) => ({ ...item })),
      slotToItemId: { ...slotToItemId },
      slotAssignments,
    };
    setSavedGrids((prev) => {
      const list = [...prev, next];
      saveSavedGrids(list);
      return list;
    });
  }, [layout, slotToItemId, streamOptions, t]);

  const handleApplySavedGrid = useCallback(
    (preset: SavedGrid) => {
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

  const [hideSlotTitles, setHideSlotTitles] = useState(false);
  const [pickingItemId, setPickingItemId] = useState<string | null>(null);
  const assignedItemIds = useMemo(
    () => new Set(Object.values(slotToItemId).filter(Boolean)),
    [slotToItemId]
  );
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
    onPlayAllEmbedded?.(allItems);
  }, [onPlayAllEmbedded, allItems]);

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
            className="fixed bottom-4 right-4 z-[58] flex items-center gap-2 px-3 py-2 rounded-full border border-border/60 bg-background/90 backdrop-blur shadow-lg hover:bg-accent/40 transition-colors"
            title={isWaitingForMain ? t('sync.runningBadgeBuffering') : syncStatus === 'done' ? t('sync.synced') : t('sync.runningBadge')}
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

      <div className={isFullscreen ? 'flex-1 min-h-0 flex items-stretch gap-3' : 'flex items-start gap-3'}>
      <div className={isFullscreen ? 'flex-1 min-w-0 flex flex-col min-h-0' : 'flex-1 min-w-0'}>
      <AnimatePresence mode="wait">
        <motion.div
          key={session.contentId}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className={isFullscreen ? 'flex-1 flex flex-col min-h-0' : 'space-y-6'}
        >
          {hasEmbedSupport && allItems.length > 0 && !isFullscreen && (
            <MultiViewerCommandBar
              variant="bar"
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
                          session,
                          streams,
                          seasonYear,
                          embeddedPlayback:
                            transferredIds.length > 0 ? { ...embeddedPlayback } : undefined,
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

          {/* Fullscreen toolbar toggle; no hover strip (blocks drag to top edge). */}
          {isFullscreen && onExitFullscreen && (
            <>
              <button
                ref={fullscreenToolbarToggleRef}
                type="button"
                onClick={() => setFullscreenToolbarOpen((v) => !v)}
                title={fullscreenToolbarOpen ? t('dashboard.fullscreenToolbarHide') : t('dashboard.fullscreenToolbarShow')}
                aria-expanded={fullscreenToolbarOpen}
                className="fixed top-2 right-2 z-[60] flex h-10 w-10 items-center justify-center rounded-full border border-border/80 bg-black/75 text-foreground shadow-lg backdrop-blur-sm transition-colors hover:bg-black/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {fullscreenToolbarOpen ? (
                  <X className="h-5 w-5" aria-hidden />
                ) : (
                  <MoreHorizontal className="h-5 w-5" aria-hidden />
                )}
              </button>

              {fullscreenToolbarOpen && (
                <div
                  ref={fullscreenToolbarRef}
                  className="fixed top-14 right-2 z-[59] flex max-w-[min(100vw-1rem,26rem)] max-h-[min(100vh-4rem,32rem)] flex-col gap-2 overflow-y-auto overflow-x-hidden rounded-xl border border-border/80 bg-background/95 p-3 shadow-xl backdrop-blur-md"
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

          {!isFullscreen && streamOptions.length > 0 && (
            <DriverShelf
              streamOptions={streamOptions}
              assignedItemIds={assignedItemIds}
              playingItemIds={playingItemIds}
              pickingItemId={pickingItemId}
              onPickCard={setPickingItemId}
            />
          )}

          {streamOptions.length > 0 ? (
            <div className={isFullscreen ? 'flex-1 min-h-0 flex flex-col' : ''}>
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
              accessToken={accessToken}
              onOpen={onOpen}
              onRegisterPanelRef={handleRegisterPanelRef}
              onAddSlot={handleAddSlot}
              canAddSlot={!isFullscreen}
              hideSlotHeadersUntilHover={hideSlotTitles}
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

      {liveTimingDockOpen && liveTimingQuery && (
        <LiveTimingDock query={liveTimingQuery} onClose={() => setLiveTimingDockOpen(false)} fullscreen={isFullscreen} />
      )}
      </div>
    </>
  );
}
