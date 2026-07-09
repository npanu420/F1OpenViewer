/**
 * F1 TV session lifecycle: the in-memory + on-disk access token, persisted cookies, durable
 * renderer settings, and silent (no-UI) token refresh. Owns everything under app.getPath('userData').
 */

const path = require('path');
const fs = require('fs');
const { app, session, BrowserWindow } = require('electron');
const f1tv = require('./f1tv-bridge');
const { parseJwtPayload } = require('./util');

/** Mutated in place; other modules read `memSession.accessToken` off this same object. */
const memSession = { accessToken: undefined };

const F1_LOGIN_URL = 'https://account.formula1.com/';
const FORMULA1_URLS = ['https://formula1.com', 'https://account.formula1.com', 'https://f1tv.formula1.com'];

function getSessionFilePath() {
  return path.join(app.getPath('userData'), 'f1openviewer-session.json');
}

function getCookiesFilePath() {
  return path.join(app.getPath('userData'), 'f1openviewer-cookies.json');
}

function getSettingsFilePath() {
  return path.join(app.getPath('userData'), 'f1openviewer-settings.json');
}

// Renderer settings worth surviving a manual reinstall to a new folder. localStorage is
// scoped to the file:// origin, which for a packaged app is tied to its install path, so a
// "delete old folder, unzip new one elsewhere" update would otherwise silently reset these.
// Session/cookies already live here in userData; this just extends the same durability to
// the renderer-side settings that matter (layouts, sync prefs, theme, locale).
const DURABLE_SETTINGS_KEYS = new Set([
  'f1openviewer-locale',
  'f1-theme',
  'f1-dismissed-update-version',
  'f1openviewer-saved-grids',
  'f1openviewer-sync-offset-threshold',
  'f1openviewer-sync-done-delay-ms',
  'f1openviewer-sync-keep-locked',
  'f1openviewer-sync-reference-mode',
]);

function loadPersistedSettings() {
  try {
    const p = getSettingsFilePath();
    if (!fs.existsSync(p)) return {};
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function persistSettingsKey(key, value) {
  if (!DURABLE_SETTINGS_KEYS.has(key)) return;
  try {
    const all = loadPersistedSettings();
    all[key] = value;
    fs.writeFileSync(getSettingsFilePath(), JSON.stringify(all));
  } catch (e) {
    console.warn('[settings] persist failed:', e?.message);
  }
}

function loadPersistedSession() {
  try {
    const p = getSessionFilePath();
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf-8');
    const obj = JSON.parse(raw);
    if (obj && typeof obj.accessToken === 'string' && obj.accessToken.length > 50) {
      return obj.accessToken;
    }
  } catch (_) {}
  return null;
}

function persistSession(token) {
  try {
    const p = getSessionFilePath();
    if (token) {
      fs.writeFileSync(p, JSON.stringify({ accessToken: token }), 'utf-8');
    } else {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  } catch (_) {}
}

/** Saves cookies to disk so they can be restored on next launch (F1 TV window already logged in). */
function persistCookies(cookieList) {
  if (!Array.isArray(cookieList) || !cookieList.length) return;
  try {
    const p = getCookiesFilePath();
    fs.writeFileSync(p, JSON.stringify(cookieList), 'utf-8');
    console.log('[session] saved', cookieList.length, 'cookies to disk');
  } catch (e) {
    console.warn('[session] persist cookies:', e?.message);
  }
}

/** Restores saved cookies into defaultSession (so the F1 TV window is already logged in). */
async function restorePersistedCookies() {
  try {
    const p = getCookiesFilePath();
    if (!fs.existsSync(p)) return;
    const raw = fs.readFileSync(p, 'utf-8');
    const list = JSON.parse(raw);
    if (!Array.isArray(list) || !list.length) return;
    const defaultCookies = session.defaultSession.cookies;
    for (const c of list) {
      if (!c.url || !c.name) continue;
      await defaultCookies.set({
        url: c.url,
        name: c.name,
        value: c.value || '',
        path: c.path || '/',
        domain: c.domain || undefined,
        secure: !!c.secure,
        httpOnly: !!c.httpOnly,
        expirationDate: c.expirationDate,
      }).catch(() => {});
    }
    console.log('[session] restored', list.length, 'cookies from disk');
  } catch (_) {}
}

/** Snapshots F1 cookies from defaultSession and saves them to disk (rolling persistence). */
async function snapshotAndPersistCookies() {
  try {
    const exp = Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000);
    const toPersist = [];
    for (const baseUrl of FORMULA1_URLS) {
      const list = await session.defaultSession.cookies.get({ url: baseUrl });
      for (const c of list) {
        toPersist.push({
          url: baseUrl,
          name: c.name,
          value: c.value,
          path: c.path || '/',
          domain: c.domain || undefined,
          secure: !!c.secure,
          httpOnly: !!c.httpOnly,
          expirationDate: c.session ? exp : c.expirationDate,
        });
      }
    }
    persistCookies(toPersist);
  } catch (e) {
    console.warn('[session] snapshot cookies:', e?.message);
  }
}

async function removeFormula1Cookies() {
  try {
    for (const u of FORMULA1_URLS) {
      const list = await session.defaultSession.cookies.get({ url: u });
      for (const c of list) await session.defaultSession.cookies.remove(u, c.name).catch(() => {});
    }
  } catch (_) {}
}

/** Milliseconds until the JWT expires (negative if already expired), or null if unreadable. */
function tokenTtlMs(token) {
  const payload = parseJwtPayload(token);
  if (!payload || !Number.isFinite(payload.exp)) return null;
  return payload.exp * 1000 - Date.now();
}

function isTokenExpired(token, skewMs = 60 * 1000) {
  const ttl = tokenTtlMs(token);
  // Unreadable exp → assume valid and let the F1 client decide.
  if (ttl == null) return false;
  return ttl <= skewMs;
}

/**
 * Reads the subscription token embedded in F1's `login-session` cookie
 * (URL-encoded JSON: {"data":{"subscriptionToken":"<jwt>"}}).
 */
async function readLoginSessionCookieToken() {
  try {
    const urls = ['https://account.formula1.com', 'https://formula1.com', 'https://f1tv.formula1.com'];
    for (const u of urls) {
      const list = await session.defaultSession.cookies.get({ url: u, name: 'login-session' });
      for (const c of list) {
        try {
          const obj = JSON.parse(decodeURIComponent(c.value));
          const token = obj?.data?.subscriptionToken ?? obj?.subscriptionToken;
          if (typeof token === 'string' && token.length > 50) return token;
        } catch (_) {}
      }
    }
  } catch (_) {}
  return null;
}

/** Single-flight guard so concurrent callers share one silent refresh attempt. */
let silentRefreshInFlight = null;

/**
 * Tries to obtain a fresh subscription token without user interaction:
 * 1. reads the `login-session` cookie (may already hold a fresher token than the persisted one);
 * 2. otherwise loads account.formula1.com in a hidden window on the default session. If the
 *    persisted account cookies are still valid, F1 re-issues `login-session` with a fresh token.
 * On success the F1 client is re-initialized and token + cookies are persisted.
 * @returns {Promise<string|null>} the fresh token, or null if silent refresh is not possible.
 */
function silentTokenRefresh() {
  if (silentRefreshInFlight) return silentRefreshInFlight;
  silentRefreshInFlight = (async () => {
    const current = memSession.accessToken;
    // 1. Cookie may already carry a fresher token.
    let candidate = await readLoginSessionCookieToken();
    if (candidate && candidate !== current && !isTokenExpired(candidate)) {
      try {
        await f1tv.initClient(candidate);
        memSession.accessToken = candidate;
        persistSession(candidate);
        await snapshotAndPersistCookies();
        console.log('[session] silent refresh: token recovered from login-session cookie');
        return candidate;
      } catch (e) {
        console.warn('[session] silent refresh: cookie token rejected:', e?.message);
      }
    }

    // 2. Hidden window: valid account cookies make F1 re-issue login-session.
    let hiddenWin = null;
    try {
      hiddenWin = new BrowserWindow({
        show: false,
        width: 800,
        height: 600,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
      });
      hiddenWin.loadURL(F1_LOGIN_URL).catch(() => {});
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 700));
        const token = await readLoginSessionCookieToken();
        if (token && token !== candidate && token !== current && !isTokenExpired(token)) {
          try {
            await f1tv.initClient(token);
            memSession.accessToken = token;
            persistSession(token);
            await snapshotAndPersistCookies();
            console.log('[session] silent refresh: fresh token from hidden window');
            return token;
          } catch (e) {
            console.warn('[session] silent refresh: hidden-window token rejected:', e?.message);
            candidate = token; // don't retry the same token
          }
        }
      }
      console.warn('[session] silent refresh failed: no fresh token within timeout');
      return null;
    } catch (e) {
      console.warn('[session] silent refresh error:', e?.message);
      return null;
    } finally {
      try { if (hiddenWin && !hiddenWin.isDestroyed()) hiddenWin.destroy(); } catch (_) {}
    }
  })().finally(() => {
    silentRefreshInFlight = null;
  });
  return silentRefreshInFlight;
}

/**
 * Refreshes the F1 client session (ascendon/entitlement) so license requests use valid tokens.
 * Call before contentPlay when the app has been running for a while; F1 tokens can expire after hours.
 */
async function refreshSessionBeforePlayback() {
  const token = memSession.accessToken;
  if (!token) return;
  // Token already expired per its JWT exp: skip the doomed init and refresh silently right away.
  if (isTokenExpired(token)) {
    console.warn('[session] token expired (jwt exp), attempting silent refresh…');
    const fresh = await silentTokenRefresh();
    if (fresh) return;
    persistSession(null);
    memSession.accessToken = undefined;
    throw new Error('Session expired or invalid. Please sign in again (e.g. "Sign in with browser") and retry.');
  }
  try {
    await f1tv.initClient(token);
    console.log('[session] refreshed token before playback');
  } catch (e) {
    console.warn('[session] refresh before playback failed, trying silent refresh:', e?.message);
    const fresh = await silentTokenRefresh();
    if (fresh) return;
    persistSession(null);
    memSession.accessToken = undefined;
    const msg = e?.message || String(e);
    throw new Error(
      msg.includes('expired') || msg.includes('timeout') || msg.includes('verification')
        ? 'Session expired or invalid. Please sign in again (e.g. "Sign in with browser") and retry.'
        : msg
    );
  }
}

/** Lighter reset: drop the token + cookies, keep cache/storage. Used by the "sign out" IPC path. */
async function clearSessionAndCookies() {
  memSession.accessToken = undefined;
  persistSession(null);
  try {
    const p = getCookiesFilePath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (_) {}
  f1tv.clearSession();
  await removeFormula1Cookies();
}

/**
 * Full reset: session, cookies, F1 client, and all session storage/cache.
 * Use from Settings to guarantee a clean state (e.g. before re-login to fix DRM 403).
 */
async function resetSessionAndStorage() {
  await clearSessionAndCookies();
  try {
    await session.defaultSession.clearCache();
    await session.defaultSession.clearStorageData({
      storages: ['localstorage', 'sessionstorage', 'cookies', 'cachestorage', 'indexdb'],
    });
  } catch (e) {
    console.warn('[reset] clearStorageData/clearCache:', e?.message);
  }
  console.log('[reset] Full reset completed (session, cookies, cache, storage).');
}

/** Restores the persisted token on startup: try it directly, else fall back to silent refresh. */
async function restoreSessionOnStartup() {
  const savedToken = loadPersistedSession();
  await restorePersistedCookies();
  if (!savedToken) return;
  memSession.accessToken = savedToken;
  console.log('[session] token found on disk, restoring F1 TV client…');
  const restoreChain = isTokenExpired(savedToken)
    ? Promise.reject(new Error('persisted token expired (jwt exp)'))
    : f1tv.initClient(savedToken);
  restoreChain.then(() => {
    console.log('[session] F1 TV client restored successfully');
  }).catch(async (e) => {
    console.warn('[session] restore failed, trying silent refresh:', e?.message);
    const fresh = await silentTokenRefresh();
    if (!fresh) {
      console.warn('[session] silent refresh failed, new login required');
      persistSession(null);
      memSession.accessToken = undefined;
    }
  });
}

/**
 * Proactive keep-alive: while the app runs, renew the token before it expires so long sessions
 * (e.g. an all-day race weekend) never hit a dead token mid-use.
 */
function startProactiveRefreshLoop() {
  setInterval(() => {
    const token = memSession.accessToken;
    if (!token) return;
    const ttl = tokenTtlMs(token);
    if (ttl != null && ttl < 6 * 60 * 60 * 1000) {
      console.log('[session] token expiring soon (ttl', Math.round(ttl / 60000), 'min), proactive silent refresh…');
      silentTokenRefresh().catch(() => {});
    }
  }, 30 * 60 * 1000);
}

module.exports = {
  memSession,
  F1_LOGIN_URL,
  FORMULA1_URLS,
  getCookiesFilePath,
  loadPersistedSettings,
  persistSettingsKey,
  loadPersistedSession,
  persistSession,
  persistCookies,
  tokenTtlMs,
  isTokenExpired,
  silentTokenRefresh,
  refreshSessionBeforePlayback,
  clearSessionAndCookies,
  resetSessionAndStorage,
  restoreSessionOnStartup,
  startProactiveRefreshLoop,
};
