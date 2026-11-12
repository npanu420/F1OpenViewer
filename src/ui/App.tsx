import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import type { CatalogItem } from '../domain/catalog';
import { getCatalog } from '../services/catalog';
import { getVodSeasons } from '../services/vod';
import { session } from '../services/session';
import { useLocale } from '../i18n/LocaleContext';
import { Header } from './components/Header';
import { SettingsPanel, type ThemeMode } from './components/SettingsPanel';
import { X, WifiOff } from 'lucide-react';

// Each window type only downloads/parses what it renders: the live-timing popout no longer
// carries Shaka + react-grid-layout, the main window no longer the standalone views.
const LoginView = lazy(() => import('./views/LoginView').then((m) => ({ default: m.LoginView })));
const DashboardView = lazy(() => import('./views/DashboardView').then((m) => ({ default: m.DashboardView })));
const StandaloneMultiviewView = lazy(() => import('./views/StandaloneMultiviewView').then((m) => ({ default: m.StandaloneMultiviewView })));
const StandalonePlayerView = lazy(() => import('./views/StandalonePlayerView').then((m) => ({ default: m.StandalonePlayerView })));
const LiveTimingView = lazy(() => import('./views/LiveTimingView').then((m) => ({ default: m.LiveTimingView })));
const LiveEventView = lazy(() => import('./views/LiveEventView').then((m) => ({ default: m.LiveEventView })));

/** Full-window placeholder while the session restores or a view chunk loads. */
function BootScreen({ label }: { label?: string }) {
  return (
    <div className="h-full min-h-[50vh] bg-background flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto mb-3" />
        {label && <p className="text-xs text-muted-foreground font-heading tracking-wider">{label}</p>}
      </div>
    </div>
  );
}

const DISMISSED_UPDATE_KEY = 'f1-dismissed-update-version';

type Route =
  | { name: 'boot' }
  | { name: 'offline' }
  | { name: 'login' }
  | { name: 'dashboard' }
  | { name: 'live'; item: CatalogItem };

export function App() {
  const { t } = useLocale();
  // 'boot' until the saved session is checked: starting on 'login' flashed the sign-in form on
  // every launch (and let the user start a sign-in) before the dashboard replaced it.
  const [route, setRoute] = useState<Route>({ name: 'boot' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [vodSeasons, setVodSeasons] = useState<Array<{ year: number; pageId: number }>>([]);
  const [signedIn, setSignedIn] = useState(false);
  const [selectedYear, setSelectedYear] = useState<number>(() => new Date().getFullYear());
  /** True once the user picked a season; until then the newest available season is auto-selected. */
  const yearPickedRef = useRef(false);
  const handleSelectYear = (year: number) => {
    yearPickedRef.current = true;
    setSelectedYear(year);
  };
  const [showSettings, setShowSettings] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(() => {
    return (typeof localStorage !== 'undefined' && (localStorage.getItem('f1-theme') as ThemeMode)) || 'dark';
  });
  const bootOnceRef = useRef(false);
  /** Bumped on every catalog load and on sign-out: a load that finishes later is discarded. */
  const catalogReqRef = useRef(0);
  const [updateInfo, setUpdateInfo] = useState<{ version: string; url: string } | null>(null);

  // Main process checks GitHub releases once at startup and only tells the main window.
  useEffect(() => {
    return window.f1?.onUpdateAvailable?.((payload) => {
      try {
        if (localStorage.getItem(DISMISSED_UPDATE_KEY) === payload.version) return;
      } catch (_) {}
      setUpdateInfo(payload);
    });
  }, []);

  const dismissUpdate = () => {
    if (updateInfo) {
      try { localStorage.setItem(DISMISSED_UPDATE_KEY, updateInfo.version); } catch (_) {}
      window.f1?.setSetting?.(DISMISSED_UPDATE_KEY, updateInfo.version);
    }
    setUpdateInfo(null);
  };

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') {
      root.classList.add('light');
    } else {
      root.classList.remove('light');
    }
    try { localStorage.setItem('f1-theme', theme); } catch (_) {}
    window.f1?.setSetting?.('f1-theme', theme);
  }, [theme]);

  async function restore() {
    setRoute({ name: 'boot' });
    if (window.f1?.restoreSession) {
      const result: { restored: boolean; offline?: boolean } = await window.f1
        .restoreSession()
        .catch(() => ({ restored: false }));
      if (result.restored) {
        setSignedIn(true);
        setRoute({ name: 'dashboard' });
        loadCatalog();
        return;
      }
      if (result.offline) {
        // Saved session kept in main: offer a retry instead of a silent drop to the login form.
        setRoute({ name: 'offline' });
        return;
      }
    } else if ((await session.get()).signedIn) {
      setSignedIn(true);
      setRoute({ name: 'dashboard' });
      return;
    }
    setRoute({ name: 'login' });
  }

  useEffect(() => {
    if (bootOnceRef.current) return;
    bootOnceRef.current = true;
    restore().catch(() => setRoute({ name: 'login' }));
  }, []);

  async function loadCatalog() {
    const req = ++catalogReqRef.current;
    setBusy(true);
    setError(null);
    try {
      const results = await Promise.allSettled([
        getCatalog((items) => {
          if (req === catalogReqRef.current) setCatalog(items);
        }),
        getVodSeasons().then((seasons) => {
          if (req !== catalogReqRef.current) return;
          setVodSeasons(seasons);
          if (seasons.length > 0 && !yearPickedRef.current) {
            setSelectedYear(seasons[0].year);
          }
        }),
      ]);
      const failure = results.find((result) => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
    } catch (e) {
      if (req !== catalogReqRef.current) return;
      setError(e instanceof Error ? e.message : t('error.catalogLoad'));
    } finally {
      if (req === catalogReqRef.current) setBusy(false);
    }
  }

  /** Back to the sign-in screen with empty state (shared by sign-out and session expiry). */
  function resetToLogin(message: string | null) {
    catalogReqRef.current += 1;
    setBusy(false);
    setSignedIn(false);
    setCatalog([]);
    setVodSeasons([]);
    yearPickedRef.current = false;
    setSelectedYear(new Date().getFullYear());
    setShowSettings(false);
    setError(message);
    setRoute({ name: 'login' });
  }

  async function logout() {
    try {
      await session.clear();
    } catch (e) {
      console.warn('[App] sign-out failed in main:', e);
    } finally {
      resetToLogin(null);
    }
  }

  // Main dropped the session (F1 rejected the token mid-use): go to sign-in with an explanation.
  const signedInRef = useRef(false);
  signedInRef.current = signedIn;
  useEffect(() => {
    return window.f1?.onSessionExpired?.(() => {
      if (signedInRef.current) resetToLogin(t('error.sessionExpired'));
    });
  }, [t]);

  if (typeof window !== 'undefined') {
    const raw = window.location.hash.replace(/^#/, '');
    if (raw === 'standalone-multiview' || raw.startsWith('standalone-multiview?')) {
      let multiviewInstanceId: number | undefined;
      const q = raw.includes('?') ? raw.split('?')[1] : '';
      const mv = new URLSearchParams(q).get('mv');
      if (mv != null) {
        const n = parseInt(mv, 10);
        if (Number.isFinite(n) && n > 0) multiviewInstanceId = n;
      }
      return (
        <Suspense fallback={<BootScreen />}>
          <StandaloneMultiviewView multiviewInstanceId={multiviewInstanceId} />
        </Suspense>
      );
    }
    if (raw === 'standalone-livetiming' || raw.startsWith('standalone-livetiming?')) {
      return (
        <Suspense fallback={<BootScreen />}>
          <LiveTimingView />
        </Suspense>
      );
    }
    if (raw.startsWith('standalone-player?')) {
      const params = new URLSearchParams(raw.split('?')[1]);
      const contentId = parseInt(params.get('content') ?? '', 10);
      const channelRaw = params.get('channel');
      const channelId = channelRaw != null && channelRaw !== '' ? parseInt(channelRaw, 10) : undefined;
      const title = params.get('title') ?? undefined;
      if (Number.isFinite(contentId) && contentId > 0) {
        return (
          <Suspense fallback={<BootScreen />}>
            <StandalonePlayerView
              contentId={contentId}
              channelId={Number.isFinite(channelId as number) ? channelId : undefined}
              title={title}
            />
          </Suspense>
        );
      }
    }
  }

  if (route.name === 'boot') {
    return <BootScreen label={t('app.restoring')} />;
  }

  if (route.name === 'offline') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <WifiOff className="w-10 h-10 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
          <h1 className="font-heading font-bold text-lg tracking-wider mb-1">{t('app.offlineTitle')}</h1>
          <p className="text-sm text-muted-foreground mb-5">{t('app.offlineBody')}</p>
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => { restore().catch(() => setRoute({ name: 'login' })); }}
              className="px-4 py-2 rounded bg-primary text-primary-foreground font-heading font-bold text-sm hover:opacity-90"
            >
              {t('app.retry')}
            </button>
            <button
              type="button"
              onClick={() => setRoute({ name: 'login' })}
              className="px-4 py-2 rounded border border-border text-sm font-heading hover:bg-accent/40"
            >
              {t('app.goToLogin')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (route.name === 'login') {
    return (
      <Suspense fallback={<BootScreen />}>
        <LoginView
          onLoggedIn={async () => {
            setSignedIn((await session.get()).signedIn);
            setRoute({ name: 'dashboard' });
            await loadCatalog();
          }}
          error={error}
          setError={setError}
          setBusy={setBusy}
        />
      </Suspense>
    );
  }

  if (route.name === 'live') {
    return (
      <div className="app-shell">
        <Header
          selectedYear={selectedYear}
          onSelectYear={handleSelectYear}
          onSettingsClick={() => setShowSettings(true)}
          brandLabel={t('app.brand')}
          subtitle={t('app.subtitle')}
          availableYears={vodSeasons.length > 0 ? vodSeasons.map((s) => s.year) : undefined}
          hasLive={true}
        />
        <SettingsPanel
          isOpen={showSettings}
          onClose={() => setShowSettings(false)}
          theme={theme}
          onThemeChange={setTheme}
          isSignedIn={signedIn}
          onLogout={logout}
        />
        <div className="app-content">
        <Suspense fallback={<BootScreen />}>
        <LiveEventView
          item={route.item}
          error={error}
          onBack={() => setRoute({ name: 'dashboard' })}
          onOpenExternal={async (item) => {
            try {
              await window.f1?.openInF1TVWeb?.(item.contentId, item.title, item.channelId);
            } catch (e) {
              setError(e instanceof Error ? e.message : t('error.openPlayer'));
            }
          }}
          onEmbedError={setError}
        />
        </Suspense>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {updateInfo && (
        <div className="flex items-center justify-center gap-3 px-4 py-2 bg-primary/15 border-b border-primary/30 text-sm font-heading text-foreground">
          <span>{t('app.updateAvailable').replace('{version}', updateInfo.version)}</span>
          <button
            type="button"
            className="underline font-bold hover:opacity-80"
            onClick={() => window.f1?.openExternal?.(updateInfo.url)}
          >
            {t('app.updateDownload')}
          </button>
          <button
            type="button"
            aria-label={t('app.updateDismiss')}
            className="ml-1 text-muted-foreground hover:text-foreground"
            onClick={dismissUpdate}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      <Header
        selectedYear={selectedYear}
        onSelectYear={handleSelectYear}
        onSettingsClick={() => setShowSettings(true)}
        brandLabel={t('app.brand')}
        subtitle={t('app.subtitle')}
        availableYears={vodSeasons.length > 0 ? vodSeasons.map((s) => s.year) : undefined}
        hasLive={catalog.some((it) => it.kind === 'live')}
      />
      <SettingsPanel
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        theme={theme}
        onThemeChange={setTheme}
        isSignedIn={signedIn}
        onLogout={logout}
      />
      <div className="app-content">
      <Suspense fallback={<BootScreen />}>
      <DashboardView
        items={catalog}
        vodSeasons={vodSeasons}
        busy={busy}
        error={error}
        onRefresh={loadCatalog}
        selectedYear={selectedYear}
        onSelectYear={handleSelectYear}
        onEmbedError={setError}
        onOpen={async (item) => {
          if (item.kind === 'live') {
            setRoute({ name: 'live', item });
            return;
          }
          try {
            await window.f1?.openInF1TVWeb?.(item.contentId, item.title, item.channelId);
          } catch (e) {
            setError(e instanceof Error ? e.message : t('error.openPlayer'));
          }
        }}
      />
      </Suspense>
      </div>
    </div>
  );
}
