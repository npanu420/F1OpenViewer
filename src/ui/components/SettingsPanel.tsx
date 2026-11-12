import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Sun, Moon, Globe, RotateCcw, Star } from 'lucide-react';
import { useLocale } from '../../i18n/LocaleContext';
import { LANGUAGES, type Locale } from '../../i18n/translations';
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

import { Dialog } from './Dialog';
import { toggleFavoriteDriver, useFavoriteDrivers } from '../../services/favoriteDrivers';
import {
  AUTO_HIDE_OPTIONS,
  LIVE_DELAY_OPTIONS,
  MAX_AUTO_TILES_OPTIONS,
  resetPreferences,
  setPreference,
  usePreferences,
  type BufferSize,
  type DriverHudMode,
  type StartAudio,
  type VideoQuality,
} from '../../services/preferences';

export type ThemeMode = 'dark' | 'light';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  isSignedIn: boolean;
  onLogout: () => Promise<void>;
}

/** Label and hint on the left, control on the right (wraps under on narrow panels). */
function SettingRow({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <label htmlFor={htmlFor} className="min-w-0 flex-1">
        <span className="block text-sm">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground mt-0.5">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

function SettingSwitch({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="settings-row settings-switch-row" onClick={() => onChange(!checked)}>
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-sm">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground mt-0.5">{hint}</span>}
      </span>
      <span className="ui-switch" data-on={checked ? 'true' : undefined} aria-hidden />
    </button>
  );
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
      <h3 className="text-sm font-semibold text-foreground">
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
  const favoriteDrivers = useFavoriteDrivers();
  const prefs = usePreferences();
  const seconds = (n: number) => t('settings.seconds').replace('{n}', String(n));
  const [resetError, setResetError] = useState(false);
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

  // Esc closes the panel (keyboard users had no way out besides tabbing to the X).
  // Dialog also contains focus and restores the invoking control.

  async function handleFullReset() {
    if (!window.f1?.fullReset) return;
    const confirmed = window.confirm(t('settings.resetConfirm'));
    if (!confirmed) return;
    setResetError(false);
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
      setResetError(true);
    }
  }

  return (
    <Dialog open={isOpen} onDismiss={onClose} className="settings-dialog" labelledBy="settings-title">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
              <h2 id="settings-title" className="font-heading text-lg font-bold tracking-wider">
                {t('settings.title')}
              </h2>
              <motion.button
                type="button"
                onClick={onClose}
                aria-label={t('ui.close')}
                title={t('ui.close')}
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
                <label className="flex items-center gap-3">
                  <Globe className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />
                  <select className="ui-input flex-1" aria-label={t('settings.languageLabel')} value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
                    {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.wip ? `${l.name} (beta)` : l.name}</option>)}
                  </select>
                </label>
                {LANGUAGES.find((l) => l.code === locale)?.wip && <p className="text-xs text-muted-foreground">{t('settings.languageWip')}</p>}
              </SettingGroup>

              <SettingGroup title={t('ui.appearance')}>
                <div className="flex gap-2">
                  {[
                    { mode: 'dark' as ThemeMode, icon: Moon, label: t('ui.themeDark') },
                    { mode: 'light' as ThemeMode, icon: Sun, label: t('ui.themeLight') },
                  ].map(({ mode, icon: ModeIcon, label }) => (
                    <motion.button
                      key={mode}
                      aria-pressed={theme === mode}
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

              <SettingGroup title={t('settings.favoriteDrivers')}>
                <p className="text-sm text-muted-foreground">{t('settings.favoriteDriversHint')}</p>
                {favoriteDrivers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('settings.favoriteDriversEmpty')}</p>
                ) : (
                  <ol className="space-y-1">
                    {favoriteDrivers.map((name, index) => (
                      <li key={name} className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm">
                        <span className="w-4 text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                        <Star className="w-3.5 h-3.5 text-amber-400 shrink-0" fill="currentColor" aria-hidden />
                        <span className="flex-1 min-w-0 truncate">{name}</span>
                        <button
                          type="button"
                          onClick={() => toggleFavoriteDriver(name)}
                          aria-label={`${t('experience.unfavorite')}: ${name}`}
                          title={t('experience.unfavorite')}
                          className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </SettingGroup>

              <SettingGroup title={t('settings.playback')}>
                <SettingRow label={t('settings.videoQuality')} hint={t('settings.videoQualityHint')} htmlFor="pref-quality">
                  <select id="pref-quality" className="ui-input settings-select" value={prefs.videoQuality} onChange={(e) => setPreference('videoQuality', e.target.value as VideoQuality)}>
                    <option value="auto">{t('settings.qualityAuto')}</option>
                    <option value="max">{t('settings.qualityMax')}</option>
                    <option value="720">{t('settings.quality720')}</option>
                    <option value="480">{t('settings.quality480')}</option>
                  </select>
                </SettingRow>
                <SettingRow label={t('settings.liveDelay')} hint={t('settings.liveDelayHint')} htmlFor="pref-live-delay">
                  <select id="pref-live-delay" className="ui-input settings-select" value={prefs.liveDelaySeconds} onChange={(e) => setPreference('liveDelaySeconds', Number(e.target.value))}>
                    {LIVE_DELAY_OPTIONS.map((n) => <option key={n} value={n}>{n === 4 ? `${t('settings.liveDelayLowest')} (${seconds(n)})` : seconds(n)}</option>)}
                  </select>
                </SettingRow>
                <SettingSwitch label={t('settings.lowLatency')} hint={t('settings.lowLatencyHint')} checked={prefs.lowLatencyLive} onChange={(v) => setPreference('lowLatencyLive', v)} />
                <SettingRow label={t('settings.bufferSize')} hint={t('settings.bufferHint')} htmlFor="pref-buffer">
                  <select id="pref-buffer" className="ui-input settings-select" value={prefs.bufferSize} onChange={(e) => setPreference('bufferSize', e.target.value as BufferSize)}>
                    <option value="low">{t('settings.bufferLow')}</option>
                    <option value="normal">{t('settings.bufferNormal')}</option>
                    <option value="high">{t('settings.bufferHigh')}</option>
                  </select>
                </SettingRow>
                <SettingRow label={t('settings.startAudio')} htmlFor="pref-start-audio">
                  <select id="pref-start-audio" className="ui-input settings-select" value={prefs.startAudio} onChange={(e) => setPreference('startAudio', e.target.value as StartAudio)}>
                    <option value="muted">{t('settings.startAudioMuted')}</option>
                    <option value="main">{t('settings.startAudioMain')}</option>
                  </select>
                </SettingRow>
              </SettingGroup>

              <SettingGroup title={t('settings.multiview')}>
                <SettingSwitch label={t('settings.autoSync')} hint={t('settings.autoSyncHint')} checked={prefs.autoSync} onChange={(v) => setPreference('autoSync', v)} />
                <SettingSwitch label={t('settings.hideDataWithTiming')} hint={t('settings.hideDataWithTimingHint')} checked={prefs.hideDataWithTiming} onChange={(v) => setPreference('hideDataWithTiming', v)} />
                <SettingSwitch label={t('settings.smartAutoLayout')} hint={t('settings.smartAutoLayoutHint')} checked={prefs.smartAutoLayout} onChange={(v) => setPreference('smartAutoLayout', v)} />
                <SettingRow label={t('settings.driverHud')} hint={t('settings.driverHudHint')} htmlFor="pref-driver-hud">
                  <select id="pref-driver-hud" className="ui-input settings-select" value={prefs.driverHud} onChange={(e) => setPreference('driverHud', e.target.value as DriverHudMode)}>
                    <option value="timing">{t('settings.driverHudTiming')}</option>
                    <option value="always">{t('settings.driverHudAlways')}</option>
                    <option value="off">{t('settings.driverHudOff')}</option>
                  </select>
                </SettingRow>
                <SettingRow label={t('settings.maxTiles')} hint={t('settings.maxTilesHint')} htmlFor="pref-max-tiles">
                  <select id="pref-max-tiles" className="ui-input settings-select" value={prefs.maxAutoTiles} onChange={(e) => setPreference('maxAutoTiles', Number(e.target.value))}>
                    {MAX_AUTO_TILES_OPTIONS.map((n) => <option key={n} value={n}>{n === 0 ? t('settings.maxTilesAny') : n}</option>)}
                  </select>
                </SettingRow>
                <SettingRow label={t('settings.autoHide')} hint={t('settings.autoHideHint')} htmlFor="pref-auto-hide">
                  <select id="pref-auto-hide" className="ui-input settings-select" value={prefs.autoHideSeconds} onChange={(e) => setPreference('autoHideSeconds', Number(e.target.value))}>
                    {AUTO_HIDE_OPTIONS.map((n) => <option key={n} value={n}>{n === 0 ? t('settings.autoHideNever') : seconds(n)}</option>)}
                  </select>
                </SettingRow>
                <button type="button" className="ui-button w-full" onClick={resetPreferences}>
                  <RotateCcw className="w-4 h-4" aria-hidden />{t('settings.restoreDefaults')}
                </button>
              </SettingGroup>

              <details className="border-t border-border pt-4"><summary className="cursor-pointer text-sm font-semibold mb-4">{t('experience.advanced')}</summary><SettingGroup title={t('settings.syncSection')}>
                <p className="text-sm text-muted-foreground pb-1">
                  {t('settings.syncToleranceHint')}
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={MIN_SYNC_OFFSET_THRESHOLD}
                    max={MAX_SYNC_OFFSET_THRESHOLD}
                    step={0.005}
                    aria-label={t('settings.syncToleranceHint')}
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
                    aria-label={t('settings.syncDoneDelayHint')}
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

              </details>
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
                {resetError && <p role="alert" className="text-sm text-destructive">{t('experience.resetError')}</p>}
                {resetDone && (
                  <p className="text-xs text-muted-foreground pt-1">{t('settings.resetDone')}</p>
                )}
              </SettingGroup>

              <div className="pt-4 border-t border-border/50">
                <p className="text-xs text-muted-foreground text-center font-heading tracking-wider">
                  OpenViewer by npanu420
                </p>
              </div>
            </div>
    </Dialog>
  );
}
