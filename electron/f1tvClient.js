/**
 * F1 TV client lifecycle: login, the @exhumer/f1tv-api client instance, and the per-play
 * entitlement override used for license requests. Owns the module-level auth state that the
 * catalog and playback modules read through getClient()/fetchPage().
 */

const axios = require('axios');
const { fetch: undiciFetch } = require('undici');
const { F1TVClient, F1TV } = require('@exhumer/f1tv-api');

const F1TV_BASE = 'https://f1tv.formula1.com';
const F1TV_PLATFORM = 'WEB_DASH';
const F1TV_LANG = 'ENG';
const F1TV_ENTITLEMENT = 'F1_TV_Pro_Annual';
const F1TV_GROUP = '2';

/** Per-play entitlement JWT from last CONTENT/PLAY; CDN + LA should match this when API returns it. */
let playbackEntitlementOverride = null;

function setPlaybackEntitlementOverride(token) {
  playbackEntitlementOverride =
    token && typeof token === 'string' && token.trim() ? token.trim() : null;
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
    const ent = playbackEntitlementOverride || client.entitlement;
    if (ent) out.entitlementtoken = ent;
    return (out.ascendontoken || out.entitlementtoken) ? out : null;
  } catch (_) {
    return null;
  }
}

function clearSession() {
  playbackEntitlementOverride = null;
  subscriptionToken = null;
  if (f1Client) {
    f1Client.ascendon = null;
    f1Client = null;
  }
}

module.exports = {
  F1TV_BASE,
  F1TV_PLATFORM,
  F1TV_LANG,
  F1TV_ENTITLEMENT,
  F1TV_GROUP,
  login,
  loginWithToken,
  initClient,
  getClient,
  fetchPage,
  getSubscriptionToken,
  getLicenseRequestHeaders,
  setPlaybackEntitlementOverride,
  clearSession,
  get isClientReady() {
    return !!f1Client && f1Client.isReady;
  },
  get ascendonToken() {
    return f1Client?.ascendon || null;
  },
};
