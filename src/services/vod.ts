import type { VodCatalog, VodSeason, VodEvent, VodSession, VodOnboard } from '../domain/vod';

/** Loads only the list of seasons (fast, 1 HTTP request) */
export async function getVodSeasons(): Promise<Array<{ year: number; pageId: number }>> {
  if (!window.f1?.getVodSeasons) return [];
  return window.f1.getVodSeasons().catch(() => []);
}

/** Loads the GPs of a season given the pageId (1 HTTP request) */
export async function getVodEvents(seasonPageId: number): Promise<VodEvent[]> {
  if (!window.f1?.getVodEvents) return [];
  const items = await window.f1.getVodEvents(seasonPageId).catch(() => []);
  return items.map(ev => ({
    meetingKey: ev.meetingKey,
    meetingName: ev.meetingName,
    meetingNumber: ev.meetingNumber,
    pageId: ev.pageId,
    isTest: ev.isTest,
    sessions: [],
    onboard: [],
  }));
}

/** Loads the sessions of a GP given the pageId (1 HTTP request) */
export async function getVodSessions(gpPageId: number): Promise<VodSession[]> {
  if (!window.f1?.getVodSessions) return [];
  const items = await window.f1.getVodSessions(gpPageId).catch(() => []);
  return items.map(s => ({
    contentId: s.contentId,
    title: s.title,
    type: s.type as VodSession['type'],
    series: s.series,
  }));
}

/** @deprecated Use getVodSeasons + getVodEvents + getVodSessions for lazy loading */
export async function getVodCatalog(): Promise<VodCatalog> {
  if (!window.f1?.getVodCatalog) return { seasons: [] };
  const data = await window.f1.getVodCatalog().catch(() => ({ seasons: [] }));
  const seasons = (data?.seasons || []) as Array<{ year: number; events: VodEvent[] }>;
  return { seasons };
}

export async function getContentVideoOnboard(contentId: number): Promise<VodOnboard[]> {
  if (!window.f1?.getContentVideo) return [];
  const data = await window.f1.getContentVideo(contentId).catch(() => ({ onboard: [] }));
  return (data?.onboard || []) as VodOnboard[];
}

/** All streams for a session: main feed (session), data channel, onboard. */
export type SessionStreams = {
  onboard: VodOnboard[];
  dataChannel: VodOnboard[];
  /** World feed from additionalStreams (PRES/WIF/default). Needed for live DRM. */
  mainChannel?: VodOnboard;
};

export async function getContentVideoStreams(contentId: number): Promise<SessionStreams> {
  if (!window.f1?.getContentVideo) return { onboard: [], dataChannel: [] };
  const data = await window.f1.getContentVideo(contentId).catch(() => ({ onboard: [], dataChannel: [], mainChannel: undefined }));
  return {
    onboard: (data?.onboard || []) as VodOnboard[],
    dataChannel: (data?.dataChannel || []) as VodOnboard[],
    mainChannel: (data?.mainChannel || undefined) as VodOnboard | undefined,
  };
}
