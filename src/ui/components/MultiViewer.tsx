import React, { useRef, useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, RefreshCw, Maximize2, Minimize2, Type, Save, Trash2, MoreHorizontal, X } from 'lucide-react';
import type { Layout } from 'react-grid-layout';
import { useLocale } from '../../i18n/LocaleContext';

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
  /**
   * Resolved PlaybackInfo for items that were already playing in the source window. The
   * standalone window reuses these so streams resume instantly with the same manifest URLs and
   * license proxy entries (no extra contentPlay round-trips, no DRM re-handshake).
   */
  embeddedPlayback?: Record<string, import('../../services/entitlement').PlaybackInfo>;
  /** Per-item playback position (seconds) at the moment of porting. Standalone window seeks to
   *  this value once Shaka finishes loading, so the user lands on the same frame they were on. */
  currentTimes?: Record<string, number>;
  /** Legacy: item IDs playing at the time of save (kept for backwards compat with old snapshots). */
  playingItemIds?: string[];
};

/** Semantic slot assignment: resolved against the current session when applying the template. */
export type SlotAssignment =
  | { type: 'main' }
  | { type: 'data'; index: number }
  | { type: 'onboard'; racingNumber: number; driverName?: string };

export type SavedGrid = {
  id: string;
  name: string;
  layout: Layout;
  /** Legacy: used when slotAssignments is not present. */
  slotToItemId: Record<string, string>;
  /** Assignments by type/driver: main, data (index), onboard (racing number). */
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
  try {
    localStorage.setItem(SAVED_GRIDS_KEY, JSON.stringify(grids));
  } catch (_) {}
}

/** Builds semantic slot assignments for the template from slotToItemId + streamOptions. */
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

/** Resolves slotAssignments against current streamOptions; missing slots (e.g. driver not in session) stay empty. */
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

function SavedLayoutsSection({
  t,
  savedGrids,
  showSaveInput,
  setShowSaveInput,
  saveLayoutName,
  setSaveLayoutName,
  onSave,
  onApply,
  onDelete,
  compact,
}: {
  t: (key: string) => string;
  savedGrids: SavedGrid[];
  showSaveInput: boolean;
  setShowSaveInput: (v: boolean) => void;
  saveLayoutName: string;
  setSaveLayoutName: (v: string) => void;
  onSave: () => void;
  onApply: (preset: SavedGrid) => void;
  onDelete: (id: string) => void;
  compact?: boolean;
}) {
  const box = compact
    ? 'rounded-lg border border-border/60 bg-card/80 p-2'
    : 'rounded-lg border border-border/60 bg-card/40 p-4';
  const titleClass = compact
    ? 'text-[10px] font-heading font-bold tracking-widest text-muted-foreground mb-2'
    : 'text-xs font-heading font-bold tracking-widest text-muted-foreground mb-3';
  const listClass = compact ? 'max-h-40 overflow-y-auto space-y-1 pr-0.5' : 'space-y-1.5';

  return (
    <div className={box}>
      <h4 className={titleClass}>{t('dashboard.savedLayouts')}</h4>
      <div className={`flex flex-wrap items-center gap-2 ${compact ? 'mb-2' : 'mb-3'}`}>
        {showSaveInput ? (
          <>
            <input
              type="text"
              value={saveLayoutName}
              onChange={(e) => setSaveLayoutName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onSave()}
              placeholder={t('dashboard.savedLayoutNamePlaceholder')}
              className={`rounded-lg border border-border bg-background font-heading ${
                compact ? 'px-2 py-1 text-xs w-32' : 'px-3 py-1.5 text-sm w-40'
              }`}
              autoFocus
            />
            <button
              type="button"
              onClick={onSave}
              className={`flex items-center gap-1 rounded-lg font-heading font-bold bg-primary text-primary-foreground hover:opacity-90 ${
                compact ? 'py-1 px-2 text-[10px]' : 'gap-1.5 py-1.5 px-3 text-xs'
              }`}
            >
              <Save className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
              {t('dashboard.saveLayout')}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowSaveInput(false);
                setSaveLayoutName('');
              }}
              className={`rounded-lg font-heading border border-border hover:bg-accent/50 ${
                compact ? 'py-1 px-2 text-[10px]' : 'py-1.5 px-3 text-xs'
              }`}
            >
              {t('ui.cancel')}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setShowSaveInput(true)}
            className={`flex items-center gap-1 rounded-lg font-heading font-bold border border-border bg-accent/20 hover:bg-accent/40 ${
              compact ? 'py-1 px-2 text-[10px]' : 'gap-1.5 py-1.5 px-3 text-xs'
            }`}
          >
            <Save className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
            {t('dashboard.saveCurrentLayout')}
          </button>
        )}
      </div>
      {savedGrids.length > 0 && (
        <ul className={listClass}>
          {savedGrids.map((preset) => (
            <li
              key={preset.id}
              className={`flex items-center justify-between gap-2 rounded bg-background/50 ${
                compact ? 'py-1 px-1.5' : 'py-1.5 px-2'
              }`}
            >
              <span className={`font-heading truncate min-w-0 ${compact ? 'text-[10px]' : 'text-sm'}`}>
                {preset.name}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => onApply(preset)}
                  className={`rounded font-heading border border-border hover:bg-accent/50 ${
                    compact ? 'py-0.5 px-1.5 text-[10px]' : 'py-1 px-2 text-xs'
                  }`}
                >
                  {t('dashboard.applyLayout')}
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(preset.id)}
                  title={t('dashboard.deleteLayout')}
                  className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {savedGrids.length === 0 && !showSaveInput && (
        <p className={`text-muted-foreground font-heading ${compact ? 'text-[10px]' : 'text-xs'}`}>
          {t('dashboard.savedLayoutsEmpty')}
        </p>
      )}
    </div>
  );
}

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
   * Called BEFORE opening the standalone multiview window. Receives the IDs of streams that
   * were transferred so the parent (dashboard) can release them — they keep playing only in
   * the new window, avoiding double bandwidth/CPU cost.
   */
  onPortStreamsToWindow?: (transferredItemIds: string[]) => void;
  /** @deprecated use onPortStreamsToWindow. Kept for callsites that still need the broader hook. */
  onBeforeEnterFullscreen?: () => void;
  onExitFullscreen?: () => void;
  /** When provided (e.g. standalone window), initial state is not overwritten by the session/streams effect. */
  initialLayout?: Layout;
  initialSlotToItemId?: Record<string, string>;
  /** Per-item initial seek position (seconds), used by the standalone window when resuming a
   *  ported stream so playback continues at the same frame the user left it. */
  initialSeekSecondsByItemId?: Record<string, number>;
  /** Finestra standalone Electron: numero finestra (hash ?mv=). */
  multiviewInstanceId?: number;
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
}: MultiViewerProps) {
  const { t } = useLocale();
  const multiviewOpenIds = useMultiviewWindows();
  const [canOpenMultiviewWindow, setCanOpenMultiviewWindow] = useState(false);

  useEffect(() => {
    setCanOpenMultiviewWindow(typeof window.f1?.openMultiviewWindow === 'function');
  }, []);

  const mainItem = toCatalogItem(session, seasonYear);
  const streamOptions: StreamOption[] = [
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
    })) ?? []),
  ];

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
  const [saveLayoutName, setSaveLayoutName] = useState('');
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [audioFocusedItemId, setAudioFocusedItemId] = useState<string | null>(null);
  const panelRefsByItemId = useRef<Map<string, StreamPanelHandle>>(new Map());

  // Publish the main-feed video clock to any live-timing window (cross-window sync master).
  // Read latest state via a ref mirror so the interval stays stable across renders.
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

      // 1) Send the master clock to the live-timing window. DASH replays carry a real broadcast
      //    wall clock (exact auto-sync); HLS sends null and the window falls back to the endpoint's
      //    session_start instead.
      if (lt?.reportClock) {
        const wallClockMs = panel?.getWallClockMs?.() ?? null;
        lt.reportClock({ timeSec: v.currentTime, paused: v.paused, wallClockMs });
      }

      // 2) Keep every other panel locked to the main feed, which keeps them transitively synced to
      //    the timing too. Big gap (after load/seek/stall) gets a hard seek. Small steady drift eases
      //    back via playbackRate instead so there's no visible jump, but we never rate-trim the
      //    audio-focused panel since that causes pitch wobble.
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

  // Auto-assign streams to initial slots when session/season/streams change. Skip if layout/slots are provided externally (standalone window).
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

  function handleSync() {
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
        // Flag the race / world feed so the sync engine always anchors to it, even when an
        // onboard happens to be ahead. Onboards/data should follow the race, not the inverse.
        isMainFeed: option.type === 'main',
      });
    }
    startSync(entries);
  }

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

  const handleSaveCurrentLayout = useCallback(() => {
    const name = saveLayoutName.trim() || t('dashboard.savedLayoutDefaultName');
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
    setSaveLayoutName('');
    setShowSaveInput(false);
  }, [layout, slotToItemId, streamOptions, saveLayoutName, t]);

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

  const [hideTitlesInFullscreen, setHideTitlesInFullscreen] = useState(false);
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

  // Floating "sync running" badge: shown when the engine is active but the user has minimized
  // the overlay so they can keep watching. Click to bring the dialog back.
  const showMinimizedSyncBadge = isSyncEngineRunning && !showSyncOverlay;
  // "Waiting for main feed" appears when the engine has paused the others because the reference
  // is rebuffering. We detect this off the engine's output: during a buffer-hold, every non-ref
  // entry is reported with rate=1 and done=false (no rate-nudge / no seek happening) while the
  // reference is the only one with done=true. This is distinct from initial convergence, where
  // non-ref entries carry rate ≠ 1 or are seeking.
  const refStream = syncStreams.find((s) => s.isReference);
  const nonRefStreams = syncStreams.filter((s) => !s.isReference);
  const isWaitingForMain =
    syncStatus === 'done' &&
    refStream != null &&
    nonRefStreams.length > 0 &&
    nonRefStreams.every((s) => !s.done && Math.abs(s.rate - 1) < 0.001);

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
            title={isWaitingForMain ? t('sync.runningBadgeBuffering') : t('sync.runningBadge')}
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${syncStatus === 'syncing' || isWaitingForMain ? 'animate-spin text-primary' : 'text-emerald-400'}`}
            />
            <span className="font-heading text-[11px] font-bold tracking-wider">
              {isWaitingForMain ? t('sync.runningBadgeBuffering') : t('sync.runningBadge')}
            </span>
          </motion.button>
        )}
      </AnimatePresence>

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
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={handlePlayAllEmbedded}
                  disabled={anyLoading}
                  className="flex items-center gap-2 py-2.5 px-4 rounded-lg font-heading text-sm font-bold tracking-wider bg-primary text-primary-foreground border border-primary hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Play className="w-4 h-4" />
                  {t('dashboard.playAllEmbedded')}
                </button>

              {showSyncButton && (
                <button
                  type="button"
                  onClick={handleSync}
                  disabled={!canSync || syncStatus === 'syncing'}
                  className="flex items-center gap-2 py-2.5 px-4 rounded-lg font-heading text-sm font-bold tracking-wider border border-border bg-accent/30 hover:bg-accent/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title={t('sync.inProgressDescription')}
                >
                  <RefreshCw className={`w-4 h-4 ${syncStatus === 'syncing' ? 'animate-spin' : ''}`} />
                  {syncStatus === 'syncing' ? t('sync.inProgress') : t('sync.button')}
                </button>
              )}

              {(canOpenMultiviewWindow || onEnterFullscreen != null) && (
                <button
                  type="button"
                  onClick={async () => {
                    // Snapshot the live currentTime for every panel that's currently playing.
                    // The standalone window will seek to these values after Shaka finishes
                    // loading, so the user lands on the same frame and any sync state is preserved.
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

                    // Tell the parent which streams are being transferred so it can release them.
                    // The streams will only play in the new window — no double bandwidth.
                    onPortStreamsToWindow?.(transferredIds);
                    onBeforeEnterFullscreen?.();
                    if (onEnterFullscreen != null) {
                      await Promise.resolve(onEnterFullscreen());
                    } else if (window.f1?.openMultiviewWindow) {
                      await window.f1.openMultiviewWindow();
                    }
                  }}
                  title={t('dashboard.multiviewFullscreen')}
                  className="flex items-center gap-2 py-2.5 px-4 rounded-lg font-heading text-sm font-bold tracking-wider border border-border bg-accent/30 hover:bg-accent/50 transition-colors shrink-0"
                >
                  <Maximize2 className="w-4 h-4 shrink-0" />
                  {multiviewOpenIds.length > 0
                    ? t('dashboard.multiviewFullscreenExtra')
                    : t('dashboard.multiviewFullscreen')}
                </button>
              )}
              </div>
              {(canOpenMultiviewWindow || onEnterFullscreen != null) && (
                <p className="text-xs text-muted-foreground font-heading max-w-2xl leading-snug pl-0.5">
                  <span className="font-bold text-foreground/90">{t('dashboard.multiviewWindowsLabel')}:</span>{' '}
                  {multiviewOpenIds.length === 0
                    ? t('dashboard.multiviewWindowsNone')
                    : `${multiviewOpenIds.length} (${t('dashboard.multiviewWindowsList')}: ${multiviewOpenIds
                        .map((id) => `#${id}`)
                        .join(', ')})`}
                </p>
              )}
              <AnimatePresence>
                {showPlayAllLoadingHint && (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="text-xs text-muted-foreground font-heading max-w-md"
                  >
                    {t('dashboard.playAllLoadingHint')}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
          )}

          {!isFullscreen && streamOptions.length > 0 && (
            <SavedLayoutsSection
              t={t}
              savedGrids={savedGrids}
              showSaveInput={showSaveInput}
              setShowSaveInput={setShowSaveInput}
              saveLayoutName={saveLayoutName}
              setSaveLayoutName={setSaveLayoutName}
              onSave={handleSaveCurrentLayout}
              onApply={handleApplySavedGrid}
              onDelete={handleDeleteSavedGrid}
            />
          )}

          {/* Fullscreen: floating toggle (no hover strip — avoids blocking drag toward top) */}
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
                  className="fixed top-14 right-2 z-[59] flex max-w-[min(100vw-1rem,26rem)] max-h-[min(100vh-4rem,32rem)] flex-col gap-2 overflow-y-auto rounded-xl border border-border/80 bg-background/95 p-3 shadow-xl backdrop-blur-md"
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
                  <div className="flex flex-col gap-2 shrink-0">
                    {hasEmbedSupport && allItems.length > 0 && (
                      <button
                        type="button"
                        onClick={handlePlayAllEmbedded}
                        disabled={anyLoading}
                        className="flex items-center gap-2 py-2 px-3 rounded-lg font-heading text-xs font-bold bg-primary text-primary-foreground border border-primary hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Play className="w-3.5 h-3.5 shrink-0" />
                        {t('dashboard.playAllEmbedded')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setHideTitlesInFullscreen((v) => !v)}
                      title={hideTitlesInFullscreen ? t('dashboard.showTitles') : t('dashboard.hideTitles')}
                      className={`flex items-center gap-2 py-2 px-3 rounded-lg font-heading text-xs font-bold border transition-colors ${hideTitlesInFullscreen ? 'bg-primary/20 border-primary text-primary' : 'border-border bg-accent/40 hover:bg-accent/60'}`}
                    >
                      <Type className="w-3.5 h-3.5 shrink-0" />
                      {hideTitlesInFullscreen ? t('dashboard.showTitles') : t('dashboard.hideTitles')}
                    </button>
                    {showSyncButton && (
                      <button
                        type="button"
                        onClick={handleSync}
                        disabled={!canSync || syncStatus === 'syncing'}
                        title={t('sync.inProgressDescription')}
                        className="flex items-center gap-2 py-2 px-3 rounded-lg font-heading text-xs font-bold border border-border bg-accent/40 hover:bg-accent/60 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${syncStatus === 'syncing' ? 'animate-spin' : ''}`} />
                        {syncStatus === 'syncing' ? t('sync.inProgress') : t('sync.button')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={onExitFullscreen}
                      title={t('dashboard.exitFullscreen')}
                      className="flex items-center gap-2 py-2 px-3 rounded-lg font-heading text-sm font-bold border border-border bg-card hover:bg-accent/50 transition-colors"
                    >
                      <Minimize2 className="w-4 h-4 shrink-0" />
                      {t('dashboard.exitFullscreen')}
                    </button>
                  </div>

                  {streamOptions.length > 0 && (
                    <SavedLayoutsSection
                      t={t}
                      savedGrids={savedGrids}
                      showSaveInput={showSaveInput}
                      setShowSaveInput={setShowSaveInput}
                      saveLayoutName={saveLayoutName}
                      setSaveLayoutName={setSaveLayoutName}
                      onSave={handleSaveCurrentLayout}
                      onApply={handleApplySavedGrid}
                      onDelete={handleDeleteSavedGrid}
                      compact
                    />
                  )}

                  <AnimatePresence>
                    {showPlayAllLoadingHint && (
                      <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="text-[10px] text-muted-foreground font-heading"
                      >
                        {t('dashboard.playAllLoadingHint')}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </>
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
              hideSlotHeadersUntilHover={isFullscreen && hideTitlesInFullscreen}
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
            />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground font-heading tracking-wider">
              {t('dashboard.mainFeedOnlySession')}
            </p>
          )}
        </motion.div>
      </AnimatePresence>
    </>
  );
}
