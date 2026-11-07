import type { CatalogItem } from '../domain/catalog';

/**
 * Catalog from F1 TV: live now + VOD (search). Requires active session (login).
 */
export async function getCatalog(onProgress?: (items: CatalogItem[]) => void): Promise<CatalogItem[]> {
  if (!window.f1?.getLiveNow || !window.f1?.searchVod) {
    throw new Error('F1 TV catalog not available (run the app in Electron).');
  }
  const { getLiveNow, searchVod } = window.f1;
  let live: CatalogItem[] = [];
  let vod: CatalogItem[] = [];
  await Promise.all([
    (async () => {
      const liveItems = await (getLiveNow().catch(() => []) as Promise<Array<{ id?: string; title?: string; contentId: number; channelId?: number; meetingKey?: string; sessionKey?: string }>>);
      live = (liveItems || []).map((item) => ({
        id: item.id || `live-${item.contentId}`, title: item.title || 'Live', kind: 'live' as const,
        contentId: item.contentId, channelId: item.channelId, meetingKey: item.meetingKey, sessionKey: item.sessionKey,
      }));
      onProgress?.([...live, ...vod]);
    })(),
    (async () => {
      const vodResult = await (searchVod({ maxResults: '50', orderBy: 'startDate', sortOrder: 'desc' }).catch(() => []) as Promise<Array<{ id?: string; title?: string; contentId: number; season?: number }>>);
      vod = (vodResult || []).map((item) => ({
        id: item.id || `vod-${item.contentId}`, title: item.title || 'VOD', kind: 'replay' as const,
        contentId: item.contentId, season: item.season != null ? String(item.season) : undefined,
      }));
      onProgress?.([...live, ...vod]);
    })(),
  ]);
  return [...live, ...vod];
}
