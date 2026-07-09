import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BarChart3, ChevronDown, Layers, Maximize2, Minimize2, PanelRight, Play, Plus, RefreshCw, Save, Trash2, Type } from 'lucide-react';
import { useLocale } from '../../i18n/LocaleContext';
import type { SyncStatus } from './SyncOverlay';
import type { SavedGrid } from './MultiViewer';

/** Saved layouts menu. Delete needs a confirm step.
 *  Compact mode expands inline; an absolute popover gets clipped in that narrow scroll panel. */
function LayoutsDropdown({
  compact,
  savedGrids,
  onSave,
  onApply,
  onDelete,
}: {
  compact?: boolean;
  savedGrids: SavedGrid[];
  onSave: (name: string) => void;
  onApply: (preset: SavedGrid) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [saveLayoutName, setSaveLayoutName] = useState('');
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowSaveInput(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => () => {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
  }, []);

  function requestDelete(id: string) {
    setConfirmingDeleteId(id);
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = setTimeout(() => setConfirmingDeleteId(null), 3000);
  }

  function cancelDelete() {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    setConfirmingDeleteId(null);
  }

  function confirmDelete(id: string) {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    setConfirmingDeleteId(null);
    onDelete(id);
  }

  return (
    <div className={compact ? 'w-full' : 'relative shrink-0'} ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2 rounded-lg font-heading font-bold border transition-colors ${
          compact ? 'w-full py-2 px-3 text-xs' : 'py-2.5 px-4 text-sm tracking-wider'
        } ${open ? 'bg-accent/50 border-primary/40' : 'border-border bg-accent/30 hover:bg-accent/50'}`}
      >
        <Layers className={compact ? 'w-3.5 h-3.5 shrink-0' : 'w-4 h-4 shrink-0'} />
        {t('dashboard.savedLayouts')}
        <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ml-auto ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, height: compact ? 0 : undefined }}
            animate={{ opacity: 1, y: 0, height: compact ? 'auto' : undefined }}
            exit={{ opacity: 0, y: -6, height: compact ? 0 : undefined }}
            transition={{ duration: 0.15 }}
            className={
              compact
                ? 'w-full mt-1.5 overflow-hidden rounded-lg border border-border bg-popover shadow-xl p-2'
                : 'absolute left-0 top-full mt-1.5 z-[70] w-64 rounded-lg border border-border bg-popover shadow-xl p-2'
            }
          >
            <div className="flex items-center gap-2 mb-2">
              {showSaveInput ? (
                <>
                  <input
                    type="text"
                    value={saveLayoutName}
                    onChange={(e) => setSaveLayoutName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        onSave(saveLayoutName);
                        setSaveLayoutName('');
                        setShowSaveInput(false);
                      }
                    }}
                    placeholder={t('dashboard.savedLayoutNamePlaceholder')}
                    className="flex-1 min-w-0 rounded-md border border-border bg-background font-heading px-2 py-1.5 text-xs"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => {
                      onSave(saveLayoutName);
                      setSaveLayoutName('');
                      setShowSaveInput(false);
                    }}
                    className="shrink-0 flex items-center gap-1 rounded-md font-heading font-bold bg-primary text-primary-foreground hover:opacity-90 py-1.5 px-2 text-[11px]"
                  >
                    <Save className="w-3 h-3" />
                    {t('dashboard.saveLayout')}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowSaveInput(true)}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-md font-heading font-bold border border-border bg-accent/20 hover:bg-accent/40 py-1.5 px-2 text-xs"
                >
                  <Save className="w-3.5 h-3.5" />
                  {t('dashboard.saveCurrentLayout')}
                </button>
              )}
            </div>

            {savedGrids.length > 0 ? (
              <ul className="space-y-1 max-h-64 overflow-y-auto">
                {savedGrids.map((preset) => (
                  <li
                    key={preset.id}
                    className="flex items-center justify-between gap-2 rounded bg-background/50 py-1.5 px-2"
                  >
                    {confirmingDeleteId === preset.id ? (
                      <div className="flex items-center justify-between gap-2 w-full">
                        <span className="text-[11px] text-muted-foreground font-heading">
                          {t('dashboard.deleteLayout')}?
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => confirmDelete(preset.id)}
                            className="rounded px-2 py-0.5 text-[11px] font-heading font-bold bg-destructive/20 text-destructive hover:bg-destructive/30"
                          >
                            {t('ui.yes')}
                          </button>
                          <button
                            type="button"
                            onClick={cancelDelete}
                            className="rounded px-2 py-0.5 text-[11px] font-heading border border-border hover:bg-accent/50"
                          >
                            {t('ui.no')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <span className="font-heading text-sm truncate min-w-0">{preset.name}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              onApply(preset);
                              setOpen(false);
                            }}
                            className="rounded font-heading border border-border hover:bg-accent/50 py-1 px-2 text-xs"
                          >
                            {t('dashboard.applyLayout')}
                          </button>
                          <button
                            type="button"
                            onClick={() => requestDelete(preset.id)}
                            title={t('dashboard.deleteLayout')}
                            className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              !showSaveInput && (
                <p className="text-xs text-muted-foreground font-heading px-1 py-1">
                  {t('dashboard.savedLayoutsEmpty')}
                </p>
              )
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface MultiViewerCommandBarProps {
  /** Horizontal sticky bar (default) vs vertical stack in fullscreen panel. */
  variant: 'bar' | 'compact';
  hasEmbedSupport: boolean;
  hasStreams: boolean;
  anyLoading: boolean;
  onPlayAll: () => void;
  showSyncButton: boolean;
  canSync: boolean;
  syncStatus: SyncStatus;
  onSync: () => void;
  hideSlotTitles: boolean;
  onToggleHideTitles: () => void;
  savedGrids: SavedGrid[];
  onSaveLayout: (name: string) => void;
  onApplyLayout: (preset: SavedGrid) => void;
  onDeleteLayout: (id: string) => void;
  showPlayAllLoadingHint: boolean;
  /** Popout / in-window fullscreen. Omitted when neither is available. */
  multiviewControl?: {
    onOpen: () => void;
    openWindowCount: number;
    label: string;
  };
  /** Extra buttons shown only in compact fullscreen panel. */
  compactExtra?: {
    onAddSlot?: () => void;
    onExitFullscreen: () => void;
  };
  /** Live timing popout + dock toggle. Needs session info. */
  liveTiming?: {
    onOpenPopout: () => void;
    dockOpen: boolean;
    onToggleDock: () => void;
  };
}

export function MultiViewerCommandBar({
  variant,
  hasEmbedSupport,
  hasStreams,
  anyLoading,
  onPlayAll,
  showSyncButton,
  canSync,
  syncStatus,
  onSync,
  hideSlotTitles,
  onToggleHideTitles,
  savedGrids,
  onSaveLayout,
  onApplyLayout,
  onDeleteLayout,
  showPlayAllLoadingHint,
  multiviewControl,
  compactExtra,
  liveTiming,
}: MultiViewerCommandBarProps) {
  const { t } = useLocale();
  const compact = variant === 'compact';

  const playAllBtn = hasEmbedSupport && (
    <button
      type="button"
      onClick={onPlayAll}
      disabled={anyLoading}
      className={`flex items-center gap-2 rounded-lg font-heading font-bold bg-primary text-primary-foreground border border-primary hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed ${
        compact ? 'py-2 px-3 text-xs' : 'py-2.5 px-4 text-sm tracking-wider'
      }`}
    >
      <Play className={compact ? 'w-3.5 h-3.5 shrink-0' : 'w-4 h-4'} />
      {t('dashboard.playAllEmbedded')}
    </button>
  );

  const syncBtn = showSyncButton && (
    <button
      type="button"
      onClick={onSync}
      disabled={!canSync || syncStatus === 'syncing'}
      title={t('sync.inProgressDescription')}
      className={`flex items-center gap-2 rounded-lg font-heading font-bold border border-border bg-accent/30 hover:bg-accent/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
        compact ? 'py-2 px-3 text-xs' : 'py-2.5 px-4 text-sm tracking-wider'
      }`}
    >
      <RefreshCw className={`${compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} shrink-0 ${syncStatus === 'syncing' ? 'animate-spin' : ''}`} />
      {syncStatus === 'syncing' ? t('sync.inProgress') : t('sync.button')}
    </button>
  );

  const hideTitlesBtn = (
    <button
      type="button"
      onClick={onToggleHideTitles}
      title={hideSlotTitles ? t('dashboard.showTitles') : t('dashboard.hideTitles')}
      className={`flex items-center gap-2 rounded-lg font-heading font-bold border transition-colors shrink-0 ${
        hideSlotTitles ? 'bg-primary/20 border-primary text-primary' : 'border-border bg-accent/30 hover:bg-accent/50'
      } ${compact ? 'py-2 px-3 text-xs' : 'py-2.5 px-4 text-sm tracking-wider'}`}
    >
      <Type className={compact ? 'w-3.5 h-3.5 shrink-0' : 'w-4 h-4 shrink-0'} />
      {hideSlotTitles ? t('dashboard.showTitles') : t('dashboard.hideTitles')}
    </button>
  );

  const layoutsDropdown = hasStreams && (
    <LayoutsDropdown compact={compact} savedGrids={savedGrids} onSave={onSaveLayout} onApply={onApplyLayout} onDelete={onDeleteLayout} />
  );

  const multiviewBtn = multiviewControl && (
    <button
      type="button"
      onClick={multiviewControl.onOpen}
      title={multiviewControl.label}
      className={`relative flex items-center gap-2 rounded-lg font-heading font-bold border border-border bg-accent/30 hover:bg-accent/50 transition-colors shrink-0 ${
        compact ? 'py-2 px-3 text-xs' : 'py-2.5 px-4 text-sm tracking-wider'
      }`}
    >
      <Maximize2 className={compact ? 'w-3.5 h-3.5 shrink-0' : 'w-4 h-4 shrink-0'} />
      {multiviewControl.label}
      {multiviewControl.openWindowCount > 0 && (
        <span className="ml-0.5 inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
          {multiviewControl.openWindowCount}
        </span>
      )}
    </button>
  );

  const liveTimingPopoutBtn = liveTiming && (
    <button
      type="button"
      onClick={liveTiming.onOpenPopout}
      title="Open Live Timing window"
      className={`flex items-center gap-2 rounded-lg font-heading font-bold border border-border bg-accent/30 hover:bg-accent/50 transition-colors shrink-0 ${
        compact ? 'py-2 px-3 text-xs' : 'py-2.5 px-4 text-sm tracking-wider'
      }`}
    >
      <BarChart3 className={`${compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} shrink-0 text-emerald-400`} />
      Live Timing
    </button>
  );

  const liveTimingDockBtn = liveTiming && (
    <button
      type="button"
      onClick={liveTiming.onToggleDock}
      title="Dock live timing in this window"
      className={`flex items-center gap-2 rounded-lg font-heading font-bold border transition-colors shrink-0 ${
        liveTiming.dockOpen ? 'bg-primary/20 border-primary text-primary' : 'border-border bg-accent/30 hover:bg-accent/50'
      } ${compact ? 'py-2 px-3 text-xs' : 'py-2.5 px-4 text-sm tracking-wider'}`}
    >
      <PanelRight className={compact ? 'w-3.5 h-3.5 shrink-0' : 'w-4 h-4 shrink-0'} />
      Dock
    </button>
  );

  if (compact) {
    return (
      <div className="flex flex-col gap-2">
        {playAllBtn}
        {hideTitlesBtn}
        {compactExtra?.onAddSlot && (
          <button
            type="button"
            onClick={compactExtra.onAddSlot}
            title={t('dashboard.gridAddSlot')}
            className="flex items-center gap-2 py-2 px-3 rounded-lg font-heading text-xs font-bold border border-border bg-accent/40 hover:bg-accent/60 transition-colors"
          >
            <Plus className="w-3.5 h-3.5 shrink-0" />
            {t('dashboard.gridAddSlot')}
          </button>
        )}
        {syncBtn}
        {layoutsDropdown}
        {(liveTimingPopoutBtn || liveTimingDockBtn) && (
          <div className="flex flex-col gap-2 pt-2 mt-1 border-t border-border/60">
            {liveTimingPopoutBtn}
            {liveTimingDockBtn}
          </div>
        )}
        {compactExtra && (
          <button
            type="button"
            onClick={compactExtra.onExitFullscreen}
            title={t('dashboard.exitFullscreen')}
            className="flex items-center gap-2 py-2 px-3 rounded-lg font-heading text-sm font-bold border border-border bg-card hover:bg-accent/50 transition-colors"
          >
            <Minimize2 className="w-4 h-4 shrink-0" />
            {t('dashboard.exitFullscreen')}
          </button>
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
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3 flex-wrap">
        {playAllBtn}
        {syncBtn}
        {hideTitlesBtn}
        {layoutsDropdown}
        <div className="flex items-center gap-3 ml-auto">
          {liveTimingPopoutBtn}
          {liveTimingDockBtn}
          {multiviewBtn}
        </div>
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
  );
}
