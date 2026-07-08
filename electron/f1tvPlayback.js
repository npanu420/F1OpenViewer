/**
 * Playback resolution: turns a contentId/channelId into a manifest + license URL pair.
 * Tries every F1TV platform profile in parallel, picks a DASH/Widevine primary with an HLS
 * fallback, and fills in the license URL from whichever source actually has it (API response,
 * manifest body, or F1's fallback LA endpoint) since pipeline 4+ VODs often omit it from all but one.
 */

const { F1TV } = require('@exhumer/f1tv-api');
const { fetch: undiciFetch } = require('undici');
const client = require('./f1tvClient');
const { pickMainChannelStream } = require('./f1tvCatalog');

const { F1TV_BASE, F1TV_PLATFORM, F1TV_LANG, F1TV_ENTITLEMENT, F1TV_GROUP } = client;

/**
 * Extracts a user-facing error message from F1 API responses (axios error, response body, or Error).
 * Use this so the UI can show the actual message from F1 (e.g. "Content not available in your region").
 */
function extractF1ErrorMessage(error, fallback = '') {
  if (!error) return fallback;
  const data = error.response?.data ?? error.body ?? error.data;
  if (data && typeof data === 'object') {
    const msg =
      data.message ??
      data.error ??
      data.errormsg ??
      data.resultObj?.keyos?.errormsg ??
      data.resultObj?.message;
    if (msg && typeof msg === 'string' && msg.trim()) return msg.trim();
    if (data.resultCode && data.resultCode !== 'OK') {
      return (data.message && typeof data.message === 'string' ? data.message : String(data.resultCode)).trim();
    }
  }
  if (error.message && typeof error.message === 'string' && error.message.trim()) return error.message.trim();
  return fallback;
}

/** Extracts message from a successful-looking response that has resultCode !== 'OK' (e.g. contentPlay). */
function getMessageFromF1Response(res) {
  if (!res || !res.resultCode || res.resultCode === 'OK') return '';
  const msg = res.message ?? res.resultObj?.message ?? res.resultObj?.keyos?.errormsg;
  return (msg && typeof msg === 'string' && msg.trim()) ? msg.trim() : String(res.resultCode);
}

/**
 * Merge playToken + Electron defaultSession cookies for the manifest origin (main process only).
 * CDN often needs browser session cookies, not only playToken.
 */
async function buildManifestRequestCookieHeader(manifestUrl, playTokenCookie) {
  const byName = new Map();
  try {
    const { session } = require('electron');
    const list = await session.defaultSession.cookies.get({ url: manifestUrl });
    for (const c of list) {
      if (c?.name) byName.set(c.name, c.value || '');
    }
  } catch (_) {}
  if (playTokenCookie) byName.set('playToken', playTokenCookie);
  if (!byName.size) return undefined;
  return [...byName.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

/**
 * Pull Widevine / F1 LA URL from MPD or related XML (scan a large prefix; LA is usually early).
 */
function extractPlayTokenFromFetchHeaders(headers) {
  if (!headers) return null;
  try {
    if (typeof headers.getSetCookie === 'function') {
      for (const c of headers.getSetCookie()) {
        const mc = String(c).match(/playToken=([^;,\s]+)/i);
        if (mc) return mc[1];
      }
    }
  } catch (_) {}
  try {
    const sc = headers.get('set-cookie') || '';
    const m = sc.match(/playToken=([^;,\s]+)/i);
    if (m) return m[1];
  } catch (_) {}
  return null;
}

function extractLicenseUrlFromManifestText(text) {
  if (!text || typeof text !== 'string') return '';
  const head = text.length > 400000 ? text.slice(0, 400000) : text;
  const tryUrl = (u) => {
    if (!u || typeof u !== 'string') return '';
    const s = u.trim().replace(/&amp;/g, '&');
    return s.startsWith('http') ? s : '';
  };
  const candidates = [
    /licenseServerUrl\s*=\s*["'](https?:\/\/[^"']+)["']/i,
    /(?:laurl|Laurl|LAURL)\s*[=:]\s*["'](https?:\/\/[^"']+)["']/i,
    /<(?:dashif:|cenc:|ms:)?[^>]*(?:Laurl|laurl)[^>]*>\s*(https?:\/\/[^<\s]+)/i,
    /https:\/\/f1tv\.formula1\.com\/[^\s"'<>]+CONTENT\/LA[^\s"'<>]*/i,
    /https:\/\/[^\s"'<>]+\/CONTENT\/LA\/[^\s"'<>]*/i,
  ];
  for (const re of candidates) {
    const m = head.match(re);
    if (!m) continue;
    const u = tryUrl(m[1] || m[0]);
    if (u) return u;
  }
  return '';
}

/**
 * Fetches the DASH/HLS manifest via GET and extracts both:
 * - playToken: the session cookie required for Widevine license acquisition
 * - licenseUrl: the license acquisition URL embedded in the manifest (if any)
 *
 * GET is used instead of HEAD because CDNs (e.g. CloudFront) typically only set session
 * cookies on real content GET requests, not HEAD requests. This also replaces the previous
 * separate extractLicenseUrlFromManifest + fetchPlayToken calls (two round-trips) with one.
 */
function logManifestLicenseDiagnostics(text, res) {
  const ct = res.headers?.get?.('content-type') || '';
  const prefix = text.slice(0, 200).replace(/\s+/g, ' ');
  console.warn('[playback] no LA in manifest | content-type:', ct, '| body prefix:', prefix);
  const cpMatches = text.match(/<ContentProtection[\s\S]*?<\/ContentProtection>/gi) || [];
  if (cpMatches.length) {
    console.warn('[playback] manifest ContentProtection sections:');
    cpMatches.forEach((cp, i) => console.warn(`  [CP${i}]`, cp.slice(0, 600).replace(/\s+/g, ' ')));
  } else {
    console.warn('[playback] manifest has NO ContentProtection elements');
  }
}

/**
 * Load manifest from CDN. Prefer Chromium session.fetch (same TLS/cookie stack as license proxy);
 * Undici: try no Cookie first (matches pre-1.1.4 behaviour), then playToken, then session merge,
 * extra cookies on signed ott-video URLs can trigger 404.
 */
async function fetchManifestData(manifestUrl, f1Client, playTokenCookie) {
  const out = { playToken: null, licenseUrl: '', ok: false };
  const isHls = /\.m3u8(\?|$)/i.test(String(manifestUrl || ''));
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Origin: 'https://f1tv.formula1.com',
    Referer: 'https://f1tv.formula1.com/',
    Accept: isHls
      ? 'application/vnd.apple.mpegurl, application/x-mpegURL, audio/mpegurl, */*'
      : 'application/dash+xml, application/xml, */*',
  };
  if (f1Client?.ascendon) headers.ascendontoken = f1Client.ascendon;
  if (f1Client?.entitlement) headers.entitlementtoken = f1Client.entitlement;

  const applyBody = (text, res) => {
    out.licenseUrl = extractLicenseUrlFromManifestText(text);
    if (out.licenseUrl) {
      console.log('[playback] licenseUrl extracted from manifest');
    } else if (text && !isHls) {
      logManifestLicenseDiagnostics(text, res);
    }
  };

  if (typeof process !== 'undefined' && process.versions?.electron) {
    try {
      const { session } = require('electron');
      const jar = session.defaultSession;
      if (playTokenCookie) {
        try {
          const u = new URL(manifestUrl);
          await jar.cookies.set({ url: `${u.origin}/`, name: 'playToken', value: String(playTokenCookie), path: '/' });
        } catch (_) {}
      }
      const res = await jar.fetch(manifestUrl, { method: 'GET', headers: { ...headers } });
      const pt = extractPlayTokenFromFetchHeaders(res.headers);
      if (pt) out.playToken = pt;
      const text = await res.text();
      if (res.ok) {
        applyBody(text, res);
        out.ok = true;
        return out;
      }
      console.warn('[playback] manifest GET failed (Chromium):', res.status, res.statusText);
    } catch (e) {
      console.warn('[playback] fetchManifestData Chromium error:', e?.message);
    }
  }

  const undiciAttempts = [
    { label: 'no Cookie', cookie: null },
    ...(playTokenCookie
      ? [{ label: 'playToken only', cookie: `playToken=${playTokenCookie}` }]
      : []),
  ];
  let fullJarCookie;
  try {
    fullJarCookie = await buildManifestRequestCookieHeader(manifestUrl, playTokenCookie);
  } catch (_) {
    fullJarCookie = undefined;
  }
  if (fullJarCookie && /^[\x00-\xff]*$/.test(fullJarCookie)) {
    undiciAttempts.push({ label: 'session+playToken', cookie: fullJarCookie });
  } else if (fullJarCookie) {
    console.warn('[playback] manifest Cookie header has non-Latin1 bytes, skipping session merge for undici');
  }

  for (const attempt of undiciAttempts) {
    try {
      const h = { ...headers };
      if (attempt.cookie) h.Cookie = attempt.cookie;
      const res = await undiciFetch(manifestUrl, { method: 'GET', headers: h });
      const pt = extractPlayTokenFromFetchHeaders(res.headers);
      if (pt) out.playToken = pt;

      if (res.ok) {
        const text = await res.text();
        applyBody(text, res);
        out.ok = true;
        if (attempt.label !== 'no Cookie') {
          console.log('[playback] manifest GET ok (undici):', attempt.label);
        }
        break;
      }
      console.warn('[playback] manifest GET failed (undici):', res.status, res.statusText, '|', attempt.label);
      try { await res.body?.cancel(); } catch (_) {}
    } catch (e) {
      console.warn('[playback] fetchManifestData error:', e?.message, '|', attempt.label);
    }
  }
  return out;
}

/**
 * Extracts the playToken from the CloudFront signed manifest URL.
 *
 * F1 TV embeds the play session token directly in the manifest URL as a base64url-encoded
 * payload: /v2/pa_[BASE64URL]/... The payload is pipe-separated key:value pairs and contains
 * a |token:VALUE field. The F1 TV JavaScript player extracts this token and sets it as the
 * playToken cookie for DRM license requests. We replicate this here so no extra HTTP requests
 * are needed.
 *
 * Example payload after decoding:
 *   path:/a723ea.../...|kid:1042|exp:...|geo:NL|streamType:SDR_HD_DASHWV|sessionId:...|token:xfZgIf...
 */
function decodePaPayload(manifestUrl) {
  try {
    const match = manifestUrl.match(/\/pa_([^/?#]+)/);
    if (!match) return null;
    let b64 = match[1].replace(/-/g, '+').replace(/_/g, '/');
    b64 += '='.repeat((4 - (b64.length % 4)) % 4);
    // latin1 keeps binary playToken bytes intact (utf8 corrupts non-UTF8 token values).
    const decoded = Buffer.from(b64, 'base64').toString('latin1');
    const result = {};
    // First field has no leading pipe: "path:VALUE"
    for (const part of decoded.split('|')) {
      const idx = part.indexOf(':');
      if (idx > 0) result[part.slice(0, idx)] = part.slice(idx + 1);
    }
    return Object.keys(result).length ? result : null;
  } catch (e) {
    return null;
  }
}

/** playToken must be a printable token string, reject binary garbage from bad decodes. */
function sanitizePlayToken(tok) {
  if (tok == null) return null;
  const s = String(tok);
  if (!s || s.length < 4) return null;
  if (/[\x00-\x08\x0e-\x1f\x7f]/.test(s)) return null;
  return s;
}

function resolveChannelId(primary, fallback, requested) {
  for (const c of [primary?.channelId, fallback?.channelId, requested]) {
    if (c != null && c !== '' && !Number.isNaN(Number(c))) return Number(c);
  }
  return undefined;
}

function hasLicenseMetadata(candidate) {
  return !!(candidate?.laURL || candidate?.laUrl || candidate?.drmToken);
}

function isWidevineCandidate(candidate) {
  const streamType = String(candidate?.streamType || '').toUpperCase();
  const drmType = String(candidate?.drmType || '').toLowerCase();
  return streamType.includes('WV') || drmType === 'widevine' || hasLicenseMetadata(candidate);
}

function isDashPlatform(candidate) {
  return String(candidate?.platform || '').toUpperCase().includes('DASH');
}

function pickPrimaryPlaybackCandidate(candidates) {
  const preferenceBuckets = [
    (c) => isWidevineCandidate(c) && hasLicenseMetadata(c) && isDashPlatform(c),
    (c) => isWidevineCandidate(c) && hasLicenseMetadata(c),
    (c) => isWidevineCandidate(c) && isDashPlatform(c),
    (c) => isWidevineCandidate(c),
    (c) => !isWidevineCandidate(c),
  ];
  for (const match of preferenceBuckets) {
    const candidate = candidates.find(match);
    if (candidate) return candidate;
  }
  return candidates[0] || null;
}

function pickFallbackPlaybackCandidate(candidates, primary) {
  if (!primary) return null;
  const remaining = candidates.filter((c) => c !== primary);
  if (!remaining.length) return null;
  if (isWidevineCandidate(primary)) {
    const otherDashWv = remaining.find(
      (c) => isWidevineCandidate(c) && isDashPlatform(c) && c.platform !== primary.platform
    );
    return (
      otherDashWv
      || remaining.find((c) => !isWidevineCandidate(c))
      || remaining.find(hasLicenseMetadata)
      || remaining[0]
    );
  }
  return remaining.find((c) => isWidevineCandidate(c) && hasLicenseMetadata(c))
    || remaining.find(isWidevineCandidate)
    || remaining[0];
}

function scrubPlaybackObj(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'url' && typeof v === 'string') out.url = v.slice(0, 120) + (v.length > 120 ? '…' : '');
    else if (k.toLowerCase().includes('token') && typeof v === 'string') out[k] = v.slice(0, 12) + '…';
    else out[k] = v;
  }
  return out;
}

/**
 * Fallback LA when CONTENT/PLAY and manifest omit laURL (pipeline 4+ / 2025-2026 VOD observed).
 * - Older API: .../CONTENT/LA/{entitlement}/{groupId} (same pattern as PAGE requests).
 * - Pipeline 3+ (2025 VOD often pv=3): .../CONTENT/LA/widevine?contentId=&channelId= when API omits laURL.
 * - Pipeline 4+: same widevine path (entitlement-only POST often CloudFront 403 on newer assets).
 * @param {number} [pipelineVersion] - from CONTENT/PLAY resultObj
 * @param {number} [contentId] - current asset
 * @param {number} [channelId] - optional multi-feed channel
 * @param {string} [playbackPlatform] - e.g. WEB_DASH, BIG_SCREEN_DASH (must match CONTENT/PLAY profile)
 * @param {string} [streamType] - e.g. SDR_HD_DASHWV (used when pipelineVersion is missing)
 */
function getFallbackLicenseUrl(f1Client, contentId, channelId, pipelineVersion, playbackPlatform, streamType) {
  if (!f1Client) return '';
  const auth = f1Client.ascendon ? 'R' : 'A';
  const userLoc = f1Client.location?.userLocation?.[0];
  let entitlement = userLoc?.entitlement || F1TV_ENTITLEMENT;
  if (auth === 'R' && (entitlement === 'ANONYMOUS' || !entitlement)) {
    entitlement = F1TV_ENTITLEMENT;
  }
  const groupId = String(userLoc?.groupId ?? F1TV_GROUP);
  const platformSeg = playbackPlatform && String(playbackPlatform).trim()
    ? String(playbackPlatform).trim()
    : F1TV_PLATFORM;

  const pv = typeof pipelineVersion === 'number' ? pipelineVersion : parseInt(String(pipelineVersion), 10);
  const wv = String(streamType || '').toUpperCase().includes('WV');
  const useWidevineLa =
    contentId != null &&
    !Number.isNaN(Number(contentId)) &&
    ((Number.isFinite(pv) && pv >= 3) || (wv && !Number.isFinite(pv)));

  if (useWidevineLa) {
    const base = `${F1TV_BASE}/2.0/${auth}/${F1TV_LANG}/${platformSeg}/ALL/CONTENT/LA/widevine`;
    const u = new URL(base);
    u.searchParams.set('contentId', String(contentId));
    if (channelId != null && channelId !== '' && !Number.isNaN(Number(channelId))) {
      u.searchParams.set('channelId', String(channelId));
    }
    return u.toString();
  }

  return `${F1TV_BASE}/2.0/${auth}/${F1TV_LANG}/${platformSeg}/ALL/CONTENT/LA/${entitlement}/${groupId}`;
}

/**
 * Gets playback URLs with profile fallback:
 * - primary: WEB_DASH (Widevine)
 * - fallback: WEB_HLS (useful on machines without an available key system)
 * @returns {{
 *  manifestUrl: string,
 *  licenseUrl: string,
 *  drmToken?: string,
 *  streamType: string,
 *  fallbackManifestUrl?: string,
 *  fallbackLicenseUrl?: string,
 *  fallbackDrmToken?: string,
 *  fallbackStreamType?: string
 * }}
 */
async function contentPlay(contentId, channelId) {
  const f1Client = client.getClient();
  if (!f1Client.entitlement) {
    throw new Error('Session not ready: entitlement missing. Sign out and sign in again with "Sign in with browser", then retry.');
  }
  const contentIdNum = typeof contentId === 'string' ? parseInt(contentId, 10) : contentId;
  let requestChannelId = channelId;
  if (requestChannelId == null || requestChannelId === '' || Number.isNaN(Number(requestChannelId))) {
    try {
      const cv = await f1Client.contentVideo(contentIdNum);
      const main = pickMainChannelStream(cv?.metadata?.additionalStreams || []);
      if (main?.channelId) {
        requestChannelId = main.channelId;
        console.log('[playback] main feed channelId from contentVideo:', requestChannelId);
      }
    } catch (_) {}
  }
  // Try all platforms in parallel so we get one round-trip per stream instead of 6 sequential calls.
  // Prefer DASH/Widevine as primary; HLS stays as fallback for hosts without a working key system.
  const platformOrder = [
    F1TV.Platform.WEB_DASH,
    F1TV.Platform.BIG_SCREEN_DASH,
    F1TV.Platform.WEB_HLS,
    F1TV.Platform.BIG_SCREEN_HLS,
    F1TV.Platform.MOBILE_HLS,
    F1TV.Platform.TABLET_HLS,
  ];
  const results = await Promise.allSettled(
    platformOrder.map((p) => f1Client.contentPlay(contentIdNum, requestChannelId, p))
  );
  const candidates = [];
  let firstError = null;
  let firstF1Message = '';
  results.forEach((outcome, idx) => {
    const p = platformOrder[idx];
    if (outcome.status === 'fulfilled') {
      const res = outcome.value;
      if (res && !res?.resultObj?.url) {
        const resMsg = getMessageFromF1Response(res);
        if (resMsg && !firstF1Message) firstF1Message = resMsg;
      }
      const obj = res?.resultObj;
      if (obj?.url) candidates.push({ platform: p, ...obj });
    } else {
      const e = outcome.reason;
      if (!firstError) firstError = e;
      if (!firstF1Message) firstF1Message = extractF1ErrorMessage(e) || getMessageFromF1Response(e?.response?.data);
    }
  });
  // Preserve preference order: first candidate in platformOrder wins as primary.
  candidates.sort((a, b) => platformOrder.indexOf(a.platform) - platformOrder.indexOf(b.platform));
  if (!candidates.length) {
    const f1Msg = firstF1Message || extractF1ErrorMessage(firstError);
    const detail = f1Msg || (firstError ? (firstError.message || String(firstError)) : '');
    console.error('[playback] all playback profiles failed. F1 message:', f1Msg || detail);
    throw new Error(f1Msg ? `F1 TV: ${f1Msg}` : (firstError ? `Playback unavailable. ${detail}` : 'Playback unavailable. Sign out and sign in again with "Sign in with browser", then retry.'));
  }
  console.log('[playback] candidates:', candidates.map((c) => `${c.platform}:${c.streamType || 'UNKNOWN'}:license=${hasLicenseMetadata(c)}:drm=${!!c.drmToken}`).join(' | '));
  let primary = pickPrimaryPlaybackCandidate(candidates);
  let fallback = pickFallbackPlaybackCandidate(candidates, primary);
  if (!primary?.url) throw new Error('F1 TV returned no valid stream URL (DASH/HLS).');

  // Decode the pa_ CloudFront signed URL payload to get both the playToken and the numeric kid.
  let paPayload = decodePaPayload(primary.url);
  let urlPlayToken = paPayload?.token ?? null;

  // Prefetch manifest for LA discovery. Some pipeline-3 (2025) WEB_DASH URLs return 404 from Node
  // and fail in the player; the paired BIG_SCREEN_DASH URL often works, swap if so.
  let md = await fetchManifestData(primary.url, f1Client, urlPlayToken);
  if (!md.ok && fallback?.url && fallback.url !== primary.url) {
    const altTok = decodePaPayload(fallback.url)?.token ?? null;
    const mdAlt = await fetchManifestData(fallback.url, f1Client, altTok);
    if (mdAlt.ok) {
      console.warn(
        '[playback] manifest not reachable for',
        primary.platform,
        ', switching playback to',
        fallback.platform,
        '(alternate DASH profile)'
      );
      const prevPrimary = primary;
      primary = fallback;
      fallback = prevPrimary;
      paPayload = decodePaPayload(primary.url);
      urlPlayToken = paPayload?.token ?? null;
      md = mdAlt;
    }
  }

  let licenseUrl = primary.laURL || primary.laUrl || '';
  if (!licenseUrl && !primary.drmToken) {
    try {
      console.warn('[playback] WARNING: no laURL/drmToken from CONTENT/PLAY for primary:', primary.platform);
      console.warn('[playback] primary fields:', Object.keys(primary).sort().join(','));
      console.warn('[playback] primary (scrubbed):', JSON.stringify(scrubPlaybackObj(primary)));
    } catch (_) {}
  }

  // Decode the per-play entitlementToken JWT, the payload may contain a laURL or kid
  // that reveals where the 2026 license server is.
  try {
    const jwt = primary.entitlementToken;
    if (jwt && jwt.includes('.')) {
      const parts = jwt.split('.');
      const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString('utf8'));
      console.log('[playback] entitlementToken JWT payload:', JSON.stringify(payload));
    }
  } catch (_) {}

  if (!licenseUrl && md.licenseUrl) licenseUrl = md.licenseUrl;

  // Manifest GET Set-Cookie is authoritative; pa_ URL token can contain binary bytes.
  const playToken =
    sanitizePlayToken(md.playToken)
    || sanitizePlayToken(urlPlayToken)
    || null;

  const resolvedChannelId = resolveChannelId(primary, fallback, requestChannelId);
  if (resolvedChannelId != null && resolvedChannelId !== channelId) {
    console.log('[playback] channelId resolved:', resolvedChannelId, '(requested:', channelId ?? 'none', ')');
  }

  if (!licenseUrl) {
    // When CONTENT/PLAY does not return laURL/drmToken (pipeline 4+ on many VODs, esp. 2025-2026),
    // DASH manifests still carry Widevine PSSH; Shaka needs an explicit LA URL.
    // Shaka requires an explicit license server URI, so we must provide a fallback LA endpoint.
    licenseUrl = getFallbackLicenseUrl(
      f1Client,
      contentIdNum,
      resolvedChannelId,
      primary.pipelineVersion,
      primary.platform,
      primary.streamType
    );
    if (licenseUrl) {
      const pathPart = licenseUrl.replace(F1TV_BASE, '');
      console.log(
        '[playback] licenseUrl fallback F1 LA:',
        pathPart,
        '| pipelineVersion:',
        primary.pipelineVersion ?? 'unknown'
      );
    } else {
      console.warn(
        '[playback] no licenseUrl from API/manifest and fallback LA could not be built | pipelineVersion:',
        primary.pipelineVersion ?? 'unknown'
      );
    }
  }
  console.log('[playback] selected platform:', primary.platform, '| streamType:', primary.streamType, '| manifest:', primary.url);
  console.log('[playback] licenseUrl:', licenseUrl ? `${licenseUrl.slice(0, 80)}…` : '(empty)', '| drmToken:', !!primary.drmToken);
  if (fallback?.url) {
    console.log('[playback] fallback platform:', fallback.platform, '| streamType:', fallback.streamType, '| manifest:', fallback.url);
  }

  if (playToken) {
    console.log('[playback] playToken obtained from manifest URL token field');
  } else {
    console.warn('[playback] playToken not found in manifest URL, license may fail');
  }

  // primary.entitlementToken is the per-play entitlement from the contentPlay API response.
  // It may differ from f1Client.entitlement (the user-level token). F1 TV license server
  // expects the per-play token, so prefer it over the general one.
  const licenseEntitlementToken = primary.entitlementToken || f1Client.entitlement || undefined;
  console.log('[playback] entitlementToken: play-specific=', !!primary.entitlementToken, '| client=', !!f1Client.entitlement, '| same=', primary.entitlementToken === f1Client.entitlement);

  /** Numeric CloudFront key group from pa_ URL (not the Widevine KID). Used for LA discovery in main. */
  const paCfKeyGroup = paPayload?.kid != null && String(paPayload.kid).trim() !== '' ? String(paPayload.kid).trim() : undefined;

  return {
    manifestUrl: primary.url,
    licenseUrl,
    drmToken: primary.drmToken,
    playToken: playToken || undefined,
    licenseAscendonToken: f1Client.ascendon || undefined,
    licenseEntitlementToken,
    streamType: primary.streamType || 'UNKNOWN',
    pipelineVersion: primary.pipelineVersion,
    paCfKeyGroup,
    contentId: contentIdNum,
    channelId: resolvedChannelId,
    fallbackManifestUrl: fallback?.url || undefined,
    fallbackLicenseUrl: fallback?.laURL || fallback?.laUrl || '',
    fallbackDrmToken: fallback?.drmToken || undefined,
    fallbackStreamType: fallback?.streamType || undefined,
  };
}

module.exports = {
  contentPlay,
};
