import React, { useRef, useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, RefreshCw, Maximize2, Minimize2, Type, Save, Trash2, MoreHorizontal, X } from 'lucide-react';
import type { Layout } from 'react-grid-layout';
import { useLocale } from '../../i18n/LocaleContext';

const SAVED_GRIDS_KEY = 'f1openviewer-saved-grids';
const STANDALONE_MULTIVIEW_KEY = 'f1openviewer-standalone-multiview';

export type StandaloneMultiviewState = {
  layout: Layout;
  slotToItemId: Record<string, string>;
  session: import('../../domain/vod').VodSession;
  streams: import('../../services/vod').SessionStreams | null;
  seasonYear: number;
  /** Item IDs that were playing when entering fullscreen; fullscreen window will re-resolve playback for these to get fresh tokens. */
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

export function saveStandaloneMultiviewState(state: StandaloneMultiviewState): void {
  try {
    localStorage.setItem(STANDALONE_MULTIVIEW_KEY, JSON.stringify(state));
  } catch (_) {}
}

export function loadStandaloneMultiviewState(): StandaloneMultiviewState | null {
  try {
    const raw = localStorage.getItem(STANDALONE_MULTIVIEW_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StandaloneMultiviewState;
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
  /** Called before opening fullscreen window; parent can clear embedded playback so streams don't stay in play in main app. */
  onBeforeEnterFullscreen?: () => void;
  onExitFullscreen?: () => void;
  /** When provided (e.g. standalone window), initial state is not overwritten by the session/streams effect. */
  initialLayout?: Layout;
  initialSlotToItemId?: Record<string, string>;
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
  onBeforeEnterFullscreen,
  onExitFullscreen,
  initialLayout,
  initialSlotToItemId,
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
  const hasMultipleStreams = allItems.length >= 2;
  const canSync = hasMultipleStreams && playingCount >= 2;
  const showSyncButton = hasMultipleStreams;

  const [layout, setLayout] = useState<Layout>(() => initialLayout ?? getDefaultGridLayout());
  const [slotToItemId, setSlotToItemId] = useState<Record<string, string>>(() => initialSlotToItemId ?? {});
  const [savedGrids, setSavedGrids] = useState<SavedGrid[]>(() => loadSavedGrids());
  const [saveLayoutName, setSaveLayoutName] = useState('');
  const [showSaveInput, setShowSaveInput] = useState(false);
  const panelRefsByItemId = useRef<Map<string, StreamPanelHandle>>(new Map());

  const {
    startSync,
    closeOverlay,
    syncStatus,
    syncStreams,
    showSyncOverlay,
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
    const entries: Array<{ id: string; label: string; getVideo: () => HTMLVideoElement | null }> = [];
    for (const [slotId, itemId] of Object.entries(slotToItemId)) {
      if (!itemId || !embeddedPlayback[itemId]) continue;
      const option = streamOptions.find((o) => o.item.id === itemId);
      if (!option) continue;
      const ref = panelRefsByItemId.current.get(itemId);
      entries.push({
        id: itemId,
        label: option.label,
        getVideo: () => ref?.getVideoElement() ?? null,
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

  return (
    <>
      <SyncOverlay
        isOpen={showSyncOverlay}
        status={syncStatus}
        streams={syncStreams}
        onClose={closeOverlay}
      />

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
                  className="flex items-center gap-2 py-2.5 px-4 rounded-lg font-heading text-sm font-bold tracking-wider bg-primary text-primary-foreground border border-primary hover:opacity-90 transition-opacity"
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
                >
                  <RefreshCw className={`w-4 h-4 ${syncStatus === 'syncing' ? 'animate-spin' : ''}`} />
                  {syncStatus === 'syncing' ? t('sync.inProgress') : t('sync.inProgressDescription')}
                </button>
              )}

              {(canOpenMultiviewWindow || onEnterFullscreen != null) && (
                <button
                  type="button"
                  onClick={async () => {
                    saveStandaloneMultiviewState({
                      layout: layout.map((item) => ({ ...item })),
                      slotToItemId: { ...slotToItemId },
                      session,
                      streams,
                      seasonYear,
                      playingItemIds:
                        Object.keys(embeddedPlayback).length > 0 ? Object.keys(embeddedPlayback) : undefined,
                    });
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
                        className="flex items-center gap-2 py-2 px-3 rounded-lg font-heading text-xs font-bold bg-primary text-primary-foreground border border-primary hover:opacity-90"
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
                        {syncStatus === 'syncing' ? t('sync.inProgress') : t('sync.inProgressDescription')}
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
