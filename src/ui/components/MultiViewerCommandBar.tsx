import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BarChart3, ChevronDown, Layers, Maximize2, Minimize2, PanelRight, Play, Plus, RefreshCw, Save, Trash2, Type } from 'lucide-react';
import { useLocale } from '../../i18n/LocaleContext';
import type { SyncStatus } from './SyncOverlay';
import type { SavedGrid } from './MultiViewer';

export function SavedLayoutsContent({
  savedGrids,
  onSave,
  onApply,
  onDelete,
}: {
  savedGrids: SavedGrid[];
  onSave: (name: string) => void;
  onApply: (preset: SavedGrid) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useLocale();
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [saveLayoutName, setSaveLayoutName] = useState('');
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const requestDelete = (id: string) => setConfirmingDeleteId(id);
  const cancelDelete = () => setConfirmingDeleteId(null);
  const confirmDelete = (id: string) => { setConfirmingDeleteId(null); onDelete(id); };

  return (
    <>
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
                    aria-label={t('dashboard.savedLayoutNamePlaceholder')}
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
                            onClick={() => onApply(preset)}
                            className="rounded font-heading border border-border hover:bg-accent/50 py-1 px-2 text-xs"
                          >
                            {t('dashboard.applyLayout')}
                          </button>
                          <button
                            type="button"
                            onClick={() => requestDelete(preset.id)}
                            title={t('dashboard.deleteLayout')}
                            aria-label={t('dashboard.deleteLayout')}
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
    </>
  );
}

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
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); rootRef.current?.querySelector('button')?.focus(); } };
    document.addEventListener('keydown', onKey);
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className={compact ? 'w-full' : 'relative shrink-0'} ref={rootRef}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={
          compact
            ? `flex items-center gap-2 rounded-lg font-heading font-bold border transition-colors w-full py-2 px-3 text-xs ${open ? 'bg-accent/50 border-primary/40' : 'border-border bg-accent/30 hover:bg-accent/50'}`
            : 'ui-button'
        }
      >
        <Layers className={compact ? 'w-3.5 h-3.5 shrink-0' : 'w-4 h-4 shrink-0'} aria-hidden />
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
            <SavedLayoutsContent savedGrids={savedGrids} onSave={onSave} onApply={(preset) => { onApply(preset); setOpen(false); }} onDelete={onDelete} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface MultiViewerCommandBarProps {
  layoutEditing?: boolean;
  /** Bar variant: controls after the playback actions (streams). */
  leading?: ReactNode;
  /** Bar variant: start of the right-hand group (audio). */
  trailing?: ReactNode;
  /** Bar variant: layout menu, between live timing and the window button. */
  menu?: ReactNode;
  /** Horizontal bar (default) vs vertical stack in fullscreen panel. */
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
  leading,
  trailing,
  menu,
  layoutEditing = false,
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

  // Bar buttons use `.ui-button` and show state through aria-pressed; compact ones are stacked rows.
  const base = compact
    ? 'flex items-center gap-2 rounded-lg font-heading font-bold border transition-colors py-2 px-3 text-xs disabled:opacity-50 disabled:cursor-not-allowed'
    : 'ui-button shrink-0';
  const neutral = compact ? `${base} border-border bg-accent/30 hover:bg-accent/50` : base;
  const toggled = (on: boolean) =>
    compact ? `${base} ${on ? 'bg-primary/20 border-primary text-primary' : 'border-border bg-accent/30 hover:bg-accent/50'}` : base;
  const icon = compact ? 'w-3.5 h-3.5 shrink-0' : 'w-4 h-4 shrink-0';

  const playAllBtn = hasEmbedSupport && (
    <button
      type="button"
      onClick={onPlayAll}
      disabled={anyLoading}
      className={compact ? `${base} bg-primary text-primary-foreground border-primary hover:opacity-90` : `${base} ui-primary`}
    >
      <Play className={icon} aria-hidden />
      {t('dashboard.playAllEmbedded')}
    </button>
  );

  const syncBtn = showSyncButton && (
    <button
      type="button"
      onClick={onSync}
      disabled={!canSync || syncStatus === 'syncing'}
      title={t('sync.inProgressDescription')}
      className={neutral}
    >
      <RefreshCw className={`${icon} ${syncStatus === 'syncing' ? 'animate-spin' : ''}`} aria-hidden />
      {syncStatus === 'syncing' ? t('sync.inProgress') : t('sync.button')}
    </button>
  );

  const titlesLabel = hideSlotTitles ? t('dashboard.showTitles') : t('dashboard.hideTitles');
  const hideTitlesBtn = (
    <button
      type="button"
      onClick={onToggleHideTitles}
      title={titlesLabel}
      aria-label={titlesLabel}
      aria-pressed={!hideSlotTitles}
      className={toggled(hideSlotTitles)}
    >
      <Type className={icon} aria-hidden />
      {compact && titlesLabel}
    </button>
  );

  const layoutsDropdown = hasStreams && !layoutEditing && (
    <LayoutsDropdown compact={compact} savedGrids={savedGrids} onSave={onSaveLayout} onApply={onApplyLayout} onDelete={onDeleteLayout} />
  );

  const multiviewBtn = multiviewControl && (
    <button
      type="button"
      onClick={multiviewControl.onOpen}
      title={multiviewControl.label}
      aria-label={multiviewControl.label}
      className={`relative ${neutral}`}
    >
      <Maximize2 className={icon} aria-hidden />
      {multiviewControl.label}
      {multiviewControl.openWindowCount > 0 && (
        <span className="ml-0.5 inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold tabular-nums">
          {multiviewControl.openWindowCount}
        </span>
      )}
    </button>
  );

  const liveTimingPopoutBtn = liveTiming && (
    <button
      type="button"
      onClick={liveTiming.onOpenPopout}
      title={t('timing.openWindowTitle')}
      aria-label={t('timing.openWindowTitle')}
      className={neutral}
    >
      <BarChart3 className={icon} aria-hidden />
      {t('timing.title')}
    </button>
  );

  const liveTimingDockBtn = liveTiming && (
    <button
      type="button"
      onClick={liveTiming.onToggleDock}
      title={t('timing.dockTitle')}
      aria-label={t('timing.dockTitle')}
      aria-pressed={liveTiming.dockOpen}
      className={toggled(liveTiming.dockOpen)}
    >
      <PanelRight className={icon} aria-hidden />
      {compact && t('timing.dock')}
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
            aria-label={t('dashboard.gridAddSlot')}
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
            aria-label={t('dashboard.exitFullscreen')}
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

  // Playback and streams on the left, audio, timing, layout and window on the right.
  // While editing only the edit actions are shown.
  if (layoutEditing) {
    return (
      <div className="workspace-toolbar" role="toolbar" aria-label={t('experience.editLayout')}>
        <span className="text-sm font-medium">{t('experience.editLayout')}</span>
        {leading}
      </div>
    );
  }
  const timingBtn = liveTiming && (
    <button
      type="button"
      onClick={liveTiming.onToggleDock}
      title={t('timing.dockTitle')}
      aria-pressed={liveTiming.dockOpen}
      className={neutral}
    >
      <BarChart3 className={icon} aria-hidden />
      {t('timing.title')}
    </button>
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="workspace-toolbar" role="toolbar">
        {playAllBtn}
        {(canSync || syncStatus === 'syncing') && syncBtn}
        {leading}
        <div className="flex flex-wrap items-center gap-2 ml-auto">
          {trailing}
          {timingBtn}
          {menu}
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
