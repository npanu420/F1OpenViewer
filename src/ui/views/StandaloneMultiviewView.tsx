import React, { useCallback, useEffect, useState } from 'react';
import type { CatalogItem } from '../../domain/catalog';
import type { VodSession, VodOnboard } from '../../domain/vod';
import { resolvePlayback, type PlaybackInfo } from '../../services/entitlement';
import { session } from '../../services/session';
import { useLocale } from '../../i18n/LocaleContext';
import {
  MultiViewer,
  loadStandaloneMultiviewState,
} from '../components/MultiViewer';
import type { StreamOption } from '../components/ResizableStreamGrid';

function toCatalogItem(session: VodSession, seasonYear: number): CatalogItem {
  return {
    id: `vod-${session.contentId}-${session.channelId ?? 0}`,
    title: session.title,
    kind: 'replay',
    contentId: session.contentId,
    channelId: session.channelId,
    season: String(seasonYear),
  };
}

function toCatalogItemOnboard(ob: VodOnboard): CatalogItem {
  return {
    id: `onboard-${ob.contentId}-${ob.channelId}`,
    title: ob.title || ob.driverName || `Onboard ${ob.racingNumber ?? ''}`,
    kind: 'replay',
    contentId: ob.contentId,
    channelId: ob.channelId,
  };
}

export function StandaloneMultiviewView() {
  const { t } = useLocale();
  const [state, setState] = useState(loadStandaloneMultiviewState());
  const [accessToken, setAccessToken] = useState<string | undefined>(undefined);
  const [embeddedPlayback, setEmbeddedPlayback] = useState<Record<string, PlaybackInfo>>({});
  const [loadingItemIds, setLoadingItemIds] = useState<Record<string, boolean>>({});
  const [embedError, setEmbedError] = useState<string | null>(null);

  useEffect(() => {
    session.get().then((s) => setAccessToken(s.accessToken));
  }, []);

  const onPlayEmbedded = useCallback(async (item: CatalogItem) => {
    setLoadingItemIds((prev) => ({ ...prev, [item.id]: true }));
    setEmbedError(null);
    try {
      const info = await resolvePlayback(item);
      setEmbeddedPlayback((prev) => ({ ...prev, [item.id]: info }));
    } catch (e) {
      setEmbedError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingItemIds((prev) => ({ ...prev, [item.id]: false }));
    }
  }, []);

  const onPlayAllEmbedded = useCallback(async (items: CatalogItem[]) => {
    const itemsToPlay = items.slice(0, 6);
    setLoadingItemIds((prev) => {
      const next = { ...prev };
      itemsToPlay.forEach((it) => { next[it.id] = true; });
      return next;
    });
    setEmbedError(null);
    const results = await Promise.allSettled(
      itemsToPlay.map((item) => resolvePlayback(item))
    );
    setEmbeddedPlayback((prev) => {
      const next = { ...prev };
      results.forEach((result, i) => {
        if (result.status === 'fulfilled' && itemsToPlay[i])
          next[itemsToPlay[i].id] = result.value;
      });
      return next;
    });
    setLoadingItemIds((prev) => {
      const next = { ...prev };
      itemsToPlay.forEach((it) => { next[it.id] = false; });
      return next;
    });
  }, []);

  const handleExit = useCallback(() => {
    if (typeof window !== 'undefined' && (window as unknown as { f1?: { closeMultiviewWindow?: () => void } }).f1?.closeMultiviewWindow) {
      (window as unknown as { f1: { closeMultiviewWindow: () => void } }).f1.closeMultiviewWindow();
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleExit]);

  if (!state) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-8">
        <p className="text-muted-foreground font-heading text-center max-w-md">
          {t('dashboard.standaloneMultiviewHint')}
        </p>
      </div>
    );
  }

  const { layout, slotToItemId, session: savedSession, streams, seasonYear } = state;
  const mainItem = toCatalogItem(savedSession, seasonYear);
  const streamOptions: StreamOption[] = [
    { item: mainItem, label: savedSession.title || t('ui.worldFeed'), type: 'main' },
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

  return (
    <div className="fixed inset-0 z-40 bg-background flex flex-col min-h-0 overflow-hidden">
      {embedError && (
        <div className="shrink-0 px-4 py-2 bg-destructive/20 text-destructive text-sm font-heading" role="alert">
          {embedError}
        </div>
      )}
      <div className="flex-1 min-h-0 flex flex-col pt-2 pb-4 px-4 overflow-y-auto overflow-x-hidden scrollbar-hide">
        <MultiViewer
          session={savedSession}
          streams={streams}
          seasonYear={seasonYear}
          onOpen={() => {}}
          toCatalogItem={toCatalogItem}
          toCatalogItemOnboard={toCatalogItemOnboard}
          embeddedPlayback={embeddedPlayback}
          loadingItemIds={loadingItemIds}
          onPlayEmbedded={onPlayEmbedded}
          onPlayAllEmbedded={onPlayAllEmbedded}
          accessToken={accessToken}
          onEmbedError={setEmbedError}
          isFullscreen
          onExitFullscreen={handleExit}
          initialLayout={layout}
          initialSlotToItemId={slotToItemId}
        />
      </div>
    </div>
  );
}
