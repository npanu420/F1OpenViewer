import type { VodEvent, VodSession, VodOnboard } from '../domain/vod';

// These reject on failure on purpose: callers show the message (see DashboardView / LiveEventView).
// Outside Electron (no preload bridge) they resolve to empty results.

/** Loads only the list of seasons (fast, 1 HTTP request) */
export async function getVodSeasons(): Promise<Array<{ year: number; pageId: number }>> {
  if (!window.f1?.getVodSeasons) return [];
  return window.f1.getVodSeasons();
}

/** Loads the GPs of a season given the pageId (1 HTTP request) */
export async function getVodEvents(seasonPageId: number): Promise<VodEvent[]> {
  if (!window.f1?.getVodEvents) return [];
  const items = await window.f1.getVodEvents(seasonPageId);
  return items.map((ev) => ({
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
  const items = await window.f1.getVodSessions(gpPageId);
  return items.map((s) => ({
    contentId: s.contentId,
    title: s.title,
    type: s.type as VodSession['type'],
    series: s.series,
  }));
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
  const data = await window.f1.getContentVideo(contentId);
  return {
    onboard: (data?.onboard || []) as VodOnboard[],
    dataChannel: (data?.dataChannel || []) as VodOnboard[],
    mainChannel: (data?.mainChannel || undefined) as VodOnboard | undefined,
  };
}
