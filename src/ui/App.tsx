import React, { useEffect, useRef, useState } from 'react';
import { LoginView } from './views/LoginView';
import { DashboardView } from './views/DashboardView';
import { PlayerView } from './views/PlayerView';
import type { CatalogItem } from '../domain/catalog';
import { getCatalog } from '../services/catalog';
import { getVodSeasons } from '../services/vod';
import { session } from '../services/session';

type Route =
  | { name: 'login' }
  | { name: 'dashboard' }
  | { name: 'player'; item: CatalogItem };

export function App() {
  const [route, setRoute] = useState<Route>({ name: 'login' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [vodSeasons, setVodSeasons] = useState<Array<{ year: number; pageId: number }>>([]);
  const [token, setToken] = useState<string | undefined>(undefined);
  const bootOnceRef = useRef(false);

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
          // carica il catalogo in background dopo il ripristino
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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore caricamento catalogo.');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await session.clear();
    setToken(undefined);
    setCatalog([]);
    setVodSeasons([]);
    setRoute({ name: 'login' });
  }

  const content =
    route.name === 'login' ? (
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
    ) : route.name === 'dashboard' ? (
      <DashboardView
        items={catalog}
        vodSeasons={vodSeasons}
        busy={busy}
        error={error}
        onRefresh={loadCatalog}
        onOpen={(item) => {
          window.f1?.openInF1TVWeb?.(item.contentId, item.title, item.channelId);
        }}
      />
    ) : (
      <PlayerView
        item={route.item}
        accessToken={token}
        onBack={() => setRoute({ name: 'dashboard' })}
      />
    );

  return (
    <div className="shell">
      <div className="app">
        <div className="topbar">
          <div className="brand">
            <span>F1 OpenViewer</span>
            <span className="pill">F1 TV</span>
          </div>
          <div className="row">
            {route.name !== 'login' && (
              <>
                <span className="pill">Sessione: {token ? 'attiva' : '—'}</span>
                <button className="btn btnDanger" onClick={logout} type="button">
                  Esci
                </button>
              </>
            )}
          </div>
        </div>
        <div className="panel">
          <div className="panelInner">{content}</div>
        </div>
      </div>
    </div>
  );
}
