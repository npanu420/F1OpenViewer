import React, { useEffect, useRef, useState } from 'react';
import { LoginView } from './views/LoginView';
import { DashboardView } from './views/DashboardView';
import { StandaloneMultiviewView } from './views/StandaloneMultiviewView';
import { LiveTimingView } from './views/LiveTimingView';
import { PlayerView } from './views/PlayerView';
import { LiveEventView } from './views/LiveEventView';
import type { CatalogItem } from '../domain/catalog';
import { getCatalog } from '../services/catalog';
import { getVodSeasons } from '../services/vod';
import { session } from '../services/session';
import { useLocale } from '../i18n/LocaleContext';
import { Header } from './components/Header';
import { SettingsPanel, type ThemeMode } from './components/SettingsPanel';

type Route =
  | { name: 'login' }
  | { name: 'dashboard' }
  | { name: 'player'; item: CatalogItem }
  | { name: 'live'; item: CatalogItem };

export function App() {
  const { t } = useLocale();
  const [route, setRoute] = useState<Route>({ name: 'login' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [vodSeasons, setVodSeasons] = useState<Array<{ year: number; pageId: number }>>([]);
  const [token, setToken] = useState<string | undefined>(undefined);
  const [selectedYear, setSelectedYear] = useState<number>(2026);
  const [showSettings, setShowSettings] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(() => {
    return (typeof localStorage !== 'undefined' && (localStorage.getItem('f1-theme') as ThemeMode)) || 'dark';
  });
  const bootOnceRef = useRef(false);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') {
      root.classList.add('light');
    } else {
      root.classList.remove('light');
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('f1-theme', theme);
    }
  }, [theme]);

  useEffect(() => {
    if (bootOnceRef.current) return;
    bootOnceRef.current = true;
    (async () => {
      if (window.f1?.restoreSession) {
        const result = await window.f1.restoreSession().catch(() => ({ accessToken: null, restored: false }));
        if (result.restored && result.accessToken) {
          await session.set({ accessToken: result.accessToken });
          setToken(result.accessToken);
          setRoute({ name: 'dashboard' });
          loadCatalog();
          return;
        }
      } else {
        const s = await session.get();
        if (s.accessToken) {
          setToken(s.accessToken);
          setRoute({ name: 'dashboard' });
          return;
        }
      }
      setRoute({ name: 'login' });
    })().catch(() => setRoute({ name: 'login' }));
  }, []);

  async function loadCatalog() {
    setBusy(true);
    setError(null);
    try {
      const [items, seasons] = await Promise.all([
        getCatalog(),
        getVodSeasons(),
      ]);
      setCatalog(items);
      setVodSeasons(seasons);
      if (seasons.length > 0 && selectedYear === 2026) {
        setSelectedYear(seasons[0].year);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error.catalogLoad'));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await session.clear();
    setToken(undefined);
    setCatalog([]);
    setVodSeasons([]);
    setSelectedYear(2026);
    setRoute({ name: 'login' });
  }

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
      return <StandaloneMultiviewView multiviewInstanceId={multiviewInstanceId} />;
    }
    if (raw === 'standalone-livetiming' || raw.startsWith('standalone-livetiming?')) {
      return <LiveTimingView />;
    }
  }

  if (route.name === 'login') {
    return (
      <>
        <LoginView
          onLoggedIn={async () => {
            const s = await session.get();
            setToken(s.accessToken);
            setRoute({ name: 'dashboard' });
            await loadCatalog();
          }}
          setError={setError}
          setBusy={setBusy}
        />
      </>
    );
  }

  if (route.name === 'player') {
    return (
      <div className="min-h-screen bg-background">
        <PlayerView
          item={route.item}
          accessToken={token}
          onBack={() => setRoute({ name: 'dashboard' })}
        />
      </div>
    );
  }

  if (route.name === 'live') {
    return (
      <div className="min-h-screen bg-background">
        <Header
          selectedYear={selectedYear}
          onSelectYear={setSelectedYear}
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
          isSignedIn={!!token}
          onLogout={logout}
        />
        <LiveEventView
          item={route.item}
          accessToken={token}
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
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header
        selectedYear={selectedYear}
        onSelectYear={setSelectedYear}
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
        isSignedIn={!!token}
        onLogout={logout}
      />
      <DashboardView
        items={catalog}
        vodSeasons={vodSeasons}
        busy={busy}
        error={error}
        onRefresh={loadCatalog}
        selectedYear={selectedYear}
        onSelectYear={setSelectedYear}
        accessToken={token}
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
    </div>
  );
}
