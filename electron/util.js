/** Small stateless helpers shared across the main-process modules. */

/** Truncates a secret for logging: keeps a short prefix/suffix + length, never the full value. */
function redact(value) {
  if (value == null) return '';
  const s = String(value);
  if (!s) return '';
  if (s.length <= 16) return `${s.slice(0, 4)}…(len:${s.length})`;
  return `${s.slice(0, 8)}…${s.slice(-4)}(len:${s.length})`;
}

/**
 * URL safe to log: origin + a short path, without query/fragment. F1's signed CDN manifest URLs
 * embed the play token (a `/pa_<base64>` segment and signature params), which must not end up in
 * logs users paste into bug reports.
 */
function redactUrl(urlString) {
  try {
    const u = new URL(urlString);
    const path = u.pathname
      .split('/')
      .map((seg) => (seg.length > 24 ? `${seg.slice(0, 8)}…` : seg))
      .join('/');
    return `${u.origin}${path.length > 80 ? path.slice(0, 80) + '…' : path}`;
  } catch (_) {
    return '(invalid url)';
  }
}

/**
 * True for failures that say nothing about the account (offline, DNS, reset, timeout, a proxy/VPN
 * hiccup). Those must never make the app forget a saved session: only real auth failures should.
 */
function errorText(err) {
  const parts = [err && err.message, err && err.code, err && err.cause && err.cause.code, err && err.cause && err.cause.message];
  return parts.filter(Boolean).join(' ');
}

function isTransientNetworkError(err) {
  const text = errorText(err);
  // An HTTP answer settles it: 4xx is the server rejecting us (never "transient", whatever words the
  // response body contains), 5xx is the server being unwell.
  if (/\bHTTP 4\d\d\b/.test(text)) return false;
  if (/\bHTTP 5\d\d\b/.test(text)) return true;
  return /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|EPIPE|UND_ERR_|socket hang up|network|timed? ?out|timeout/i.test(text);
}

/**
 * Narrower than isTransientNetworkError: the request could not reach anyone at all. Only then is a
 * silent refresh (hidden login window) pointless. App-level timeouts ("initialization timeout") are
 * transient but not offline: the refresh is still worth trying.
 */
function isOfflineError(err) {
  const text = errorText(err);
  if (/\bHTTP \d{3}\b/.test(text)) return false;
  return /fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|UND_ERR_CONNECT|socket hang up|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED/i.test(text);
}

/**
 * Resolves with `promise`, or with `fallback` after `ms` (never rejects because of the timer).
 * Used for startup steps that must not be able to block the app forever (e.g. the CDM download).
 */
function withTimeout(promise, ms, fallback) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Positive integer from an IPC argument (number or numeric string), or throws. */
function toPositiveInt(value, name = 'value') {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`Invalid ${name}`);
  return n;
}

/**
 * What the renderer may see of a CONTENT/PLAY result. The account-level tokens (ascendon, the
 * entitlement JWT, the CDN playToken) never leave the main process: the license proxy and the
 * webRequest hook attach them. The per-play drmToken is only passed on when the license request
 * does NOT go through the proxy (the proxy already holds it).
 */
function rendererPlayback(result, proxied) {
  if (!result || typeof result !== 'object') return result;
  const { licenseAscendonToken: _a, licenseEntitlementToken: _e, playToken: _p, drmToken, ...rest } = result;
  return proxied || !drmToken ? rest : { ...rest, drmToken };
}

/** Decodes a JWT's payload (no signature check, we don't hold the key). Null if malformed. */
function parseJwtPayload(jwt) {
  if (!jwt || typeof jwt !== 'string' || !jwt.includes('.')) return null;
  try {
    const parts = jwt.split('.');
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(b64 + '='.repeat((4 - (b64.length % 4)) % 4), 'base64').toString('utf8');
    return JSON.parse(json);
  } catch (_) {
    return null;
  }
}

/** True for formula1.com itself or any of its subdomains (checks the actual hostname, not a substring match). */
function isFormula1Hostname(hostname) {
  return hostname === 'formula1.com' || hostname.endsWith('.formula1.com');
}

/** Same check, but takes a full URL string and parses it first. */
function hasFormula1Host(urlString) {
  try {
    return isFormula1Hostname(new URL(urlString).hostname);
  } catch {
    return false;
  }
}

/**
 * True for an F1 Widevine license-acquisition request: a formula1.com host whose PATH has an `LA`
 * segment (…/CONTENT/LA/widevine, …/CONTENT/LA/{entitlement}/{group}). Only the path is checked:
 * the account tokens are attached to these requests, so a `/LA` in a query string (which any page
 * loaded in the default session, e.g. the login page, could produce) must not qualify.
 */
function isF1LicenseUrl(urlString) {
  try {
    const u = new URL(urlString);
    return u.protocol === 'https:' && isFormula1Hostname(u.hostname) && /(^|\/)LA(\/|$)/.test(u.pathname);
  } catch {
    return false;
  }
}

const SEARCH_PARAM_KEYS = new Set(['maxResults', 'orderBy', 'sortOrder', 'page']);
/** Keeps only allowlisted searchVod keys (plus `filter_*`) with short [A-Za-z0-9_.,:-] values. */
function sanitizeSearchParams(params) {
  const out = {};
  if (!params || typeof params !== 'object') return out;
  for (const [k, v] of Object.entries(params)) {
    if (!(SEARCH_PARAM_KEYS.has(k) || /^filter_[A-Za-z]{1,40}$/.test(k))) continue;
    const s = String(v);
    if (s.length <= 64 && /^[A-Za-z0-9_.,:-]*$/.test(s)) out[k] = s;
  }
  return out;
}

/** The update banner only ever links to this project's GitHub pages. */
function isAllowedExternalUrl(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:' && u.hostname === 'github.com' && /^\/npanu420\/F1OpenViewer(\/|$)/i.test(u.pathname);
  } catch (_) {
    return false;
  }
}

module.exports = { sanitizeSearchParams, isAllowedExternalUrl, redact, redactUrl, isTransientNetworkError, isOfflineError, withTimeout, toPositiveInt, rendererPlayback, parseJwtPayload, isFormula1Hostname, hasFormula1Host, isF1LicenseUrl };
