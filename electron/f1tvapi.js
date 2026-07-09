/**
 * Small F1TV client for this app. RS256 JWT check against F1 JWKS, plus the handful of
 * endpoints we call (location, entitlement, contentPlay, liveNow, searchVod, etc.).
 * Uses crypto/events + undici only.
 *
 * Drops @exhumer/f1tv-api (AGPL) in favour of MIT here.
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');
const { fetch: undiciFetch } = require('undici');

const BASE_URL = 'https://f1tv.formula1.com';
const JWKS_URL = 'https://api.formula1.com/static/jwks.json';
const USER_AGENT = 'f1tv-api-lite/1.0 (+https://github.com/npanu420/F1OpenViewer)';

const Platform = {
  BIG_SCREEN_DASH: 'BIG_SCREEN_DASH',
  BIG_SCREEN_HLS: 'BIG_SCREEN_HLS',
  MOBILE_DASH: 'MOBILE_DASH',
  MOBILE_HLS: 'MOBILE_HLS',
  TABLET_DASH: 'TABLET_DASH',
  TABLET_HLS: 'TABLET_HLS',
  WEB_DASH: 'WEB_DASH',
  WEB_HLS: 'WEB_HLS',
};

const Language = {
  ENGLISH: 'ENG',
  DUTCH: 'NLD',
  PORTUGUESE: 'POR',
  SPANISH: 'SPA',
  GERMAN: 'DEU',
  FRENCH: 'FRA',
};

// ----- RS256 JWT verification against F1's JWKS -----

function base64UrlDecode(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** kid -> KeyObject. Refresh hourly, or right away if F1 rotated keys and kid is new. */
let jwksCache = null;
const JWKS_TTL_MS = 60 * 60 * 1000;

async function getSigningKey(kid) {
  const stale = !jwksCache || Date.now() - jwksCache.fetchedAt > JWKS_TTL_MS;
  if (stale || !jwksCache.keys.has(kid)) {
    const res = await undiciFetch(JWKS_URL, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`JWKS fetch failed: HTTP ${res.status}`);
    const body = await res.json();
    const keys = new Map();
    for (const jwk of body?.keys || []) {
      if (jwk?.kid) keys.set(jwk.kid, jwk);
    }
    jwksCache = { keys, fetchedAt: Date.now() };
  }
  const jwk = jwksCache.keys.get(kid);
  if (!jwk) throw new Error(`No signing key found for kid ${kid}`);
  return crypto.createPublicKey({ key: jwk, format: 'jwk' });
}

/** Verify subscription token (RS256) with F1 JWKS. Throws if junk, bad sig, or expired. */
async function verifySubscriptionToken(token) {
  if (typeof token !== 'string' || !token) {
    throw new Error('subscriptionToken provided is not a valid JWT token!');
  }
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('subscriptionToken provided is not a valid JWT token!');
  const [headerB64, payloadB64, sigB64] = parts;

  let header, payload;
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString('utf8'));
    payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'));
  } catch (_) {
    throw new Error('subscriptionToken provided is not a valid JWT token!');
  }
  if (!header.kid) throw new Error('KID not available in subscriptionToken header!');
  if (header.alg && header.alg !== 'RS256') throw new Error(`Unsupported JWT algorithm: ${header.alg}`);

  const publicKey = await getSigningKey(header.kid);
  const ok = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${headerB64}.${payloadB64}`),
    publicKey,
    base64UrlDecode(sigB64)
  );
  if (!ok) throw new Error('invalid signature!');

  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && nowSec >= payload.exp) throw new Error('jwt expired');
  if (typeof payload.nbf === 'number' && nowSec < payload.nbf) throw new Error('jwt not active');

  return payload;
}

// ----- client -----

class F1TVClient extends EventEmitter {
  constructor(ascendon = null, language = Language.ENGLISH, platform = Platform.WEB_DASH) {
    super();
    this._ascendon = null;
    this._entitlement = null;
    this._config = null;
    this._location = null;
    this.language = language;
    this.platform = platform;

    this.once('locationUpdated', () => {
      this.once('configUpdated', () => this.emit('ready'));
      this.refreshConfig();
    });

    this.ascendon = ascendon;
    this.refreshLocation();
  }

  get ascendon() {
    return this._ascendon;
  }

  set ascendon(token) {
    this._ascendon = null;
    this._entitlement = null;
    if (!token) {
      this.emit('ascendonUpdated');
      return;
    }
    verifySubscriptionToken(token)
      .then(() => {
        this._ascendon = token;
        this.refreshEntitlement();
        this.emit('ascendonUpdated');
      })
      .catch((err) => this.emit('ascendonError', err));
  }

  get entitlement() {
    return this._entitlement;
  }

  get location() {
    return this._location;
  }

  get config() {
    return this._config;
  }

  get isReady() {
    return this._config !== null && this._location !== null;
  }

  loginStatus() {
    return this._ascendon === null ? 'A' : 'R';
  }

  async _requestJson(url, headers) {
    const res = await undiciFetch(url, { headers: { 'User-Agent': USER_AGENT, ...headers } });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${body}`);
    }
    return res.json();
  }

  refreshLocation() {
    const url = [BASE_URL, '1.0', this.loginStatus(), this.language, this.platform, 'ALL/USER/LOCATION'].join('/');
    this._requestJson(url, this._entitlement ? { entitlementtoken: this._entitlement } : undefined)
      .then((json) => {
        this._location = json.resultObj;
        this.emit('locationUpdated');
      })
      .catch((err) => this.emit('locationError', err));
  }

  refreshEntitlement() {
    if (!this._ascendon) throw new Error('ascendon token is not set');
    const url = [BASE_URL, '2.0', this.loginStatus(), this.language, this.platform, 'ALL/USER/ENTITLEMENT'].join('/');
    this._requestJson(url, { ascendontoken: this._ascendon })
      .then((json) => {
        this._entitlement = json.resultObj.entitlementToken;
        this.emit('entitlementUpdated');
      })
      .catch((err) => this.emit('entitlementError', err));
  }

  refreshConfig() {
    this._requestJson(`${BASE_URL}/config`)
      .then((json) => {
        this._config = json;
        this.emit('configUpdated');
      })
      .catch((err) => this.emit('configError', err));
  }

  async liveNow() {
    if (!this._location?.userLocation?.length) throw new Error('location is not set');
    const loc = this._location.userLocation[0];
    const url = [
      BASE_URL, '1.0', this.loginStatus(), this.language, this.platform,
      'ALL/EVENTS/LIVENOW', loc.entitlement, String(loc.groupId),
    ].join('/');
    return this._requestJson(url);
  }

  async searchVod(params) {
    if (!this._location?.userLocation?.length) throw new Error('location is not set');
    const loc = this._location.userLocation[0];
    let url = [
      BASE_URL, '2.0', this.loginStatus(), this.language, this.platform,
      'ALL/PAGE/SEARCH/VOD', loc.entitlement, String(loc.groupId),
    ].join('/');
    if (params) url += '?' + new URLSearchParams(params).toString();
    return this._requestJson(url);
  }

  async contentVideo(contentId) {
    if (!this._location?.userLocation?.length) throw new Error('location is not set');
    if (!this._entitlement) console.warn('[f1tvapi] entitlement token is not set');
    const loc = this._location.userLocation[0];
    const url = [
      BASE_URL, '4.0', this.loginStatus(), this.language, this.platform,
      'ALL/CONTENT/VIDEO', String(contentId), loc.entitlement, String(loc.groupId),
    ].join('/');
    const json = await this._requestJson(url, this._entitlement ? { entitlementtoken: this._entitlement } : undefined);
    const containers = json.resultObj?.containers || [];
    if (!containers.length) throw new Error('No containers found');
    return containers[0];
  }

  async contentPlay(contentId, channelId, platform) {
    if (!this._ascendon || !this._entitlement) {
      throw new Error('ascendon token or entitlement token is not set, unable to play content');
    }
    const params = { contentId: String(contentId) };
    if (channelId) params.channelId = String(channelId);
    const url = [BASE_URL, '2.0', this.loginStatus(), this.language, platform || this.platform, 'ALL/CONTENT/PLAY'].join('/')
      + '?' + new URLSearchParams(params).toString();
    return this._requestJson(url, { ascendontoken: this._ascendon, entitlementtoken: this._entitlement });
  }
}

module.exports = {
  F1TVClient,
  F1TV: { Platform, Language },
  verifySubscriptionToken,
};
