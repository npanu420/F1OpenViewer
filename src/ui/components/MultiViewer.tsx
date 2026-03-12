import React, { useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, RefreshCw } from 'lucide-react';
import { useLocale } from '../../i18n/LocaleContext';
import type { VodSession, VodOnboard } from '../../domain/vod';
import type { SessionStreams } from '../../services/vod';
import type { CatalogItem } from '../../domain/catalog';
import type { PlaybackInfo } from '../../services/entitlement';
import { StreamPanel, type StreamPanelHandle } from './StreamPanel';
import { SyncOverlay } from './SyncOverlay';
import { useSyncEngine } from '../hooks/useSyncEngine';

interface MultiViewerProps {
  session: VodSession;
  streams: SessionStreams | null;
  seasonYear: number;
  onOpen: (item: CatalogItem) => void;
  toCatalogItem: (session: VodSession, year: number) => CatalogItem;
  toCatalogItemOnboard: (ob: VodOnboard) => CatalogItem;
  embeddedPlayback?: Record<string, PlaybackInfo>;
  loadingItemIds?: Record<string, boolean>;
  onPlayEmbedded?: (item: CatalogItem) => void;
  onPlayAllEmbedded?: (items: CatalogItem[]) => void;
  accessToken?: string;
  onEmbedError?: (msg: string) => void;
}

export function MultiViewer({
  session,
  streams,
  seasonYear,
  onOpen,
  toCatalogItem,
  toCatalogItemOnboard,
  embeddedPlayback = {},
  loadingItemIds = {},
  onPlayEmbedded,
  onPlayAllEmbedded,
  accessToken,
  onEmbedError,
}: MultiViewerProps) {
  const { t } = useLocale();

  // Refs for every StreamPanel slot
  const mainRef = useRef<StreamPanelHandle | null>(null);
  const dataRefs = useRef<Map<number, StreamPanelHandle>>(new Map());
  const onboardRefs = useRef<Map<number, StreamPanelHandle>>(new Map());

  const {
    startSync,
    closeOverlay,
    syncStatus,
    syncStreams,
    showSyncOverlay,
  } = useSyncEngine();

  const mainItem = toCatalogItem(session, seasonYear);
  const allItems: CatalogItem[] = [
    mainItem,
    ...(streams?.dataChannel?.map((dc) => toCatalogItemOnboard(dc)) ?? []),
    ...(streams?.onboard?.map((ob) => toCatalogItemOnboard(ob)) ?? []),
  ];
  const hasEmbedSupport = Boolean(onPlayEmbedded && onPlayAllEmbedded);

  // Count how many embedded streams are actually playing
  const playingCount = allItems.filter((it) => embeddedPlayback[it.id]).length;
  const canSync = playingCount >= 2;

  function handleSync() {
    const entries = [];

    if (embeddedPlayback[mainItem.id]) {
      entries.push({
        id: mainItem.id,
        label: session.title || t('ui.worldFeed'),
        getVideo: () => mainRef.current?.getVideoElement() ?? null,
      });
    }

    streams?.dataChannel?.forEach((dc) => {
      const item = toCatalogItemOnboard(dc);
      if (embeddedPlayback[item.id]) {
        entries.push({
          id: item.id,
          label: dc.title,
          getVideo: () => dataRefs.current.get(dc.channelId)?.getVideoElement() ?? null,
        });
      }
    });

    streams?.onboard?.forEach((ob) => {
      const item = toCatalogItemOnboard(ob);
      if (embeddedPlayback[item.id]) {
        entries.push({
          id: item.id,
          label: ob.title || ob.driverName || `Onboard ${ob.racingNumber ?? ''}`,
          getVideo: () => onboardRefs.current.get(ob.channelId)?.getVideoElement() ?? null,
        });
      }
    });

    startSync(entries);
  }

  return (
    <>
      <SyncOverlay
        isOpen={showSyncOverlay}
        status={syncStatus}
        streams={syncStreams}
        onClose={closeOverlay}
      />

      <AnimatePresence mode="wait">
        <motion.div
          key={session.contentId}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="space-y-6"
        >
          {/* Action bar */}
          {hasEmbedSupport && allItems.length > 0 && (
            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={() => onPlayAllEmbedded?.(allItems)}
                className="flex items-center gap-2 py-2.5 px-4 rounded-lg font-heading text-sm font-bold tracking-wider bg-primary text-primary-foreground border border-primary hover:opacity-90 transition-opacity"
              >
                <Play className="w-4 h-4" />
                {t('dashboard.playAllEmbedded')}
              </button>

              {canSync && (
                <button
                  type="button"
                  onClick={handleSync}
                  disabled={syncStatus === 'syncing'}
                  className="flex items-center gap-2 py-2.5 px-4 rounded-lg font-heading text-sm font-bold tracking-wider border border-border bg-accent/30 hover:bg-accent/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <RefreshCw className={`w-4 h-4 ${syncStatus === 'syncing' ? 'animate-spin' : ''}`} />
                  {syncStatus === 'syncing' ? t('sync.inProgress') : t('sync.inProgressDescription')}
                </button>
              )}
            </div>
          )}

          {/* Main Stream */}
          <div>
            <h3 className="font-heading text-sm text-muted-foreground tracking-widest mb-3 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              STREAM PRINCIPALE
            </h3>
            <div className="max-w-4xl">
              <StreamPanel
                ref={mainRef}
                label={session.title || t('ui.worldFeed')}
                type="main"
                catalogItem={mainItem}
                playback={embeddedPlayback[mainItem.id]}
                loading={loadingItemIds[mainItem.id]}
                onPlayEmbedded={onPlayEmbedded}
                onEmbedError={onEmbedError}
                accessToken={accessToken}
                onClick={() => onOpen(mainItem)}
              />
            </div>
          </div>

          {/* Data Channel */}
          {streams && streams.dataChannel.length > 0 && (
            <div>
              <h3 className="font-heading text-sm text-muted-foreground tracking-widest mb-3">
                CANALE DATI
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {streams.dataChannel.map((dc: VodOnboard, i: number) => {
                  const item = toCatalogItemOnboard(dc);
                  return (
                    <StreamPanel
                      key={dc.channelId}
                      ref={(el) => {
                        if (el) dataRefs.current.set(dc.channelId, el);
                        else dataRefs.current.delete(dc.channelId);
                      }}
                      label={dc.title}
                      type="data"
                      index={i}
                      catalogItem={item}
                      playback={embeddedPlayback[item.id]}
                      loading={loadingItemIds[item.id]}
                      onPlayEmbedded={onPlayEmbedded}
                      onEmbedError={onEmbedError}
                      accessToken={accessToken}
                      onClick={() => onOpen(item)}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Onboard */}
          {streams && streams.onboard.length > 0 && (
            <div>
              <h3 className="font-heading text-sm text-muted-foreground tracking-widest mb-3">
                ONBOARD PILOTI — {streams.onboard.length} STREAM
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {streams.onboard.map((ob: VodOnboard, i: number) => {
                  const item = toCatalogItemOnboard(ob);
                  return (
                    <StreamPanel
                      key={ob.channelId}
                      ref={(el) => {
                        if (el) onboardRefs.current.set(ob.channelId, el);
                        else onboardRefs.current.delete(ob.channelId);
                      }}
                      label={ob.title || ob.driverName || `Onboard ${ob.racingNumber ?? ''}`}
                      type="driver"
                      driverNumber={ob.racingNumber}
                      index={i}
                      catalogItem={item}
                      playback={embeddedPlayback[item.id]}
                      loading={loadingItemIds[item.id]}
                      onPlayEmbedded={onPlayEmbedded}
                      onEmbedError={onEmbedError}
                      accessToken={accessToken}
                      onClick={() => onOpen(item)}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {streams && streams.onboard.length === 0 && streams.dataChannel.length === 0 && (
            <p className="text-xs text-muted-foreground font-heading tracking-wider">
              Solo ripresa principale disponibile per questa sessione.
            </p>
          )}
        </motion.div>
      </AnimatePresence>
    </>
  );
}
