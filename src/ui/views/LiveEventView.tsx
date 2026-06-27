import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import type { CatalogItem } from '../../domain/catalog';
import type { VodSession, VodOnboard } from '../../domain/vod';
import { getContentVideoStreams, type SessionStreams } from '../../services/vod';
import { resolvePlayback, type PlaybackInfo } from '../../services/entitlement';
import { useLocale } from '../../i18n/LocaleContext';
import { MultiViewer } from '../components/MultiViewer';

function toCatalogItemOnboard(ob: VodOnboard): CatalogItem {
  return {
    id: `onboard-${ob.contentId}-${ob.channelId}`,
    title: ob.title || ob.driverName || `Onboard ${ob.racingNumber ?? ''}`,
    kind: 'replay',
    contentId: ob.contentId,
    channelId: ob.channelId,
  };
}

interface LiveEventViewProps {
  item: CatalogItem;
  accessToken?: string;
  onBack: () => void;
  onOpenExternal?: (item: CatalogItem) => void;
  onEmbedError?: (msg: string) => void;
}

/** Builds a minimal VodSession from a live catalog item for MultiViewer. */
function liveItemToSession(item: CatalogItem): VodSession {
  return {
    contentId: item.contentId,
    title: item.title,
    type: 'other',
    channelId: item.channelId,
  };
}

export function LiveEventView({
  item,
  accessToken,
  onBack,
  onOpenExternal,
  onEmbedError,
}: LiveEventViewProps) {
  const { t } = useLocale();
  const [liveItem, setLiveItem] = useState(item);
  const session = liveItemToSession(liveItem);
  const [streams, setStreams] = useState<SessionStreams | null>(null);
  const [loadingStreams, setLoadingStreams] = useState(true);
  const [embeddedPlayback, setEmbeddedPlayback] = useState<Record<string, PlaybackInfo>>({});
  const [loadingItemIds, setLoadingItemIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setLiveItem(item);
  }, [item]);

  useEffect(() => {
    setLoadingStreams(true);
    getContentVideoStreams(item.contentId)
      .then((s) => {
        setStreams(s);
        if (s.mainChannel?.channelId) {
          setLiveItem((prev) =>
            prev.contentId === item.contentId
              ? { ...prev, channelId: s.mainChannel!.channelId }
              : prev
          );
        }
      })
      .finally(() => setLoadingStreams(false));
  }, [item.contentId]);

  const toCatalogItem = useCallback(
    (_s: VodSession, _year: number) => liveItem,
    [liveItem]
  );

  const onPlayEmbedded = useCallback(async (catalogItem: CatalogItem) => {
    setLoadingItemIds((prev) => ({ ...prev, [catalogItem.id]: true }));
    try {
      const info = await resolvePlayback(catalogItem);
      setEmbeddedPlayback((prev) => ({ ...prev, [catalogItem.id]: info }));
    } finally {
      setLoadingItemIds((prev) => ({ ...prev, [catalogItem.id]: false }));
    }
  }, []);

  const onPlayAllEmbedded = useCallback(async (itemsToPlay: CatalogItem[]) => {
    if (itemsToPlay.length === 0) return;
    const loading = itemsToPlay.reduce<Record<string, boolean>>((acc, item) => ({ ...acc, [item.id]: true }), {});
    setLoadingItemIds((prev) => ({ ...prev, ...loading }));
    const results = await Promise.allSettled(
      itemsToPlay.map((item) => resolvePlayback(item))
    );
    const nextPlayback: Record<string, PlaybackInfo> = {};
    results.forEach((result, index) => {
      const item = itemsToPlay[index];
      if (result.status === 'fulfilled') nextPlayback[item.id] = result.value;
    });
    setEmbeddedPlayback((prev) => ({ ...prev, ...nextPlayback }));
    const done = itemsToPlay.reduce<Record<string, boolean>>((acc, item) => ({ ...acc, [item.id]: false }), {});
    setLoadingItemIds((prev) => ({ ...prev, ...done }));
  }, []);

  const onOpen = useCallback(
    (openItem: CatalogItem) => {
      if (onOpenExternal) {
        onOpenExternal(openItem);
      }
    },
    [onOpenExternal]
  );

  return (
    <div className="min-h-screen bg-background">
      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6">
        <div className="mb-6">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3 group"
            type="button"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
            <span className="font-heading tracking-wider">
              {t('dashboard.pastChampionships')} — {t('player.back')}
            </span>
          </button>

          <div className="flex items-center gap-3">
            <span className="relative flex h-4 w-4">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-4 w-4 bg-primary" />
            </span>
            <span className="font-heading font-bold text-primary tracking-widest text-sm">
              {t('header.live')}
            </span>
            <h2 className="font-heading text-2xl font-bold tracking-wider">
              {item.title}
            </h2>
          </div>
        </div>

        <div className="red-stripe mb-6" />

        {loadingStreams ? (
          <div className="glass-panel rounded-lg p-8 text-center">
            <p className="text-muted-foreground font-heading tracking-wider">
              {t('dashboard.loadingStreams')}
            </p>
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            <MultiViewer
              session={session}
              streams={streams}
              seasonYear={new Date().getFullYear()}
              onOpen={onOpen}
              toCatalogItem={toCatalogItem}
              toCatalogItemOnboard={toCatalogItemOnboard}
              embeddedPlayback={embeddedPlayback}
              loadingItemIds={loadingItemIds}
              onPlayEmbedded={onPlayEmbedded}
              onPlayAllEmbedded={onPlayAllEmbedded}
              accessToken={accessToken}
              onEmbedError={onEmbedError}
              onPortStreamsToWindow={(ids) => {
                if (!ids.length) return;
                setEmbeddedPlayback((prev) => {
                  const next = { ...prev };
                  for (const id of ids) delete next[id];
                  return next;
                });
              }}
            />
          </motion.div>
        )}
      </main>
    </div>
  );
}
