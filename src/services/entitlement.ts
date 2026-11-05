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
  // Account-level tokens (ascendon / entitlement / playToken) are never sent to the renderer: the
  // main process attaches them (license proxy, webRequest hook). Only a per-play drmToken for a
  // license request that bypasses the proxy can arrive here.
  const drmHeaders = (token?: string): Record<string, string> =>
    token ? { Authorization: `Bearer ${token}`, drmtoken: token } : {};
  const licenseHeaders = drmHeaders(play.drmToken);
  const fallbackLicenseHeaders = drmHeaders(play.fallbackDrmToken);
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

