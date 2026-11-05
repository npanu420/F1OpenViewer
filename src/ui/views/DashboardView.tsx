import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import type { CatalogItem } from '../../domain/catalog';
import type { VodEvent, VodSession, VodOnboard } from '../../domain/vod';
import {
  getVodEvents,
  getVodSessions,
  getContentVideoStreams,
  type SessionStreams,
} from '../../services/vod';
import { useEmbeddedPlayback } from '../hooks/useEmbeddedPlayback';
import { useLocale } from '../../i18n/LocaleContext';
import { getFlag, getEventCountryCode } from '../../lib/flags';
import { LiveSection } from '../components/LiveSection';
import { DashboardHero } from '../components/DashboardHero';
import { RaceCard } from '../components/RaceCard';
import { SessionTabs, sessionToTabItem } from '../components/SessionTabs';
import { pickDefaultSessionId } from '../../domain/sessionGrouping';
import { MultiViewer } from '../components/MultiViewer';

type Props = {
  items: CatalogItem[];
  vodSeasons: Array<{ year: number; pageId: number }>;
  busy: boolean;
  error: string | null;
  onRefresh: () => Promise<void>;
  onOpen: (item: CatalogItem) => void;
  selectedYear: number;
  onSelectYear: (year: number) => void;
  onEmbedError?: (msg: string) => void;
};

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

export function DashboardView({
  items,
  vodSeasons,
  busy,
  error,
  onRefresh,
  onOpen,
  selectedYear,
  onSelectYear,
  onEmbedError,
}: Props) {
  const { t } = useLocale();
  const [selectedEvent, setSelectedEvent] = useState<VodEvent | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string>('');

  const {
    embeddedPlayback,
    loadingItemIds,
    onPlayEmbedded,
    onPlayAllEmbedded,
    removePlayback,
    resetPlayback,
  } = useEmbeddedPlayback(onEmbedError);

  const [eventsBySeasonPageId, setEventsBySeasonPageId] = useState<
    Record<number, VodEvent[]>
  >({});
  const [loadingEvents, setLoadingEvents] = useState<Record<number, boolean>>(
    {}
  );

  const [sessionsByEvent, setSessionsByEvent] = useState<
    Record<string, VodSession[]>
  >({});
  const [loadingSessions, setLoadingSessions] = useState<
    Record<string, boolean>
  >({});

  const [streamsByContentId, setStreamsByContentId] = useState<
    Record<number, SessionStreams>
  >({});
  const [loadingStreams, setLoadingStreams] = useState<
    Record<number, boolean>
  >({});

  const currentSeasonPageId = useMemo(
    () => vodSeasons.find((s) => s.year === selectedYear)?.pageId,
    [vodSeasons, selectedYear]
  );
  const currentEvents = selectedYear !== -1 && currentSeasonPageId != null
    ? eventsBySeasonPageId[currentSeasonPageId]
    : undefined;
  const loadingEvs = currentSeasonPageId != null
    ? loadingEvents[currentSeasonPageId]
    : false;

  useEffect(() => {
    if (items.length === 0 && vodSeasons.length === 0 && !busy && !error) {
      onRefresh().catch(() => {});
    }
  }, []);

  useEffect(() => {
    setSelectedEvent(null);
    setActiveSessionId('');
  }, [selectedYear]);

  useEffect(() => {
    resetPlayback();
  }, [activeSessionId, resetPlayback]);

  const eventKey =
    selectedEvent && selectedYear !== -1
      ? `${selectedYear}-${selectedEvent.meetingKey}`
      : '';

  useEffect(() => {
    if (!eventKey) return;
    setSessionsByEvent((prev) => {
      const keys = Object.keys(prev);
      if (keys.length === 0 || (keys.length === 1 && keys[0] === eventKey)) return prev;
      const current = prev[eventKey];
      return current !== undefined ? { [eventKey]: current } : {};
    });
  }, [eventKey]);

  // In-flight guards: the effects re-run when their cache objects change (e.g. the trim below),
  // which sent the same request twice.
  const eventsInFlight = useRef(new Set<number>());
  const sessionsInFlight = useRef(new Set<string>());

  useEffect(() => {
    if (selectedYear === -1 || currentSeasonPageId == null) return;
    if (eventsBySeasonPageId[currentSeasonPageId] !== undefined) return;
    if (eventsInFlight.current.has(currentSeasonPageId)) return;
    eventsInFlight.current.add(currentSeasonPageId);
    setLoadingEvents((prev) => ({ ...prev, [currentSeasonPageId]: true }));
    getVodEvents(currentSeasonPageId)
      .then((evs) => {
        setEventsBySeasonPageId((prev) => ({
          ...prev,
          [currentSeasonPageId]: evs,
        }));
      })
      .catch((e) => onEmbedError?.(e instanceof Error && e.message ? e.message : t('error.eventsLoad')))
      .finally(() => {
        eventsInFlight.current.delete(currentSeasonPageId);
        setLoadingEvents((prev) => ({ ...prev, [currentSeasonPageId]: false }));
      });
  }, [selectedYear, currentSeasonPageId, eventsBySeasonPageId]);

  const currentSessions = eventKey ? sessionsByEvent[eventKey] : undefined;
  const loadingSess = eventKey ? loadingSessions[eventKey] : false;

  useEffect(() => {
    if (!eventKey || !selectedEvent?.pageId) return;
    if (sessionsByEvent[eventKey] !== undefined) return;
    if (sessionsInFlight.current.has(eventKey)) return;
    sessionsInFlight.current.add(eventKey);
    setLoadingSessions((prev) => ({ ...prev, [eventKey]: true }));
    getVodSessions(selectedEvent.pageId)
      .then((sessions) => {
        // Drop sessions whose title only names OTHER years (a title mentioning several years, one
        // of them the selected one, is kept; titles without a year are kept).
        const filtered = sessions.filter((s) => {
          if (selectedYear === -1) return true;
          const years = s.title.match(/\b(19|20)\d{2}\b/g);
          return !years || years.includes(String(selectedYear));
        });
        setSessionsByEvent((prev) => ({ ...prev, [eventKey]: filtered }));
      })
      .catch((e) => onEmbedError?.(e instanceof Error && e.message ? e.message : t('error.sessionsLoad')))
      .finally(() => {
        sessionsInFlight.current.delete(eventKey);
        setLoadingSessions((prev) => ({ ...prev, [eventKey]: false }));
      });
  }, [eventKey, selectedEvent?.pageId, sessionsByEvent, selectedYear]);

  const activeSession = useMemo(() => {
    if (!currentSessions?.length) return null;
    if (activeSessionId) {
      const found = currentSessions.find(
        (s) => sessionToTabItem(s).id === activeSessionId
      );
      if (found) return found;
    }
    return currentSessions[0];
  }, [currentSessions, activeSessionId]);

  const sessionForViewer = useMemo(() => {
    if (!activeSession) return null;
    const streams = streamsByContentId[activeSession.contentId];
    const mainCh = streams?.mainChannel?.channelId;
    if (mainCh) return { ...activeSession, channelId: mainCh };
    return activeSession;
  }, [activeSession, streamsByContentId]);

  useEffect(() => {
    if (!activeSession) return;
    if (streamsByContentId[activeSession.contentId] !== undefined) return;
    setLoadingStreams((prev) => ({ ...prev, [activeSession.contentId]: true }));
    getContentVideoStreams(activeSession.contentId)
      .then((streams) => {
        setStreamsByContentId((prev) => ({
          ...prev,
          [activeSession.contentId]: streams,
        }));
      })
      .catch((e) => onEmbedError?.(e instanceof Error && e.message ? e.message : t('error.streamsLoad')))
      .finally(() => {
        setLoadingStreams((prev) => ({
          ...prev,
          [activeSession.contentId]: false,
        }));
      });
  }, [activeSession?.contentId, streamsByContentId]);

  useEffect(() => {
    if (currentSessions?.length && !activeSessionId) {
      const defaultId = pickDefaultSessionId(currentSessions.map(sessionToTabItem));
      if (defaultId) setActiveSessionId(defaultId);
    }
  }, [currentSessions, activeSessionId]);

  /** Refresh reloads the catalog and drops the per-season/event/stream caches so failed loads retry. */
  const handleRefresh = useCallback(() => {
    setEventsBySeasonPageId({});
    setSessionsByEvent({});
    setStreamsByContentId({});
    return onRefresh();
  }, [onRefresh]);

  const handleSelectEvent = (ev: VodEvent) => {
    setSelectedEvent(ev);
    setActiveSessionId('');
  };

  const handleBack = () => {
    setSelectedEvent(null);
    setActiveSessionId('');
  };

  const seasonLabel =
    selectedYear === -1
      ? t('dashboard.pastChampionships') + ' — ' + t('dashboard.archiveLabel')
      : `${t('dashboard.season')} ${selectedYear}`;

  const sessionTabItems = useMemo(() => {
    const items = (currentSessions ?? []).map(sessionToTabItem);
    const seen = new Set<string>();
    return items.filter((it) => {
      if (seen.has(it.id)) return false;
      seen.add(it.id);
      return true;
    });
  }, [currentSessions]);

  const itemsForSelectedYear = useMemo(() => {
    if (selectedYear === -1) return items;
    return items.filter((item) => {
      if (item.kind === 'live') return true;
      return item.season === String(selectedYear);
    });
  }, [items, selectedYear]);

  return (
    <div className="min-h-screen bg-background">
      <main className="max-w-[1600px] 2xl:max-w-[94vw] mx-auto px-4 sm:px-6 py-6">
        {error && (
          <div className="mb-4 error" role="alert">
            {error}
          </div>
        )}

        <AnimatePresence mode="wait">
          {!selectedEvent ? (
            <motion.div
              key={`season-${selectedYear}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ duration: 0.3 }}
            >
              <DashboardHero
                liveItem={itemsForSelectedYear.find((it) => it.kind === 'live')}
                latestEvent={
                  selectedYear !== -1
                    ? [...(currentEvents ?? [])].reverse().find((ev) => !ev.isTest) ?? currentEvents?.[currentEvents.length - 1]
                    : undefined
                }
                loading={loadingEvs ?? false}
                onWatchLive={onOpen}
                onWatchLatest={handleSelectEvent}
              />

              <LiveSection
                items={itemsForSelectedYear}
                onOpen={onOpen}
                loading={busy}
              />

              <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="font-heading text-2xl font-bold tracking-wider">
                    {seasonLabel}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    {selectedYear === -1
                      ? t('ui.previousSeasons')
                      : currentEvents
                        ? t('dashboard.gpCount').replace('{count}', String(currentEvents.length))
                        : loadingEvs
                          ? t('dashboard.loadingGps')
                          : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => { handleRefresh().catch(() => {}); }}
                  disabled={busy}
                  className="py-2 px-4 rounded-lg font-heading text-sm font-bold tracking-wider border border-border bg-accent/30 hover:bg-accent/50 disabled:opacity-50"
                >
                  {t('dashboard.refresh')}
                </button>
              </div>

              <div className="red-stripe mb-6" />

              {selectedYear === -1 ? (
                <div className="glass-panel rounded-lg p-8 text-center">
                  <p className="text-muted-foreground font-heading tracking-wider">
                    {t('dashboard.archiveSoon')}
                  </p>
                </div>
              ) : loadingEvs ? (
                <div className="glass-panel rounded-lg p-8 text-center">
                  <p className="text-muted-foreground font-heading tracking-wider">
                    {t('dashboard.loadingGps')}
                  </p>
                </div>
              ) : !currentEvents?.length ? (
                <div className="glass-panel rounded-lg p-8 text-center">
                  <p className="text-muted-foreground font-heading tracking-wider">
                    {t('dashboard.noGpsFound')}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {currentEvents.map((ev, i) => (
                    <RaceCard
                      key={`${selectedYear}-${ev.meetingKey}`}
                      event={ev}
                      onClick={() => handleSelectEvent(ev)}
                      index={i}
                    />
                  ))}
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="race-view"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <div className="mb-6">
                <button
                  onClick={handleBack}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3 group"
                  type="button"
                >
                  <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
                  <span className="font-heading tracking-wider">
                    {t('dashboard.pastChampionships')} — {t('dashboard.backToCalendar')}
                  </span>
                </button>

                <div className="flex items-center gap-3">
                  <span className="text-2xl">
                    {getFlag(getEventCountryCode(selectedEvent))}
                  </span>
                  <span className="text-primary font-heading font-bold text-lg tracking-widest">
                    R{String(selectedEvent.meetingNumber ?? 0).padStart(2, '0')}
                  </span>
                  <h2 className="font-heading text-2xl font-bold tracking-wider">
                    {selectedEvent.meetingName}
                  </h2>
                </div>
                {selectedEvent.country && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {selectedEvent.country}
                  </p>
                )}
              </div>

              <div className="red-stripe mb-6" />

              {loadingSess ? (
                <p className="text-sm text-muted-foreground mb-4">
                  {t('dashboard.loadingSessions')}
                </p>
              ) : sessionTabItems.length > 0 ? (
                <>
                  <div className="mb-6 min-w-0">
                    <SessionTabs
                      sessions={sessionTabItems}
                      activeSessionId={activeSessionId}
                      onSelectSession={setActiveSessionId}
                    />
                  </div>

                  {sessionForViewer && (
                    <MultiViewer
                      session={sessionForViewer}
                      streams={
                        loadingStreams[sessionForViewer.contentId]
                          ? null
                          : streamsByContentId[sessionForViewer.contentId] ?? null
                      }
                      seasonYear={selectedYear}
                      onOpen={onOpen}
                      toCatalogItem={toCatalogItem}
                      toCatalogItemOnboard={toCatalogItemOnboard}
                      embeddedPlayback={embeddedPlayback}
                      loadingItemIds={loadingItemIds}
                      onPlayEmbedded={onPlayEmbedded}
                      onPlayAllEmbedded={onPlayAllEmbedded}
                      onEmbedError={onEmbedError}
                      liveTimingQuery={{
                        contentId: sessionForViewer.contentId,
                        year: selectedYear,
                        meetingName: selectedEvent.meetingName,
                        meetingNumber: selectedEvent.meetingNumber,
                        sessionName: sessionForViewer.title,
                        sessionType: sessionForViewer.type,
                        title: `${selectedEvent.meetingName} — ${sessionForViewer.title}`,
                      }}
                      // Drop transferred streams here; they keep playing in the popout only.
                      onPortStreamsToWindow={removePlayback}
                    />
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t('dashboard.noSessionsFound')}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
