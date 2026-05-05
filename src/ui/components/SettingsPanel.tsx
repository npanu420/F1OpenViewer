import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sun, Moon, Globe, RotateCcw } from 'lucide-react';
import { useLocale } from '../../i18n/LocaleContext';
import {
  getSyncOffsetThreshold,
  setSyncOffsetThreshold,
  getSyncDoneDelayMs,
  setSyncDoneDelayMs,
  getSyncKeepLocked,
  setSyncKeepLocked,
  getSyncReferenceMode,
  setSyncReferenceMode,
  type SyncReferenceMode,
  DEFAULT_SYNC_OFFSET_THRESHOLD,
  DEFAULT_SYNC_DONE_DELAY_MS,
  MIN_SYNC_OFFSET_THRESHOLD,
  MAX_SYNC_OFFSET_THRESHOLD,
  MIN_SYNC_DONE_DELAY_MS,
  MAX_SYNC_DONE_DELAY_MS,
} from '../../services/syncSettings';

export type ThemeMode = 'dark' | 'light';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  isSignedIn: boolean;
  onLogout: () => Promise<void>;
}

function SettingGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <h3 className="font-heading text-xs font-bold tracking-widest text-muted-foreground uppercase">
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

export function SettingsPanel({
  isOpen,
  onClose,
  theme,
  onThemeChange,
  isSignedIn,
  onLogout,
}: SettingsPanelProps) {
  const { t, locale, setLocale } = useLocale();
  const [resetting, setResetting] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [syncTolerance, setSyncToleranceState] = useState(DEFAULT_SYNC_OFFSET_THRESHOLD);
  const [syncDoneDelay, setSyncDoneDelayState] = useState(DEFAULT_SYNC_DONE_DELAY_MS);
  const [syncKeepLocked, setSyncKeepLockedState] = useState(false);
  const [syncRefMode, setSyncRefModeState] = useState<SyncReferenceMode>('latest');

  useEffect(() => {
    setSyncToleranceState(getSyncOffsetThreshold());
    setSyncDoneDelayState(getSyncDoneDelayMs());
    setSyncKeepLockedState(getSyncKeepLocked());
    setSyncRefModeState(getSyncReferenceMode());
  }, [isOpen]);

  async function handleFullReset() {
    if (!window.f1?.fullReset) return;
    const confirmed = window.confirm(t('settings.resetConfirm'));
    if (!confirmed) return;
    setResetting(true);
    setResetDone(false);
    try {
      await window.f1.fullReset();
      setResetDone(true);
      onClose();
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      console.warn('[Settings] fullReset failed:', e);
      setResetting(false);
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-background/60 backdrop-blur-sm z-50"
            onClick={onClose}
          />

          <motion.div
            initial={{ opacity: 0, x: 300 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 300 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed right-0 top-0 bottom-0 w-full max-w-md z-50 glass-panel border-l border-border overflow-y-auto"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
              <h2 className="font-heading text-lg font-bold tracking-wider">
                {t('settings.title').toUpperCase()}
              </h2>
              <motion.button
                onClick={onClose}
                className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-accent transition-colors"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <X className="w-4 h-4" />
              </motion.button>
            </div>

            <div className="px-6 py-6 space-y-8">
              <SettingGroup title={t('settings.account')}>
                <div className="py-2 px-3 rounded-md text-sm text-muted-foreground">
                  {isSignedIn ? t('settings.accountSignedIn') : t('settings.accountNotAvailable')}
                </div>
                {isSignedIn && (
                  <button
                    type="button"
                    onClick={() => onLogout()}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-md font-heading text-sm font-bold tracking-wider bg-destructive/20 text-destructive border border-destructive/40 hover:bg-destructive/30 transition-colors"
                  >
                    {t('settings.logout')}
                  </button>
                )}
              </SettingGroup>

              <SettingGroup title={t('settings.languageLabel')}>
                <div className="flex gap-2">
                    {[
                      { loc: 'en' as const, label: t('ui.english') },
                      { loc: 'it' as const, label: t('ui.italian') },
                    ].map(({ loc, label }) => (
                    <motion.button
                      key={loc}
                      onClick={() => setLocale(loc)}
                      className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-md font-heading text-sm font-bold tracking-wider transition-colors border ${
                        locale === loc
                          ? 'bg-primary text-primary-foreground border-primary glow-red'
                          : 'bg-accent/30 text-muted-foreground border-border hover:text-foreground'
                      }`}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <Globe className="w-4 h-4" />
                      {label}
                    </motion.button>
                  ))}
                </div>
              </SettingGroup>

              <SettingGroup title={t('ui.appearance')}>
                <div className="flex gap-2">
                  {[
                    { mode: 'dark' as ThemeMode, icon: Moon, label: t('ui.themeDark') },
                    { mode: 'light' as ThemeMode, icon: Sun, label: t('ui.themeLight') },
                  ].map(({ mode, icon: ModeIcon, label }) => (
                    <motion.button
                      key={mode}
                      onClick={() => onThemeChange(mode)}
                      className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-md font-heading text-sm font-bold tracking-wider transition-colors border ${
                        theme === mode
                          ? 'bg-primary text-primary-foreground border-primary glow-red'
                          : 'bg-accent/30 text-muted-foreground border-border hover:text-foreground'
                      }`}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <ModeIcon className="w-4 h-4" />
                      {label}
                    </motion.button>
                  ))}
                </div>
              </SettingGroup>

              <SettingGroup title={t('settings.syncSection')}>
                <p className="text-sm text-muted-foreground pb-1">
                  {t('settings.syncToleranceHint')}
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={MIN_SYNC_OFFSET_THRESHOLD}
                    max={MAX_SYNC_OFFSET_THRESHOLD}
                    step={0.005}
                    value={syncTolerance}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!Number.isNaN(v)) {
                        setSyncToleranceState(v);
                        setSyncOffsetThreshold(v);
                      }
                    }}
                    className="flex-1 px-3 py-2 rounded-md border border-border bg-background text-sm font-heading"
                  />
                  <span className="text-xs text-muted-foreground shrink-0">s</span>
                </div>
                <p className="text-sm text-muted-foreground pt-2 pb-1">
                  {t('settings.syncDoneDelayHint')}
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={MIN_SYNC_DONE_DELAY_MS}
                    max={MAX_SYNC_DONE_DELAY_MS}
                    step={50}
                    value={syncDoneDelay}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (!Number.isNaN(v)) {
                        setSyncDoneDelayState(v);
                        setSyncDoneDelayMs(v);
                      }
                    }}
                    className="flex-1 px-3 py-2 rounded-md border border-border bg-background text-sm font-heading"
                  />
                  <span className="text-xs text-muted-foreground shrink-0">ms</span>
                </div>
                <p className="text-sm text-muted-foreground pt-2 pb-1">
                  {t('settings.syncReferenceHint')}
                </p>
                <div className="flex gap-2">
                  {([
                    { mode: 'latest' as const, label: t('settings.syncReferenceLatest') },
                    { mode: 'first' as const, label: t('settings.syncReferenceFirst') },
                  ]).map(({ mode, label }) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        setSyncRefModeState(mode);
                        setSyncReferenceMode(mode);
                      }}
                      className={`flex-1 py-2 rounded-md font-heading text-xs font-bold tracking-wider transition-colors border ${
                        syncRefMode === mode
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-accent/30 text-muted-foreground border-border hover:text-foreground'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <label className="flex items-center justify-between gap-3 pt-3 cursor-pointer select-none">
                  <span className="text-sm">
                    {t('settings.syncKeepLockedLabel')}
                    <span className="block text-xs text-muted-foreground mt-0.5">
                      {t('settings.syncKeepLockedHint')}
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={syncKeepLocked}
                    onChange={(e) => {
                      setSyncKeepLockedState(e.target.checked);
                      setSyncKeepLocked(e.target.checked);
                    }}
                    className="w-5 h-5 accent-primary shrink-0"
                  />
                </label>
              </SettingGroup>

              <SettingGroup title={t('settings.dataAndCache')}>
                <p className="text-sm text-muted-foreground pb-1">
                  {t('settings.resetDescription')}
                </p>
                <button
                  type="button"
                  onClick={handleFullReset}
                  disabled={resetting}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-md font-heading text-sm font-bold tracking-wider bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/40 hover:bg-amber-500/30 transition-colors disabled:opacity-50"
                >
                  {resetting ? (
                    <span className="animate-pulse">{t('settings.resetting')}</span>
                  ) : (
                    <>
                      <RotateCcw className="w-4 h-4" />
                      {t('settings.resetData')}
                    </>
                  )}
                </button>
                {resetDone && (
                  <p className="text-xs text-muted-foreground pt-1">{t('settings.resetDone')}</p>
                )}
              </SettingGroup>

              <div className="pt-4 border-t border-border/50">
                <p className="text-xs text-muted-foreground text-center font-heading tracking-wider">
                  F1 Open Viewer by npanu420
                </p>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
