/**
 * Bridge for F1 TV: login (api.formula1.com) + client @exhumer/f1tv-api.
 * Runs in the main process (Node) to avoid CORS and to use undici.
 */

const axios = require('axios');
const { fetch: undiciFetch } = require('undici');
const { F1TVClient, F1TV } = require('@exhumer/f1tv-api');

const F1TV_BASE = 'https://f1tv.formula1.com';
const F1TV_PLATFORM = 'WEB_DASH';
const F1TV_LANG = 'ENG';
const F1TV_ENTITLEMENT = 'F1_TV_Pro_Annual';
const F1TV_GROUP = '2';

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
async function fetchManifestData(manifestUrl, client, playTokenCookie) {
  const out = { playToken: null, licenseUrl: '' };
  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Origin: 'https://f1tv.formula1.com',
      Referer: 'https://f1tv.formula1.com/',
      Accept: 'application/dash+xml, application/xml, */*',
    };
    if (client?.ascendon) headers.ascendontoken = client.ascendon;
    if (client?.entitlement) headers.entitlementtoken = client.entitlement;
    const cookieHeader = await buildManifestRequestCookieHeader(manifestUrl, playTokenCookie);
    if (cookieHeader) headers.Cookie = cookieHeader;

    const res = await undiciFetch(manifestUrl, { method: 'GET', headers });

    // Extract playToken from Set-Cookie header(s)
    const sc = res.headers.get('set-cookie') || '';
    const m = sc.match(/playToken=([^;,\s]+)/i);
    if (m) {
      out.playToken = m[1];
    } else if (typeof res.headers.getSetCookie === 'function') {
      for (const c of res.headers.getSetCookie()) {
        const mc = c.match(/playToken=([^;,\s]+)/i);
        if (mc) { out.playToken = mc[1]; break; }
      }
    }

    if (res.ok) {
      const text = await res.text();
      out.licenseUrl = extractLicenseUrlFromManifestText(text);
      if (out.licenseUrl) {
        console.log('[playback] licenseUrl extracted from manifest');
      } else {
        const ct = res.headers.get('content-type') || '';
        const prefix = text.slice(0, 200).replace(/\s+/g, ' ');
        console.warn('[playback] no LA in manifest | content-type:', ct, '| body prefix:', prefix);
        // Log ContentProtection XML sections to diagnose missing license URL
        const cpMatches = text.match(/<ContentProtection[\s\S]*?<\/ContentProtection>/gi) || [];
        if (cpMatches.length) {
          console.warn('[playback] manifest ContentProtection sections:');
          cpMatches.forEach((cp, i) => console.warn(`  [CP${i}]`, cp.slice(0, 600).replace(/\s+/g, ' ')));
        } else {
          console.warn('[playback] manifest has NO ContentProtection elements');
        }
      }
    } else {
      console.warn('[playback] manifest GET failed:', res.status, res.statusText);
      try { await res.body?.cancel(); } catch (_) {}
    }
  } catch (e) {
    console.warn('[playback] fetchManifestData error:', e?.message);
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
/**
 * Decodes the pa_ CloudFront signed URL segment and returns all key:value fields.
 * The payload is pipe-separated: path:...|kid:1042|exp:...|geo:NL|streamType:...|token:VALUE
 * Returns null if decoding fails.
 */
function decodePaPayload(manifestUrl) {
  try {
    const match = manifestUrl.match(/\/pa_([^/?#]+)/);
    if (!match) return null;
    let b64 = match[1].replace(/-/g, '+').replace(/_/g, '/');
    b64 += '='.repeat((4 - (b64.length % 4)) % 4);
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
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
    return remaining.find((c) => !isWidevineCandidate(c)) || remaining.find(hasLicenseMetadata) || remaining[0];
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
 * Fallback LA when CONTENT/PLAY and manifest omit laURL (typical for pipelineVersion 5 / 2026+ VOD).
 * - Older API: .../CONTENT/LA/{entitlement}/{groupId} (same pattern as PAGE requests).
 * - Pipeline 5+: community clients use .../CONTENT/LA/widevine?contentId=&channelId= (e.g. race-control-tv docs).
 *   The entitlement-only path often returns CloudFront HTML 403 on POST for new pipelines.
 * @param {number} [pipelineVersion] - from CONTENT/PLAY resultObj
 * @param {number} [contentId] - current asset
 * @param {number} [channelId] - optional multi-feed channel
 */
function getFallbackLicenseUrl(client, contentId, channelId, pipelineVersion) {
  if (!client) return '';
  const auth = client.ascendon ? 'R' : 'A';
  const userLoc = client.location?.userLocation?.[0];
  let entitlement = userLoc?.entitlement || F1TV_ENTITLEMENT;
  if (auth === 'R' && (entitlement === 'ANONYMOUS' || !entitlement)) {
    entitlement = F1TV_ENTITLEMENT;
  }
  const groupId = String(userLoc?.groupId ?? F1TV_GROUP);

  const pv = typeof pipelineVersion === 'number' ? pipelineVersion : parseInt(String(pipelineVersion), 10);
  const useWidevineLa = Number.isFinite(pv) && pv >= 5 && contentId != null && !Number.isNaN(Number(contentId));

  if (useWidevineLa) {
    const base = `${F1TV_BASE}/2.0/${auth}/${F1TV_LANG}/${F1TV_PLATFORM}/ALL/CONTENT/LA/widevine`;
    const u = new URL(base);
    u.searchParams.set('contentId', String(contentId));
    if (channelId != null && channelId !== '' && !Number.isNaN(Number(channelId))) {
      u.searchParams.set('channelId', String(channelId));
    }
    return u.toString();
  }

  return `${F1TV_BASE}/2.0/${auth}/${F1TV_LANG}/${F1TV_PLATFORM}/ALL/CONTENT/LA/${entitlement}/${groupId}`;
}

/**
 * Fetches an F1 TV page without authentication (public/archive content).
 * @param {string|number} pageId
 */
async function fetchPage(pageId) {
  const loginStatus = f1Client?.ascendon ? 'R' : 'A';
  const userLoc = f1Client?.location?.userLocation?.[0];
  const entitlement = userLoc?.entitlement || F1TV_ENTITLEMENT;
  const groupId = String(userLoc?.groupId || F1TV_GROUP);
  const url = `${F1TV_BASE}/2.0/${loginStatus}/${F1TV_LANG}/${F1TV_PLATFORM}/ALL/PAGE/${pageId}/${entitlement}/${groupId}`;
  const headers = { 'User-Agent': 'F1 OpenViewer/1.0' };
  if (f1Client?.entitlement) headers.entitlementtoken = f1Client.entitlement;
  if (f1Client?.ascendon) headers.ascendontoken = f1Client.ascendon;
  console.log('[fetchPage]', url, '| entitlement:', entitlement, '| groupId:', groupId, '| auth:', loginStatus);
  const res = await undiciFetch(url, { headers });
  if (!res.ok) throw new Error(`fetchPage ${pageId} → HTTP ${res.status}`);
  const json = await res.json();
  if (json.resultCode !== 'OK') {
    const msg = json.message && typeof json.message === 'string' ? json.message.trim() : `resultCode ${json.resultCode}`;
    throw new Error(msg);
  }
  return json.resultObj?.containers || [];
}

const F1_AUTH_URL = 'https://api.formula1.com/v2/account/subscriber/authenticate/by-password';
const F1_AUTH_ORIGIN = 'https://account.formula1.com';

/** @type {F1TVClient | null} */
let f1Client = null;
/** @type {string | null} */
let subscriptionToken = null;

const defaultHeaders = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
  'Content-Type': 'application/json',
  'Origin': F1_AUTH_ORIGIN,
  'Referer': F1_AUTH_ORIGIN + '/',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-site',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

/**
 * Login with email/password on F1 TV.
 * Tries body with Login/Password (Ascendon) and fallback email/password.
 * @returns {{ subscriptionToken: string }}
 */
async function login(email, password) {
  const bodies = [
    { Login: email, Password: password },
    { email, password },
  ];

  let lastError = null;
  for (const body of bodies) {
    try {
      const res = await axios.post(F1_AUTH_URL, body, {
        headers: defaultHeaders,
        timeout: 15000,
        validateStatus: () => true,
        maxRedirects: 0,
      });

      if (res.status === 403) {
        lastError = new Error(
          'HTTP 403: F1 server blocks direct login (Imperva protection). ' +
          'Use "Sign in with token" below: sign in at account.formula1.com in the browser, ' +
          'open DevTools (F12) → Network, sign in, find the "by-password" request, ' +
          'copy the Response and paste it in the Token field.'
        );
        continue;
      }
      if (res.status !== 200) {
        lastError = new Error(`Login failed: HTTP ${res.status}`);
        continue;
      }

      const data = res.data;
      let token = null;
      if (typeof data === 'string' && data.length > 100) {
        token = data;
      } else if (data && typeof data === 'object') {
        token = data.subscriptionToken ?? data.token ?? data.accessToken ?? data.access_token ?? data.resultObj?.subscriptionToken;
      }
      if (token) {
        subscriptionToken = token;
        return { subscriptionToken: token };
      }
      lastError = new Error('Login response missing token');
    } catch (e) {
      lastError = e?.response?.data ? new Error(String(e.response.data?.message || e.response.data)) : e;
    }
  }
  throw lastError || new Error('Login failed');
}

/**
 * Login using an already-obtained token (e.g. copied from by-password request in DevTools).
 * @param {string} tokenOrJson - JWT token or JSON response (with subscriptionToken/token)
 * @returns {{ subscriptionToken: string }}
 */
function loginWithToken(tokenOrJson) {
  const raw = typeof tokenOrJson === 'string' ? tokenOrJson.trim() : '';
  if (!raw) throw new Error('Empty token.');
  let token = raw;
  if (raw.startsWith('{')) {
    try {
      const obj = JSON.parse(raw);
      token = obj.subscriptionToken ?? obj.token ?? obj.accessToken ?? obj.access_token
        ?? obj.resultObj?.subscriptionToken ?? obj.data?.subscriptionToken ?? obj.data?.token ?? '';
    } catch (_) {
      throw new Error('Invalid token: not valid JSON.');
    }
  }
  token = typeof token === 'string' ? token.trim() : '';
  if (!token || token.length < 50) throw new Error('Invalid or too short token.');
  subscriptionToken = token;
  return { subscriptionToken: token };
}

/**
 * Initializes the F1 TV client with the token and waits for ready.
 * @param {string} token - subscription token (ascendon)
 * @param {number} readyTimeoutMs
 */
function initClient(token, readyTimeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    if (f1Client) {
      f1Client.ascendon = null;
      f1Client = null;
    }
    const client = new F1TVClient(token, F1TV.Language.ENGLISH, F1TV.Platform.WEB_DASH);
    f1Client = client;

    const t = setTimeout(() => {
      cleanup();
      reject(new Error('F1 TV initialization timeout'));
    }, readyTimeoutMs);

    function cleanup() {
      clearTimeout(t);
      client.removeAllListeners();
    }

    client.once('ready', async () => {
      cleanup();
      try {
        // After entitlement is updated, the initial location can stay ANONYMOUS.
        // Force a location refresh to get the real account entitlement/groupId.
        if (typeof client.refreshLocation === 'function') {
          await new Promise((r) => {
            let done = false;
            const finish = () => {
              if (done) return;
              done = true;
              client.removeListener('locationUpdated', onUpdated);
              client.removeListener('locationError', onError);
              clearTimeout(tt);
              r();
            };
            const onUpdated = () => finish();
            const onError = () => finish();
            const tt = setTimeout(finish, 2500);
            client.once('locationUpdated', onUpdated);
            client.once('locationError', onError);
            try {
              client.refreshLocation();
            } catch (_) {
              finish();
            }
          });
        }
      } catch (_) {}

      // ascendon is set asynchronously (JWT verification). We wait for ascendonUpdated.
      if (!client.ascendon) {
        await new Promise((res, rej) => {
          const t = setTimeout(() => {
            client.removeListener('ascendonUpdated', onOk);
            client.removeListener('ascendonError', onErr);
            rej(new Error('Token verification timeout (ascendon not received). Try signing in again.'));
          }, 10000);
          const onOk = () => {
            clearTimeout(t);
            client.removeListener('ascendonUpdated', onOk);
            client.removeListener('ascendonError', onErr);
            res();
          };
          const onErr = (err) => {
            clearTimeout(t);
            client.removeListener('ascendonUpdated', onOk);
            client.removeListener('ascendonError', onErr);
            rej(err);
          };
          client.once('ascendonUpdated', onOk);
          client.once('ascendonError', onErr);
        }).catch((err) => {
          f1Client = null;
          reject(err);
          return;
        });
      }
      if (!client.ascendon) return;

      // Entitlement può arrivare in ritardo dopo ascendon: aspettiamo.
      if (!client.entitlement) {
        await new Promise((r) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            client.removeListener('entitlementUpdated', onUpdated);
            client.removeListener('entitlementError', onError);
            clearTimeout(tt);
            r();
          };
          const onUpdated = () => finish();
          const onError = () => finish();
          const tt = setTimeout(finish, 6000);
          client.once('entitlementUpdated', onUpdated);
          client.once('entitlementError', onError);
        });
      }
      if (!client.entitlement) {
        f1Client = null;
        reject(new Error('Invalid session: entitlement not available (account not authenticated with API).'));
        return;
      }

      console.log('[F1TV] Client ready. ascendon:', !!client.ascendon, '| entitlement:', !!client.entitlement, '| location:', !!client.location);
      if (client.location) {
        const loc = client.location.userLocation?.[0];
        console.log('[F1TV] UserLocation:', JSON.stringify({ entitlement: loc?.entitlement, groupId: loc?.groupId, country: loc?.registeredCountryIsoCode }));
      }
      resolve();
    });
    client.once('ascendonError', (err) => {
      cleanup();
      console.error('[F1TV] ascendonError:', err?.message);
      f1Client = null;
      reject(err);
    });
    client.once('configError', (err) => {
      cleanup();
      console.error('[F1TV] configError:', err?.message);
      reject(err);
    });
    client.once('locationError', (err) => {
      cleanup();
      console.error('[F1TV] locationError:', err?.message);
      reject(err);
    });
  });
}

function getClient() {
  if (!f1Client || !f1Client.isReady) throw new Error('F1 TV client not ready');
  return f1Client;
}

async function getLiveNow() {
  try {
    const client = getClient();
    const result = await client.liveNow();
    const items = (result?.resultObj?.items || []).map((item) => {
    const contentId = item.metadata?.contentId;
    if (!contentId) return null;
    return {
      id: String(item.id || contentId),
      title: item.metadata?.title || item.metadata?.emfAttributes?.Global_Title || 'Live',
      kind: 'live',
      contentId: Number(contentId),
      meetingKey: item.metadata?.emfAttributes?.MeetingKey,
      sessionKey: item.metadata?.emfAttributes?.SessionKey,
    };
  }).filter(Boolean);
    return items;
  } catch (e) {
    return [];
  }
}

async function searchVod(params = {}) {
  try {
    const client = getClient();
    const result = await client.searchVod(params);
    const containers = result?.resultObj?.containers || [];
    const items = containers.map((c) => {
    const contentId = c.metadata?.contentId ?? c.id;
    if (contentId == null) return null;
    return {
      id: String(c.id ?? contentId),
      title: c.metadata?.title || c.uiMetadata?.mainTitle || 'VOD',
      kind: 'replay',
      season: c.metadata?.season != null ? String(c.metadata.season) : undefined,
      contentId: Number(contentId),
    };
  }).filter(Boolean);
    return items;
  } catch (e) {
    return [];
  }
}

/**
 * F1 TV archive page ID and mapping year → season pageId.
 * Obtained by exploring https://f1tv.formula1.com/2.0/A/ENG/WEB_DASH/ALL/PAGE/493/F1_TV_Pro_Annual/2
 */
const ARCHIVE_PAGE_ID = 493;
const LEGACY_SEASON_PAGE_TO_YEAR = {
  12343: 2026,
  10295: 2025,
  8192: 2024,
  6603: 2023,
  4319: 2022,
  1510: 2021,
  392: 2020,
  2128: 2019,
  2130: 2018,
};

async function inferSeasonYearFromPage(pageId) {
  try {
    const containers = await fetchPage(pageId);
    const years = [];
    for (const c of containers) {
      const subs = c.retrieveItems?.resultObj?.containers || [];
      for (const s of subs) {
        const text = `${s.title || ''} ${s.metadata?.title || ''} ${s.metadata?.plainText || ''}`;
        const m = text.match(/\b(20\d{2}|19\d{2})\b/);
        if (m) years.push(Number(m[1]));
      }
    }
    if (!years.length) return null;
    const counts = new Map();
    for (const y of years) counts.set(y, (counts.get(y) || 0) + 1);
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  } catch (_) {
    return null;
  }
}

function mapSubtypeToSessionType(subtype, videoType) {
  const s = String(subtype || videoType || '').toLowerCase();
  if (s === 'live') return 'other';
  if (s.includes('sprint') && s.includes('race')) return 'sprint';
  if (s.includes('sprint')) return 'sprint';
  if ((s.includes('race') || s === 'replay') && !s.includes('qualifying') && !s.includes('practice')) return 'race';
  if (s.includes('qualifying') || s === 'q') return 'qualifying';
  if (s.includes('practice') || s.includes('fp')) return 'practice';
  if (s.includes('onboard') || s === 'obc') return 'onboard';
  if (s.includes('highlight')) return 'other';
  return 'other';
}

/**
 * Extracts all GP containers from a season page.
 * Each GP container has an action with pageId for the GP page.
 */
function extractEventsFromSeasonPage(containers) {
  const events = [];
  const nowMs = Date.now();
  for (const c of containers) {
    const subs = c.retrieveItems?.resultObj?.containers || [];
    for (const s of subs) {
      const action = s.actions?.find(a => a.key === 'onClick');
      if (!action?.uri) continue;
      const meta = s.metadata || {};
      const emf = meta.emfAttributes || {};
      const props = (s.properties && s.properties[0]) || {};
      const title = s.title || meta.title || '';
      // Filter only F1 GP/meetings (exclude F2, F3, etc.)
      const isF1GP = (
        String(title).toUpperCase().includes('GRAND PRIX') ||
        String(title).toUpperCase().includes('FORMULA 1') ||
        emf.VideoType === 'meetings' ||
        meta.contentSubtype === 'MEETING'
      ) && !String(title).toUpperCase().includes(' F2 ') && !String(title).toUpperCase().includes(' F3 ');
      if (!isF1GP) continue;
      // Do not show future events (e.g. races not yet run in the current season).
      const meetingStartMs = Number(props.meeting_Start_Date || props.meeting_start_date || 0);
      if (Number.isFinite(meetingStartMs) && meetingStartMs > 0 && meetingStartMs > nowMs) {
        continue;
      }
      // Extract pageId from URI: /2.0/A/ENG/WEB_DASH/ALL/PAGE/{pageId}/...
      const pageIdMatch = action.uri.match(/\/PAGE\/(\d+)\//);
      if (!pageIdMatch) continue;
      events.push({
        pageId: Number(pageIdMatch[1]),
        meetingName: String(title).trim(),
        contentId: meta.contentId,
        meetingNumber: Number(props.meeting_Number || emf.Meeting_Number || 0),
      });
    }
  }
  return events;
}

/**
 * Extracts the sessions from a GP page.
 * Returns { sessions, onboard } where sessions are FP/Q/Race/Sprint and onboard are OBC channels.
 */
function extractSessionsFromGPPage(containers) {
  const sessions = [];
  const onboard = [];
  for (const c of containers) {
    const containerTitle = String(c.title || '').toLowerCase();
    // Salta F2/F3/Porsche/W-Series/ecc.
    if (/formula [23]|porsche|w series|f[23]:/i.test(containerTitle)) continue;
    const subs = c.retrieveItems?.resultObj?.containers || [];
    for (const s of subs) {
      const meta = s.metadata || {};
      const emf = meta.emfAttributes || {};
      const contentId = meta.contentId;
      if (!contentId) continue;
      const title = s.title || meta.title || '';
      const subtype = meta.contentSubtype || '';
      const videoType = emf.VideoType || '';
      // Skip F2/F3 content
      if (/\bF[23]\b/.test(title)) continue;
      const type = mapSubtypeToSessionType(subtype, videoType);
      // Sessioni principali: solo REPLAY di meetingSession (FP, Q, Race, Sprint)
      if (videoType === 'meetingSession' && subtype === 'REPLAY') {
        sessions.push({ contentId, title: String(title).trim(), type });
      }
    }
  }
  return { sessions, onboard };
}

/**
 * Returns the list of seasons available in the F1 TV archive.
 * Each season has: { year, pageId }
 */
async function getVodSeasons() {
  console.log('[VOD] getVodSeasons: caricamento archivio pagina', ARCHIVE_PAGE_ID);
  const archiveContainers = await fetchPage(ARCHIVE_PAGE_ID);
  const seasonItems = archiveContainers.flatMap((c) => c.retrieveItems?.resultObj?.containers || []);
  if (!seasonItems.length) throw new Error('No season items found on archive page.');
  const seasonsMap = new Map();
  const unresolved = [];
  for (const s of seasonItems) {
    const action = s.actions?.find(a => a.key === 'onClick');
    if (!action?.uri) continue;
    const pageIdMatch = action.uri.match(/\/PAGE\/(\d+)\//);
    if (!pageIdMatch) continue;
    const pageId = Number(pageIdMatch[1]);
    const yearMatch = `${action.href || ''} ${action.uri || ''} ${s.title || ''} ${s.metadata?.title || ''} ${s.metadata?.plainText || ''}`.match(/(20\d{2}|19\d{2})/);
    const year = yearMatch ? Number(yearMatch[1]) : (LEGACY_SEASON_PAGE_TO_YEAR[pageId] || 0);
    if (year >= 2018 && year <= new Date().getFullYear()) {
      seasonsMap.set(year, { year, pageId });
    } else {
      // Avoid probing non-season pages (e.g. full-race-replays-and-highlights)
      const href = String(action.href || '').toLowerCase();
      if (href.includes('season')) unresolved.push(pageId);
    }
  }
  // Dynamic fallback: deduce year directly from the season page (covers new seasons, e.g. 2026).
  for (const pageId of unresolved) {
    const inferredYear = await inferSeasonYearFromPage(pageId);
    if (!inferredYear) continue;
    if (inferredYear < 2018 || inferredYear > new Date().getFullYear()) continue;
    if (!seasonsMap.has(inferredYear)) {
      seasonsMap.set(inferredYear, { year: inferredYear, pageId });
      console.log(`[VOD] anno dedotto dinamicamente: ${inferredYear} (page:${pageId})`);
    }
  }
  // Explicit fallback: some recent seasons do not always appear in PAGE/493.
  for (const [pageIdStr, y] of Object.entries(LEGACY_SEASON_PAGE_TO_YEAR)) {
    const pageId = Number(pageIdStr);
    if (y >= 2018 && y <= new Date().getFullYear() && !seasonsMap.has(y)) {
      seasonsMap.set(y, { year: y, pageId });
    }
  }
  const seasons = Array.from(seasonsMap.values()).sort((a, b) => b.year - a.year);
  console.log('[VOD] Stagioni disponibili:', seasons.map(s => `${s.year}(page:${s.pageId})`).join(', '));
  return seasons;
}

/**
 * Returns the list of GPs for a season given the season pageId.
 * Each GP has: { pageId, meetingName, meetingNumber }
 */
async function getVodEvents(seasonPageId) {
  console.log('[VOD] getVodEvents: caricamento stagione pagina', seasonPageId);
  const containers = await fetchPage(seasonPageId);
  const gpItems = extractEventsFromSeasonPage(containers);
  console.log('[VOD] GP trovati (solo disputati):', gpItems.length);
  return gpItems.map((gp, i) => ({
    meetingKey: String(gp.pageId),
    meetingName: gp.meetingName,
    meetingNumber: gp.meetingNumber || (i + 1),
    pageId: gp.pageId,
  }));
}

/**
 * Returns the sessions (FP, Q, Race, Sprint) of a GP given the GP pageId.
 */
async function getVodSessions(gpPageId) {
  console.log('[VOD] getVodSessions: caricamento GP pagina', gpPageId);
  const containers = await fetchPage(gpPageId);
  const { sessions } = extractSessionsFromGPPage(containers);
  console.log('[VOD] Sessioni trovate:', sessions.length);
  return sessions;
}

/**
 * Full VOD catalog (legacy, loads everything at once).
 * Prefer getVodSeasons + getVodEvents + getVodSessions for lazy loading.
 */
async function getVodCatalog() {
  const result = { seasons: [] };
  try {
    const seasons = await getVodSeasons();
    for (const { year, pageId } of seasons) {
      const events = await getVodEvents(pageId).catch(e => {
        console.warn(`[VOD] Stagione ${year} errore:`, e.message);
        return [];
      });
      if (!events.length) continue;
      result.seasons.push({ year, events: events.map(ev => ({ ...ev, sessions: [], onboard: [] })) });
    }
    console.log('[VOD] Catalogo (solo stagioni+GP):', result.seasons.map(s => `${s.year}(${s.events.length}GP)`).join(', '));
  } catch (e) {
    console.error('[VOD] Errore fatale getVodCatalog:', e?.message, e?.stack);
  }
  return result;
}

/**
 * Content details for additional streams (onboard).
 */
async function getContentVideo(contentId) {
  try {
    const client = getClient();
    const container = await client.contentVideo(contentId);
    const meta = container?.metadata || {};
    const additional = meta.additionalStreams || [];
    const onboard = [];
    const dataChannel = [];
    for (const s of additional) {
      if (!s.channelId) continue;
      const base = {
        contentId: meta.contentId || contentId,
        channelId: s.channelId,
        title: s.title || s.reportingName || '',
      };
      if (s.type === 'obc' || s.identifier === 'OBC' || String(s.type || '').toLowerCase().includes('onboard')) {
        onboard.push({
          ...base,
          title: base.title || `Onboard ${s.racingNumber || ''}`,
          driverName: s.driverFirstName || s.driverLastName ? [s.driverFirstName, s.driverLastName].filter(Boolean).join(' ') : undefined,
          teamName: s.teamName,
          racingNumber: s.racingNumber,
        });
      } else if (s.identifier === 'DATA' || String(s.type || '').toLowerCase().includes('data')) {
        dataChannel.push({
          ...base,
          title: base.title || 'Data channel',
        });
      }
    }
    return { onboard, dataChannel, container };
  } catch (e) {
    return { onboard: [], dataChannel: [], container: null };
  }
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
  const client = getClient();
  if (!client.entitlement) {
    throw new Error('Session not ready: entitlement missing. Sign out and sign in again with "Sign in with browser", then retry.');
  }
  const contentIdNum = typeof contentId === 'string' ? parseInt(contentId, 10) : contentId;
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
    platformOrder.map((p) => client.contentPlay(contentIdNum, channelId, p))
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
  const primary = pickPrimaryPlaybackCandidate(candidates);
  const fallback = pickFallbackPlaybackCandidate(candidates, primary);
  if (!primary?.url) throw new Error('F1 TV returned no valid stream URL (DASH/HLS).');

  let licenseUrl = primary.laURL || primary.laUrl || '';
  if (!licenseUrl && !primary.drmToken) {
    try {
      console.warn('[playback] WARNING: no laURL/drmToken from CONTENT/PLAY for primary:', primary.platform);
      console.warn('[playback] primary fields:', Object.keys(primary).sort().join(','));
      console.warn('[playback] primary (scrubbed):', JSON.stringify(scrubPlaybackObj(primary)));
    } catch (_) {}
  }

  // Decode the per-play entitlementToken JWT — the payload may contain a laURL or kid
  // that reveals where the 2026 license server is.
  try {
    const jwt = primary.entitlementToken;
    if (jwt && jwt.includes('.')) {
      const parts = jwt.split('.');
      const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString('utf8'));
      console.log('[playback] entitlementToken JWT payload:', JSON.stringify(payload));
    }
  } catch (_) {}

  // Decode the pa_ CloudFront signed URL payload to get both the playToken and the numeric kid.
  // For pipelineVersion 5 (2026+), the API no longer returns laURL; the kid from the pa_
  // payload is used to construct the license URL: CONTENT/LA/{kid}.
  const paPayload = decodePaPayload(primary.url);
  const urlPlayToken = paPayload?.token ?? null;

  // Also fetch manifest to extract the license URL if not returned by the API.
  const { playToken: manifestPlayToken, licenseUrl: manifestLicenseUrl } = await fetchManifestData(primary.url, client, urlPlayToken);
  if (!licenseUrl && manifestLicenseUrl) licenseUrl = manifestLicenseUrl;

  const playToken = urlPlayToken || manifestPlayToken || null;

  if (!licenseUrl) {
    // Even when CONTENT/PLAY does not return laURL/drmToken (observed on pipelineVersion 5 / 2026+),
    // the DASH manifests still carry Widevine PSSH and segments are CENC-encrypted.
    // Shaka requires an explicit license server URI, so we must provide a fallback LA endpoint.
    licenseUrl = getFallbackLicenseUrl(client, contentIdNum, channelId, primary.pipelineVersion);
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
    console.warn('[playback] playToken not found in manifest URL – license may fail');
  }

  // primary.entitlementToken is the per-play entitlement from the contentPlay API response.
  // It may differ from client.entitlement (the user-level token). F1 TV license server
  // expects the per-play token, so prefer it over the general one.
  const licenseEntitlementToken = primary.entitlementToken || client.entitlement || undefined;
  console.log('[playback] entitlementToken: play-specific=', !!primary.entitlementToken, '| client=', !!client.entitlement, '| same=', primary.entitlementToken === client.entitlement);

  /** Numeric CloudFront key group from pa_ URL (not the Widevine KID). Used for LA discovery in main. */
  const paCfKeyGroup = paPayload?.kid != null && String(paPayload.kid).trim() !== '' ? String(paPayload.kid).trim() : undefined;

  return {
    manifestUrl: primary.url,
    licenseUrl,
    drmToken: primary.drmToken,
    playToken: playToken || undefined,
    licenseAscendonToken: client.ascendon || undefined,
    licenseEntitlementToken,
    streamType: primary.streamType || 'UNKNOWN',
    pipelineVersion: primary.pipelineVersion,
    paCfKeyGroup,
    contentId: contentIdNum,
    channelId: channelId != null && channelId !== undefined && !Number.isNaN(Number(channelId)) ? Number(channelId) : undefined,
    fallbackManifestUrl: fallback?.url || undefined,
    fallbackLicenseUrl: fallback?.laURL || fallback?.laUrl || '',
    fallbackDrmToken: fallback?.drmToken || undefined,
    fallbackStreamType: fallback?.streamType || undefined,
  };
}


function getSubscriptionToken() {
  return subscriptionToken;
}

/** Headers to inject on every request to the F1 license server (used by main via webRequest). */
function getLicenseRequestHeaders() {
  try {
    const client = getClient();
    const out = {
      Origin: 'https://f1tv.formula1.com',
      Referer: 'https://f1tv.formula1.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    };
    if (client.ascendon) {
      out.ascendontoken = client.ascendon;
    }
    if (client.entitlement) out.entitlementtoken = client.entitlement;
    return (out.ascendontoken || out.entitlementtoken) ? out : null;
  } catch (_) {
    return null;
  }
}

function clearSession() {
  subscriptionToken = null;
  if (f1Client) {
    f1Client.ascendon = null;
    f1Client = null;
  }
}

module.exports = {
  login,
  loginWithToken,
  initClient,
  getLiveNow,
  searchVod,
  getVodCatalog,
  getVodSeasons,
  getVodEvents,
  getVodSessions,
  getContentVideo,
  contentPlay,
  getSubscriptionToken,
  getLicenseRequestHeaders,
  clearSession,
  get isClientReady() {
    return !!f1Client && f1Client.isReady;
  },
};
