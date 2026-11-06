import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import type { CatalogItem } from '../../domain/catalog';
import type { VodSession, VodOnboard } from '../../domain/vod';
import { getContentVideoStreams, type SessionStreams } from '../../services/vod';
import { useEmbeddedPlayback } from '../hooks/useEmbeddedPlayback';
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
  error?: string | null;
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
  error,
  onBack,
  onOpenExternal,
  onEmbedError,
}: LiveEventViewProps) {
  const { t } = useLocale();
  const [liveItem, setLiveItem] = useState(item);
  const session = liveItemToSession(liveItem);
  const [streams, setStreams] = useState<SessionStreams | null>(null);
  const [loadingStreams, setLoadingStreams] = useState(true);
  const { embeddedPlayback, loadingItemIds, onPlayEmbedded, onPlayAllEmbedded, removePlayback } =
    useEmbeddedPlayback(onEmbedError);

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
      .catch((e) => onEmbedError?.(e instanceof Error && e.message ? e.message : t('error.streamsLoad')))
      .finally(() => setLoadingStreams(false));
  }, [item.contentId]);

  const toCatalogItem = useCallback(
    (_s: VodSession, _year: number) => liveItem,
    [liveItem]
  );

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
      <main className="workspace">
        {error && <p role="alert" className="error mb-3">{error}</p>}
        <div className="session-heading">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0 group"
            type="button"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
            <span className="font-heading tracking-wider">
              {t('player.back')}
            </span>
          </button>

          <div className="flex items-center gap-3">
            <span className="relative flex h-4 w-4">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-4 w-4 bg-red-500" />
            </span>
            <span className="font-heading font-bold text-red-400 tracking-widest text-sm">
              {t('header.live')}
            </span>
            <h2 className="font-heading text-2xl font-bold tracking-wider">
              {item.title}
            </h2>
          </div>
        </div>

        

        {loadingStreams ? (
          <div className="glass-panel rounded-lg p-8 text-center">
            <p className="text-muted-foreground font-heading tracking-wider">
              {t('dashboard.loadingStreams')}
            </p>
          </div>
        ) : (
          <motion.div
            initial={false}
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
              onEmbedError={onEmbedError}
              liveTimingQuery={{
                contentId: item.contentId,
                live: true,
                year: new Date().getFullYear(),
                sessionKey: item.sessionKey,
                sessionName: item.title,
                title: item.title,
              }}
              onPortStreamsToWindow={removePlayback}
            />
          </motion.div>
        )}
      </main>
    </div>
  );
}
