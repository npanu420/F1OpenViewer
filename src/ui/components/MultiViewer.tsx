import React, { useRef, useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, RefreshCw, Maximize2, Minimize2, Type, Save, Trash2 } from 'lucide-react';
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
import { ResizableStreamGrid, getDefaultGridLayout, type StreamOption } from './ResizableStreamGrid';
import { SyncOverlay } from './SyncOverlay';
import { useSyncEngine } from '../hooks/useSyncEngine';

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
}: MultiViewerProps) {
  const { t } = useLocale();

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
    setLayout((prev) => {
      const maxY = Math.max(0, ...prev.map((item) => item.y + item.h));
      const nextIndex = prev.length;
      return [...prev, { i: `slot-${nextIndex}`, x: 0, y: maxY, w: 4, h: 2, minW: 2, minH: 1 }];
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
      if (e.key === 'Escape') onExitFullscreen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFullscreen, onExitFullscreen]);

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

              {onEnterFullscreen && (
                <button
                  type="button"
                  onClick={() => {
                    saveStandaloneMultiviewState({
                      layout: layout.map((item) => ({ ...item })),
                      slotToItemId: { ...slotToItemId },
                      session,
                      streams,
                      seasonYear,
                      playingItemIds: Object.keys(embeddedPlayback).length > 0 ? Object.keys(embeddedPlayback) : undefined,
                    });
                    onBeforeEnterFullscreen?.();
                    onEnterFullscreen();
                  }}
                  title={t('dashboard.multiviewFullscreen')}
                  className="flex items-center gap-2 py-2.5 px-4 rounded-lg font-heading text-sm font-bold tracking-wider border border-border bg-accent/30 hover:bg-accent/50 transition-colors"
                >
                  <Maximize2 className="w-4 h-4" />
                  {t('dashboard.multiviewFullscreen')}
                </button>
              )}
              </div>
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

          {/* Saved layouts section (only when not in fullscreen) */}
          {!isFullscreen && streamOptions.length > 0 && (
            <div className="rounded-lg border border-border/60 bg-card/40 p-4">
              <h4 className="text-xs font-heading font-bold tracking-widest text-muted-foreground mb-3">
                {t('dashboard.savedLayouts')}
              </h4>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                {showSaveInput ? (
                  <>
                    <input
                      type="text"
                      value={saveLayoutName}
                      onChange={(e) => setSaveLayoutName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveCurrentLayout()}
                      placeholder={t('dashboard.savedLayoutNamePlaceholder')}
                      className="px-3 py-1.5 rounded-lg border border-border bg-background text-sm font-heading w-40"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={handleSaveCurrentLayout}
                      className="flex items-center gap-1.5 py-1.5 px-3 rounded-lg font-heading text-xs font-bold bg-primary text-primary-foreground hover:opacity-90"
                    >
                      <Save className="w-3.5 h-3.5" />
                      {t('dashboard.saveLayout')}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowSaveInput(false); setSaveLayoutName(''); }}
                      className="py-1.5 px-3 rounded-lg font-heading text-xs border border-border hover:bg-accent/50"
                    >
                      {t('ui.cancel')}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowSaveInput(true)}
                    className="flex items-center gap-1.5 py-1.5 px-3 rounded-lg font-heading text-xs font-bold border border-border bg-accent/20 hover:bg-accent/40"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {t('dashboard.saveCurrentLayout')}
                  </button>
                )}
              </div>
              {savedGrids.length > 0 && (
                <ul className="space-y-1.5">
                  {savedGrids.map((preset) => (
                    <li
                      key={preset.id}
                      className="flex items-center justify-between gap-2 py-1.5 px-2 rounded bg-background/50"
                    >
                      <span className="text-sm font-heading truncate min-w-0">{preset.name}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleApplySavedGrid(preset)}
                          className="py-1 px-2 rounded text-xs font-heading border border-border hover:bg-accent/50"
                        >
                          {t('dashboard.applyLayout')}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteSavedGrid(preset.id)}
                          title={t('dashboard.deleteLayout')}
                          className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {savedGrids.length === 0 && !showSaveInput && (
                <p className="text-xs text-muted-foreground font-heading">
                  {t('dashboard.savedLayoutsEmpty')}
                </p>
              )}
            </div>
          )}

          {/* Fullscreen toolbar: shown only on mouse hover at the top */}
          {isFullscreen && onExitFullscreen && (
            <div className="fixed top-0 left-0 right-0 z-50 h-14 flex items-center justify-end px-4 bg-gradient-to-b from-black/70 to-transparent opacity-0 hover:opacity-100 transition-opacity duration-200">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  {hasEmbedSupport && allItems.length > 0 && (
                    <button
                      type="button"
                      onClick={handlePlayAllEmbedded}
                      className="flex items-center gap-2 py-2 px-3 rounded-lg font-heading text-xs font-bold bg-primary text-primary-foreground border border-primary hover:opacity-90"
                    >
                      <Play className="w-3.5 h-3.5" />
                      {t('dashboard.playAllEmbedded')}
                    </button>
                  )}
                <button
                  type="button"
                  onClick={() => setHideTitlesInFullscreen((v) => !v)}
                  title={hideTitlesInFullscreen ? t('dashboard.showTitles') : t('dashboard.hideTitles')}
                  className={`flex items-center gap-2 py-2 px-3 rounded-lg font-heading text-xs font-bold border transition-colors ${hideTitlesInFullscreen ? 'bg-primary/20 border-primary text-primary' : 'border-border bg-background/90 hover:bg-accent/50'}`}
                >
                  <Type className="w-3.5 h-3.5" />
                  {hideTitlesInFullscreen ? t('dashboard.showTitles') : t('dashboard.hideTitles')}
                </button>
                {showSyncButton && (
                  <button
                    type="button"
                    onClick={handleSync}
                    disabled={!canSync || syncStatus === 'syncing'}
                    title={t('sync.inProgressDescription')}
                    className="flex items-center gap-2 py-2 px-3 rounded-lg font-heading text-xs font-bold border border-border bg-background/90 hover:bg-accent/50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${syncStatus === 'syncing' ? 'animate-spin' : ''}`} />
                    {syncStatus === 'syncing' ? t('sync.inProgress') : t('sync.inProgressDescription')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={onExitFullscreen}
                  title={t('dashboard.exitFullscreen')}
                  className="flex items-center gap-2 py-2 px-3 rounded-lg font-heading text-sm font-bold border border-border bg-background/95 hover:bg-accent/50 transition-colors"
                >
                  <Minimize2 className="w-4 h-4" />
                  {t('dashboard.exitFullscreen')}
                </button>
              </div>
              <AnimatePresence>
                {showPlayAllLoadingHint && (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="text-[10px] text-muted-foreground font-heading max-w-xs"
                  >
                    {t('dashboard.playAllLoadingHint')}
                  </motion.p>
                )}
              </AnimatePresence>
              </div>
            </div>
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
