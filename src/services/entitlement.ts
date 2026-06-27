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
 * F1 TV playback: contentPlay returns manifest URL and license URL (Widevine).
 * licenseHeaders include drmToken when provided by the API.
 */
export async function resolvePlayback(item: CatalogItem): Promise<PlaybackInfo> {
  if (!window.f1?.contentPlay) {
    throw new Error('F1 TV playback not available (run the app in Electron).');
  }
  const play = await window.f1.contentPlay(item.contentId, item.channelId);
  if (!play?.manifestUrl) throw new Error('Play response missing manifest URL.');
  const licenseHeaders: Record<string, string> = {};
  if (play.drmToken) {
    licenseHeaders.Authorization = `Bearer ${play.drmToken}`;
    licenseHeaders.drmtoken = play.drmToken;
  }
  if (play.licenseAscendonToken) licenseHeaders.ascendontoken = play.licenseAscendonToken;
  if (play.licenseEntitlementToken) licenseHeaders.entitlementtoken = play.licenseEntitlementToken;
  // playToken is registered per-stream in the main-process license proxy at contentPlay time.
  // Do NOT pass it through renderer headers — binary tokens get corrupted over IPC/strings.
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
