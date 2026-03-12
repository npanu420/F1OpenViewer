import type { CatalogItem } from '../domain/catalog';

/**
 * Catalogo da F1 TV: live now + VOD (search). Richiede sessione attiva (login).
 */
export async function getCatalog(): Promise<CatalogItem[]> {
  if (!window.f1?.getLiveNow || !window.f1?.searchVod) {
    throw new Error('Catalogo F1 TV non disponibile (avvia l’app in Electron).');
  }
  const [liveItems, vodResult] = await Promise.all([
    window.f1.getLiveNow().catch(() => []) as Promise<Array<{ id?: string; title?: string; contentId: number; channelId?: number; meetingKey?: string; sessionKey?: string }>>,
    window.f1.searchVod({ maxResults: '50', orderBy: 'startDate', sortOrder: 'desc' }).catch(() => []) as Promise<Array<{ id?: string; title?: string; contentId: number; season?: number }>>,
  ]);
  const live: CatalogItem[] = (liveItems || []).map((item) => ({
    id: item.id || `live-${item.contentId}`,
    title: item.title || 'Live',
    kind: 'live' as const,
    contentId: item.contentId,
    channelId: item.channelId,
    meetingKey: item.meetingKey,
    sessionKey: item.sessionKey,
  }));
  const vod: CatalogItem[] = (vodResult || []).map((item) => ({
    id: item.id || `vod-${item.contentId}`,
    title: item.title || 'VOD',
    kind: 'replay' as const,
    contentId: item.contentId,
    season: item.season != null ? String(item.season) : undefined,
  }));
  return [...live, ...vod];
}
