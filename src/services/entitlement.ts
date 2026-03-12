import type { CatalogItem } from '../domain/catalog';

export type PlaybackInfo = {
  manifestUrl: string;
  licenseUrl: string;
  licenseHeaders?: Record<string, string>;
  streamType?: string;
  fallbackManifestUrl?: string;
  fallbackLicenseUrl?: string;
  fallbackLicenseHeaders?: Record<string, string>;
  fallbackStreamType?: string;
};

/**
 * Playback F1 TV: contentPlay restituisce manifest URL e license URL (Widevine).
 * licenseHeaders include il drmToken se fornito dall’API.
 */
export async function resolvePlayback(item: CatalogItem): Promise<PlaybackInfo> {
  if (!window.f1?.contentPlay) {
    throw new Error('Playback F1 TV non disponibile (avvia l’app in Electron).');
  }
  const play = await window.f1.contentPlay(item.contentId, item.channelId);
  if (!play?.manifestUrl) throw new Error('Risposta play senza URL manifesto.');
  const licenseHeaders: Record<string, string> = {};
  if (play.drmToken) {
    licenseHeaders.Authorization = `Bearer ${play.drmToken}`;
    licenseHeaders.drmtoken = play.drmToken;
  }
  if (play.licenseAscendonToken) licenseHeaders.ascendontoken = play.licenseAscendonToken;
  if (play.licenseEntitlementToken) licenseHeaders.entitlementtoken = play.licenseEntitlementToken;
  const fallbackLicenseHeaders: Record<string, string> = {};
  if (play.fallbackDrmToken) {
    fallbackLicenseHeaders.Authorization = `Bearer ${play.fallbackDrmToken}`;
    fallbackLicenseHeaders.drmtoken = play.fallbackDrmToken;
  }
  if (play.licenseAscendonToken) fallbackLicenseHeaders.ascendontoken = play.licenseAscendonToken;
  if (play.licenseEntitlementToken) fallbackLicenseHeaders.entitlementtoken = play.licenseEntitlementToken;
  return {
    manifestUrl: play.manifestUrl,
    licenseUrl: play.licenseUrl || '',
    licenseHeaders: Object.keys(licenseHeaders).length ? licenseHeaders : undefined,
    streamType: play.streamType,
    fallbackManifestUrl: play.fallbackManifestUrl,
    fallbackLicenseUrl: play.fallbackLicenseUrl || '',
    fallbackLicenseHeaders: Object.keys(fallbackLicenseHeaders).length ? fallbackLicenseHeaders : undefined,
    fallbackStreamType: play.fallbackStreamType,
  };
}
