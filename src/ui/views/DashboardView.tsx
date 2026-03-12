import React, { useEffect, useMemo, useState } from 'react';
import type { CatalogItem } from '../../domain/catalog';
import type { VodEvent, VodSession, VodOnboard } from '../../domain/vod';
import { getVodEvents, getVodSessions, getContentVideoStreams, type SessionStreams } from '../../services/vod';
import { useLocale } from '../../i18n/LocaleContext';

type Props = {
  items: CatalogItem[];
  vodSeasons: Array<{ year: number; pageId: number }>;
  busy: boolean;
  error: string | null;
  onRefresh: () => Promise<void>;
  onOpen: (item: CatalogItem) => void;
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

export function DashboardView({ items, vodSeasons, busy, error, onRefresh, onOpen }: Props) {
  const { t } = useLocale();
  const sessionLabels: Record<string, string> = useMemo(() => ({
    race: t('dashboard.sessionRace'),
    qualifying: t('dashboard.sessionQualifying'),
    practice: t('dashboard.sessionPractice'),
    sprint: t('dashboard.sessionSprint'),
    onboard: t('dashboard.sessionOnboard'),
    other: t('dashboard.sessionVideo'),
  }), [t]);
  const [expandedYear, setExpandedYear] = useState<number | null>(null);
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);

  // Lazy: events per season (pageId → VodEvent[])
  const [eventsBySeasonPageId, setEventsBySeasonPageId] = useState<Record<number, VodEvent[]>>({});
  const [loadingEvents, setLoadingEvents] = useState<Record<number, boolean>>({});

  // Lazy: sessions per GP (meetingKey → VodSession[])
  const [sessionsByEvent, setSessionsByEvent] = useState<Record<string, VodSession[]>>({});
  const [loadingSessions, setLoadingSessions] = useState<Record<string, boolean>>({});

  // For each clicked session: stream list (main + data + onboard). Key = `${eventKey}-${contentId}`
  const [expandedSessionKey, setExpandedSessionKey] = useState<string | null>(null);
  const [streamsByContentId, setStreamsByContentId] = useState<Record<number, SessionStreams>>({});
  const [loadingStreams, setLoadingStreams] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (items.length === 0 && vodSeasons.length === 0 && !busy && !error) {
      onRefresh().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount to load catalog
  }, []);

  async function loadEvents(seasonPageId: number) {
    if (eventsBySeasonPageId[seasonPageId] !== undefined) return;
    setLoadingEvents((prev) => ({ ...prev, [seasonPageId]: true }));
    const evs = await getVodEvents(seasonPageId);
    setEventsBySeasonPageId((prev) => ({ ...prev, [seasonPageId]: evs }));
    setLoadingEvents((prev) => ({ ...prev, [seasonPageId]: false }));
  }

  async function loadSessions(eventKey: string, gpPageId: number) {
    if (sessionsByEvent[eventKey] !== undefined) return;
    setLoadingSessions((prev) => ({ ...prev, [eventKey]: true }));
    const sessions = await getVodSessions(gpPageId);
    setSessionsByEvent((prev) => ({ ...prev, [eventKey]: sessions }));
    setLoadingSessions((prev) => ({ ...prev, [eventKey]: false }));
  }

  async function loadStreamsForSession(contentId: number) {
    if (streamsByContentId[contentId] !== undefined) return;
    setLoadingStreams((prev) => ({ ...prev, [contentId]: true }));
    const streams = await getContentVideoStreams(contentId);
    setStreamsByContentId((prev) => ({ ...prev, [contentId]: streams }));
    setLoadingStreams((prev) => ({ ...prev, [contentId]: false }));
  }

  const toggleYear = (year: number, pageId: number) => {
    const isExpanding = expandedYear !== year;
    setExpandedYear(isExpanding ? year : null);
    setExpandedEvent(null);
    if (isExpanding) loadEvents(pageId);
  };

  const toggleEvent = (eventKey: string, gpPageId: number) => {
    const isExpanding = expandedEvent !== eventKey;
    setExpandedEvent(isExpanding ? eventKey : null);
    setExpandedSessionKey(null);
    if (isExpanding) loadSessions(eventKey, gpPageId);
  };

  const toggleSession = (eventKey: string, session: VodSession, year: number) => {
    const key = `${eventKey}-${session.contentId}`;
    const isExpanding = expandedSessionKey !== key;
    setExpandedSessionKey(isExpanding ? key : null);
    if (isExpanding) loadStreamsForSession(session.contentId);
  };

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: '0 0 6px' }}>{t('dashboard.title')}</h2>
          <div className="kpi">
            <span>{t('dashboard.live')}: <strong>{items.length}</strong></span>
            <span>{t('dashboard.vodSeasons')}: <strong>{vodSeasons.length}</strong></span>
            <span>{t('dashboard.status')}: <strong>{busy ? t('dashboard.statusLoading') : t('dashboard.statusReady')}</strong></span>
          </div>
        </div>
        <button className="btn" onClick={onRefresh} disabled={busy} type="button">
          {t('dashboard.refresh')}
        </button>
      </div>
      {error && <div className="error">{error}</div>}

      {/* Live */}
      <section>
        <h3 style={{ margin: '0 0 10px', fontSize: 16, color: 'var(--muted)' }}>{t('dashboard.liveSection')}</h3>
        {items.length === 0 && !busy && (
          <p style={{ color: 'var(--muted)', margin: 0, fontSize: 14 }}>
            {t('dashboard.noLiveEvents')}
          </p>
        )}
        <div className="grid">
          {items.map((it) => (
            <button key={it.id} type="button" className="card" onClick={() => onOpen(it)}>
              <h3 className="cardTitle">{it.title}</h3>
              <p className="cardMeta">{t('dashboard.live')}</p>
            </button>
          ))}
        </div>
      </section>

      {/* Video - Past championships */}
      <section>
        <h3 style={{ margin: '0 0 10px', fontSize: 16, color: 'var(--muted)' }}>{t('dashboard.pastChampionships')}</h3>
        {vodSeasons.length === 0 && !busy && (
          <p style={{ color: 'var(--muted)', margin: 0, fontSize: 14 }}>
            {t('dashboard.noSeasons')}
          </p>
        )}
        <div style={{ display: 'grid', gap: 6 }}>
          {vodSeasons.map(({ year, pageId }) => {
            const events = eventsBySeasonPageId[pageId];
            const loadingEvs = loadingEvents[pageId];
            return (
              <div key={year} style={{ border: '1px solid var(--stroke)', borderRadius: 12, overflow: 'hidden' }}>
                <button
                  type="button"
                  className="row"
                  onClick={() => toggleYear(year, pageId)}
                  style={{
                    width: '100%',
                    justifyContent: 'space-between',
                    padding: '12px 14px',
                    background: 'rgba(255,255,255,0.04)',
                    border: 'none',
                    color: 'inherit',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <strong>{t('dashboard.season')} {year}</strong>
                  <span style={{ color: 'var(--muted)', fontSize: 13 }}>
                    {expandedYear === year ? '▼' : '▶'}
                    {events ? ` ${events.length} GP` : ''}
                  </span>
                </button>

                {expandedYear === year && (
                  <div style={{ padding: '8px 12px 12px', display: 'grid', gap: 8 }}>
                    {loadingEvs && (
                      <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>{t('dashboard.loadingGps')}</p>
                    )}
                    {!loadingEvs && events?.length === 0 && (
                      <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>{t('dashboard.noGpsFound')}</p>
                    )}
                    {events?.map((ev: VodEvent) => {
                      const eventKey = `${year}-${ev.meetingKey}`;
                      const gpPageId = ev.pageId ?? 0;
                      if (!gpPageId) return null;
                      const sessions = sessionsByEvent[eventKey];
                      const loadingSess = loadingSessions[eventKey];
                      const isExpanded = expandedEvent === eventKey;

                      return (
                        <div
                          key={eventKey}
                          style={{
                            border: '1px solid var(--stroke)',
                            borderRadius: 10,
                            overflow: 'hidden',
                            background: 'rgba(0,0,0,0.15)',
                          }}
                        >
                          <button
                            type="button"
                            className="row"
                            onClick={() => toggleEvent(eventKey, gpPageId)}
                            style={{
                              width: '100%',
                              justifyContent: 'space-between',
                              padding: '10px 12px',
                              background: 'none',
                              border: 'none',
                              color: 'inherit',
                              cursor: 'pointer',
                              textAlign: 'left',
                            }}
                          >
                            <strong style={{ fontSize: 14 }}>{ev.meetingName}</strong>
                            <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                              {isExpanded ? '▼' : '▶'}
                              {sessions ? ` ${sessions.length} ${t('dashboard.sessions')}` : ''}
                            </span>
                          </button>

                          {isExpanded && (
                            <div style={{ padding: '8px 12px 14px', display: 'grid', gap: 6 }}>
                              {loadingSess && (
                                <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>{t('dashboard.loadingSessions')}</p>
                              )}
                              {!loadingSess && sessions?.length === 0 && (
                                <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>{t('dashboard.noSessionsFound')}</p>
                              )}
                              {sessions?.map((session: VodSession) => {
                                const sessionStreamKey = `${eventKey}-${session.contentId}`;
                                const isSessionExpanded = expandedSessionKey === sessionStreamKey;
                                const streams = streamsByContentId[session.contentId];
                                const loadingStr = loadingStreams[session.contentId];
                                return (
                                  <div
                                    key={`${session.contentId}-${session.channelId ?? 0}`}
                                    style={{
                                      border: '1px solid var(--stroke)',
                                      borderRadius: 8,
                                      overflow: 'hidden',
                                      background: 'rgba(0,0,0,0.1)',
                                    }}
                                  >
                                    <button
                                      type="button"
                                      className="row"
                                      style={{
                                        width: '100%',
                                        justifyContent: 'space-between',
                                        padding: '8px 10px',
                                        background: 'none',
                                        border: 'none',
                                        color: 'inherit',
                                        cursor: 'pointer',
                                        textAlign: 'left',
                                        fontSize: 13,
                                      }}
                                      onClick={() => toggleSession(eventKey, session, year)}
                                    >
                                      <span>
                                        {sessionLabels[session.type] || session.type}
                                        {session.title ? ` · ${session.title}` : ''}
                                      </span>
                                      <span style={{ color: 'var(--muted)', fontSize: 11 }}>
                                        {isSessionExpanded ? '▼' : '▶'} {t('dashboard.stream')}
                                      </span>
                                    </button>
                                    {isSessionExpanded && (
                                      <div style={{ padding: '6px 10px 10px', display: 'grid', gap: 6 }}>
                                        {loadingStr && (
                                          <p style={{ margin: 0, fontSize: 11, color: 'var(--muted)' }}>{t('dashboard.loadingStreams')}</p>
                                        )}
                                        {!loadingStr && (
                                          <>
                                            <button
                                              type="button"
                                              className="card"
                                              style={{ textAlign: 'left', padding: '8px 10px' }}
                                              onClick={() => onOpen(toCatalogItem(session, year))}
                                            >
                                              <span className="cardTitle" style={{ fontSize: 13 }}>{t('dashboard.mainFeed')}</span>
                                              <p className="cardMeta" style={{ fontSize: 11 }}>{session.title}</p>
                                            </button>
                                            {streams?.dataChannel?.length > 0 && (
                                              <>
                                                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t('dashboard.dataChannel')}</div>
                                                {streams.dataChannel.map((dc: VodOnboard) => (
                                                  <button
                                                    key={`dc-${dc.channelId}`}
                                                    type="button"
                                                    className="card"
                                                    style={{ textAlign: 'left', padding: '8px 10px' }}
                                                    onClick={() => onOpen(toCatalogItemOnboard(dc))}
                                                  >
                                                    <span className="cardTitle" style={{ fontSize: 13 }}>{dc.title}</span>
                                                  </button>
                                                ))}
                                              </>
                                            )}
                                            {streams?.onboard?.length > 0 && (
                                              <>
                                                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t('dashboard.onboard')}</div>
                                                {streams.onboard.map((ob: VodOnboard) => (
                                                  <button
                                                    key={`ob-${ob.channelId}`}
                                                    type="button"
                                                    className="card"
                                                    style={{ textAlign: 'left', padding: '8px 10px' }}
                                                    onClick={() => onOpen(toCatalogItemOnboard(ob))}
                                                  >
                                                    <span className="cardTitle" style={{ fontSize: 13 }}>{ob.title}</span>
                                                    {(ob.driverName || ob.teamName) && (
                                                      <p className="cardMeta" style={{ fontSize: 11 }}>
                                                        {[ob.driverName, ob.teamName].filter(Boolean).join(' · ')}
                                                      </p>
                                                    )}
                                                  </button>
                                                ))}
                                              </>
                                            )}
                                            {!loadingStr && streams && streams.onboard.length === 0 && streams.dataChannel.length === 0 && (
                                              <p style={{ margin: 0, fontSize: 11, color: 'var(--muted)' }}>{t('dashboard.mainFeedOnly')}</p>
                                            )}
                                          </>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
