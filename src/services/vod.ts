import type { VodCatalog, VodSeason, VodEvent, VodSession, VodOnboard } from '../domain/vod';

/** Carica solo la lista delle stagioni (veloce, 1 richiesta HTTP) */
export async function getVodSeasons(): Promise<Array<{ year: number; pageId: number }>> {
  if (!window.f1?.getVodSeasons) return [];
  return window.f1.getVodSeasons().catch(() => []);
}

/** Carica i GP di una stagione dato il pageId (1 richiesta HTTP) */
export async function getVodEvents(seasonPageId: number): Promise<VodEvent[]> {
  if (!window.f1?.getVodEvents) return [];
  const items = await window.f1.getVodEvents(seasonPageId).catch(() => []);
  return items.map(ev => ({
    meetingKey: ev.meetingKey,
    meetingName: ev.meetingName,
    meetingNumber: ev.meetingNumber,
    pageId: ev.pageId,
    sessions: [],
    onboard: [],
  }));
}

/** Carica le sessioni di un GP dato il pageId (1 richiesta HTTP) */
export async function getVodSessions(gpPageId: number): Promise<VodSession[]> {
  if (!window.f1?.getVodSessions) return [];
  const items = await window.f1.getVodSessions(gpPageId).catch(() => []);
  return items.map(s => ({
    contentId: s.contentId,
    title: s.title,
    type: s.type as VodSession['type'],
  }));
}

/** @deprecated Usa getVodSeasons + getVodEvents + getVodSessions per lazy loading */
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

/** Tutti gli stream per una sessione: ripresa principale (session), data channel, onboard. */
export type SessionStreams = {
  onboard: VodOnboard[];
  dataChannel: VodOnboard[];
};

export async function getContentVideoStreams(contentId: number): Promise<SessionStreams> {
  if (!window.f1?.getContentVideo) return { onboard: [], dataChannel: [] };
  const data = await window.f1.getContentVideo(contentId).catch(() => ({ onboard: [], dataChannel: [] }));
  return {
    onboard: (data?.onboard || []) as VodOnboard[],
    dataChannel: (data?.dataChannel || []) as VodOnboard[],
  };
}
