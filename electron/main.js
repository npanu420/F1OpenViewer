const path = require('path');
const fs = require('fs');
const http = require('http');
const electron = require('electron');
const { app, BrowserWindow, ipcMain, session, Menu } = electron;
const components = electron.components;
const axios = require('axios');
const f1tv = require('./f1tv-bridge');

const memSession = { accessToken: undefined };

const LICENSE_PROXY_PORT_MIN = 18765;
const LICENSE_PROXY_PORT_MAX = 18775;
/** Set when the license proxy successfully binds; used for rewriting license URLs. */
let licenseProxyUrl = `http://127.0.0.1:${LICENSE_PROXY_PORT_MIN}/la`;
let licenseProxyTarget = '';
/** Last error message from F1 license server (403 response), so the player UI can show it. */
let lastLicenseErrorMsg = '';

const F1TV_WEB_BASE = 'https://f1tv.formula1.com';

/** Slug for F1 TV detail URL: /detail/{contentId}/{slug} */
function slugify(title) {
  if (!title || typeof title !== 'string') return 'video';
  const s = title.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  return s.length ? s : 'video';
}

/**
 * Refreshes the F1 client session (ascendon/entitlement) so license requests use valid tokens.
 * Call before contentPlay when the app has been running for a while; F1 tokens can expire after hours.
 */
async function refreshSessionBeforePlayback() {
  const token = memSession.accessToken;
  if (!token) return;
  try {
    await f1tv.initClient(token);
    console.log('[session] refreshed before playback');
  } catch (e) {
    console.warn('[session] refresh before playback failed:', e?.message);
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

/**
 * Opens a window with the custom player (local page + Shaka). Same session partition for DRM;
 * license proxy and headers are used by the player window.
 */
async function openCustomPlayerWindow(contentId, title, channelId) {
  const id = Number(contentId);
  if (!Number.isFinite(id) || id <= 0) {
    console.warn('[player] invalid contentId:', contentId);
    return;
  }
  await refreshSessionBeforePlayback();
  let result;
  try {
    result = await f1tv.contentPlay(id, channelId ?? undefined);
  } catch (e) {
    console.warn('[player] contentPlay failed:', e?.message);
    throw e;
  }
  if (!result?.manifestUrl) {
    console.warn('[player] no manifestUrl in response');
    return;
  }
  // Store playToken for the license proxy and as session cookie for CDN requests
  if (result.playToken) {
    currentPlayToken = result.playToken;
    console.log('[player] playToken stored for license proxy');
    const cdnOrigins = ['https://f1tv.formula1.com', 'https://ott-video-fer-cf.formula1.com', 'https://ott-video-cf.formula1.com'];
    for (const origin of cdnOrigins) {
      session.defaultSession.cookies.set({ url: origin, name: 'playToken', value: currentPlayToken, path: '/' }).catch(() => {});
    }
  }
  let licenseUrl = result.licenseUrl || '';
  if (licenseUrl.startsWith('https://') && licenseUrl.includes('formula1.com')) {
    licenseProxyTarget = licenseUrl;
    licenseUrl = licenseProxyUrl;
  }
  const licenseHeaders = {};
  if (result.drmToken) {
    licenseHeaders.Authorization = `Bearer ${result.drmToken}`;
    licenseHeaders.drmtoken = result.drmToken;
  }
  if (result.licenseAscendonToken) licenseHeaders.ascendontoken = result.licenseAscendonToken;
  if (result.licenseEntitlementToken) licenseHeaders.entitlementtoken = result.licenseEntitlementToken;
  const fallbackLicenseHeaders = {};
  if (result.fallbackDrmToken) {
    fallbackLicenseHeaders.Authorization = `Bearer ${result.fallbackDrmToken}`;
    fallbackLicenseHeaders.drmtoken = result.fallbackDrmToken;
  }
  if (result.licenseAscendonToken) fallbackLicenseHeaders.ascendontoken = result.licenseAscendonToken;
  if (result.licenseEntitlementToken) fallbackLicenseHeaders.entitlementtoken = result.licenseEntitlementToken;

  const payload = {
    manifestUrl: result.manifestUrl,
    licenseUrl,
    licenseHeaders: Object.keys(licenseHeaders).length ? licenseHeaders : undefined,
    fallbackManifestUrl: result.fallbackManifestUrl,
    fallbackLicenseUrl: result.fallbackLicenseUrl || '',
    fallbackLicenseHeaders: Object.keys(fallbackLicenseHeaders).length ? fallbackLicenseHeaders : undefined,
  };

  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    title: `F1 OpenViewer – ${title || id}`,
    webPreferences: {
      preload: path.join(__dirname, 'player-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      partition: 'default',
      plugins: true,
      webSecurity: false,
    },
  });
  win.loadFile(path.join(__dirname, 'player.html')).catch((e) => {
    console.warn('[player] loadFile failed:', e?.message);
  });
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('player:load', payload);
  });
}

const LICENSE_PROXY_FORWARD_HEADERS = ['authorization', 'drmtoken', 'ascendontoken', 'entitlementtoken'];

/** playToken for single-stream player window; dashboard streams send per-request X-F1-Play-Token. */
let currentPlayToken = '';

function buildLicenseProxyHeaders(req) {
  const headers = f1tv.getLicenseRequestHeaders() || {};
  for (const key of LICENSE_PROXY_FORWARD_HEADERS) {
    const v = req.headers[key] || req.headers[key.toLowerCase()];
    if (v) headers[key] = Array.isArray(v) ? v[0] : v;
  }
  return headers;
}

/**
 * @param {Record<string, string>} headers - request headers (mutated with Cookie)
 * @param {string} [playTokenOverride] - per-stream playToken from X-F1-Play-Token header (dashboard); else use currentPlayToken (player window)
 */
async function sendLicenseToF1(target, body, headers, playTokenOverride) {
  const cookies = await session.defaultSession.cookies.get({ url: target });
  const cookieParts = cookies.map((c) => `${c.name}=${c.value}`);
  const playToken = playTokenOverride ?? currentPlayToken;
  if (playToken && !cookieParts.some((p) => p.startsWith('playToken='))) {
    cookieParts.push(`playToken=${playToken}`);
  }
  if (cookieParts.length) headers.Cookie = cookieParts.join('; ');
  headers['Content-Type'] = headers['Content-Type'] || 'application/octet-stream';
  return axios.post(target, body, {
    headers,
    responseType: 'arraybuffer',
    validateStatus: () => true,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });
}

function startLicenseProxy() {
  function createProxyServer() {
    return http.createServer(async (req, res) => {
      if (req.method !== 'POST' || req.url !== '/la') {
        res.writeHead(404);
        res.end();
        return;
      }
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);
      const target = licenseProxyTarget;
      if (!target || !target.startsWith('https://')) {
        console.warn('[license-proxy] no LA target set');
        res.writeHead(502);
        res.end();
        return;
      }
      try {
        const playTokenFromRequest = req.headers['x-f1-play-token'] || req.headers['X-F1-Play-Token'];
        const playTokenValue = Array.isArray(playTokenFromRequest) ? playTokenFromRequest[0] : playTokenFromRequest;

        const headers = buildLicenseProxyHeaders(req);
        let r = await sendLicenseToF1(target, body, { ...headers, 'Content-Type': req.headers['content-type'] || 'application/octet-stream' }, playTokenValue);

        // On 403, try once to refresh session (ascendon/entitlement) and retry
        if (r.status === 403 && memSession.accessToken) {
          try {
            await f1tv.initClient(memSession.accessToken);
            const retryHeaders = buildLicenseProxyHeaders(req);
            retryHeaders['Content-Type'] = req.headers['content-type'] || 'application/octet-stream';
            const r2 = await sendLicenseToF1(target, body, retryHeaders, playTokenValue);
            if (r2.status === 200) {
              r = r2;
              console.log('[license-proxy] F1 → 200 after session refresh retry');
            }
          } catch (_) {}
        }

        const buf = Buffer.from(r.data);
        const outHeaders = {};
        if (r.headers['content-type']) outHeaders['Content-Type'] = r.headers['content-type'];
        res.writeHead(r.status, outHeaders);
        res.end(buf);
        console.log('[license-proxy] F1 → status', r.status);
        if (r.status === 403 && buf.length < 500) {
          try {
            const j = JSON.parse(buf.toString('utf8'));
            lastLicenseErrorMsg = j?.resultObj?.keyos?.errormsg || j?.message || j?.resultObj?.message || '';
            if (lastLicenseErrorMsg) console.log('[license-proxy] 403:', lastLicenseErrorMsg.slice(0, 80));
          } catch (_) {}
        } else if (r.status === 200) {
          lastLicenseErrorMsg = '';
        }
        if (r.status === 200 && r.headers['set-cookie']) {
          const setCookies = Array.isArray(r.headers['set-cookie']) ? r.headers['set-cookie'] : [r.headers['set-cookie']];
          const origin = new URL(target).origin;
          for (const raw of setCookies) {
            const [nameVal, ...rest] = raw.split(';').map((s) => s.trim());
            const eq = nameVal.indexOf('=');
            if (eq <= 0) continue;
            const name = nameVal.slice(0, eq);
            const value = nameVal.slice(eq + 1);
            let path = '/';
            for (const part of rest) {
              if (part.toLowerCase().startsWith('path=')) path = part.slice(5).trim();
            }
            session.defaultSession.cookies.set({ url: origin, name, value, path }).catch(() => {});
          }
        }
      } catch (e) {
        console.warn('[license-proxy] error:', e?.message);
        res.writeHead(502);
        res.end();
      }
    });
  }

  function tryListen(port) {
    if (port > LICENSE_PROXY_PORT_MAX) {
      console.warn('[license-proxy] no free port in range', LICENSE_PROXY_PORT_MIN, '-', LICENSE_PROXY_PORT_MAX, '; DRM may not work');
      return;
    }
    const server = createProxyServer();
    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        console.warn('[license-proxy] port', port, 'in use, trying', port + 1);
        tryListen(port + 1);
      } else {
        console.warn('[license-proxy] server error:', e?.message);
      }
    });
    server.listen(port, '127.0.0.1', () => {
      licenseProxyUrl = `http://127.0.0.1:${port}/la`;
      console.log('[license-proxy] listening on', licenseProxyUrl);
    });
  }
  tryListen(LICENSE_PROXY_PORT_MIN);
}

function getSessionFilePath() {
  return path.join(app.getPath('userData'), 'f1openviewer-session.json');
}

function getCookiesFilePath() {
  return path.join(app.getPath('userData'), 'f1openviewer-cookies.json');
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
    console.log('[session] salvati', cookieList.length, 'cookie su disco');
  } catch (e) {
    console.warn('[session] persist cookies:', e?.message);
  }
}

/**
 * Full reset: session, cookies, persisted files, F1 client, and all session storage/cache.
 * Use from Settings to guarantee a clean state (e.g. before re-login to fix DRM 403).
 */
async function performFullReset() {
  memSession.accessToken = undefined;
  persistSession(null);
  try {
    const sessionPath = getSessionFilePath();
    if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath);
    const cookiesPath = getCookiesFilePath();
    if (fs.existsSync(cookiesPath)) fs.unlinkSync(cookiesPath);
  } catch (e) {
    console.warn('[reset] delete session/cookies files:', e?.message);
  }
  f1tv.clearSession();
  try {
    const urls = ['https://formula1.com', 'https://account.formula1.com', 'https://f1tv.formula1.com'];
    for (const u of urls) {
      const list = await session.defaultSession.cookies.get({ url: u });
      for (const c of list) await session.defaultSession.cookies.remove(u, c.name).catch(() => {});
    }
  } catch (_) {}
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

/**
 * Finds Chrome Widevine CDM folder on Windows (for use with Electron).
 * Returns { path, version } or null.
 */
function findChromeWidevineWindows() {
  if (process.platform !== 'win32') return null;
  const candidates = [];
  const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const localAppData = process.env.LOCALAPPDATA || '';
  for (const base of [
    path.join(programFiles, 'Google', 'Chrome', 'Application'),
    path.join(programFilesX86, 'Google', 'Chrome', 'Application'),
  ]) {
    if (!fs.existsSync(base)) continue;
    const dirs = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory());
    for (const d of dirs) {
      const widevineBase = path.join(base, d.name, 'WidevineCdm');
      const platformDir = path.join(widevineBase, '_platform_specific', 'win_x64');
      if (fs.existsSync(platformDir) && fs.existsSync(path.join(platformDir, 'widevinecdm.dll'))) {
        let version = '';
        try {
          const manifestPath = path.join(widevineBase, 'manifest.json');
          if (fs.existsSync(manifestPath)) {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
            version = manifest.version || '';
          }
        } catch (_) {}
        candidates.push({ path: platformDir, version });
      }
    }
  }
  if (localAppData) {
    const wv = path.join(localAppData, 'Google', 'Chrome', 'User Data', 'WidevineCdm');
    if (fs.existsSync(wv)) {
      const vers = fs.readdirSync(wv, { withFileTypes: true }).filter((d) => d.isDirectory());
      for (const v of vers) {
        const platformDir = path.join(wv, v.name, '_platform_specific', 'win_x64');
        if (fs.existsSync(platformDir) && fs.existsSync(path.join(platformDir, 'widevinecdm.dll'))) {
          candidates.push({ path: platformDir, version: v.name });
        }
      }
    }
  }
  return candidates.length ? candidates[candidates.length - 1] : null;
}

function configureWidevineFromEnv() {
  if (components && typeof components.whenReady === 'function') {
    app.commandLine.appendSwitch('enable-widevine-cdm');
    return;
  }
  let cdmPath = process.env.ELECTRON_WIDEVINE_CDM_PATH;
  let cdmVersion = process.env.ELECTRON_WIDEVINE_CDM_VERSION;
  if (!cdmPath && process.platform === 'win32') {
    const found = findChromeWidevineWindows();
    if (found) {
      cdmPath = found.path;
      if (!cdmVersion) cdmVersion = found.version;
      console.log('[Widevine] using Chrome CDM:', cdmPath, '| version:', cdmVersion);
    }
  }
  if (cdmPath) app.commandLine.appendSwitch('widevine-cdm-path', cdmPath);
  if (cdmVersion) app.commandLine.appendSwitch('widevine-cdm-version', cdmVersion);
  app.commandLine.appendSwitch('enable-widevine-cdm');
}

const F1_LOGIN_URL = 'https://account.formula1.com/';

/** Script injected into F1 page to intercept by-password response (fetch and XHR) and send the token. */
const LOGIN_PAGE_INJECT = `
(function() {
  if (window.__f1openviewerPatched) return true;
  window.__f1openviewerPatched = true;
  var sendToken = function(text) {
    if (text && text.length > 20 && window.f1openviewer && window.f1openviewer.captureToken) {
      window.f1openviewer.captureToken(text);
    }
  };
  var origFetch = window.fetch;
  window.fetch = function() {
    var url = typeof arguments[0] === 'string' ? arguments[0] : (arguments[0] && arguments[0].url);
    return origFetch.apply(this, arguments).then(function(res) {
      if (url && url.indexOf('by-password') !== -1 && res.status === 200) {
        res.clone().text().then(function(text) {
          if (text) sendToken(text);
        }).catch(function() {});
      }
      return res;
    });
  };
  var OrigXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function() {
    var xhr = new OrigXHR();
    var origOpen = xhr.open;
    xhr.open = function(method, url) {
      xhr._url = url;
      return origOpen.apply(this, arguments);
    };
    xhr.addEventListener('load', function() {
      if (xhr._url && xhr._url.indexOf('by-password') !== -1 && xhr.status === 200 && xhr.responseText) {
        sendToken(xhr.responseText);
      }
    });
    return xhr;
  };
  return true;
})();
`;

function openLoginWindow() {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err, token) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { ipcMain.removeAllListeners('f1:login-token'); } catch (_) {}
      if (!loginWin.isDestroyed()) loginWin.close();
      if (err) reject(err);
      else resolve(token);
    };

    // Use a unique in-memory partition so each sign-in has a clean session (no stale cookies/cache).
    const loginPartition = 'temp-login-' + Date.now();

    const loginWin = new BrowserWindow({
      width: 900,
      height: 700,
      title: 'Sign in to F1 TV',
      webPreferences: {
        partition: loginPartition,
        preload: path.join(__dirname, 'login-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    const timeout = setTimeout(() => {
      finish(new Error('Timeout: complete sign-in in the window within a few minutes.'));
    }, 300000);

    ipcMain.once('f1:login-token', async (_, token) => {
      if (settled) return;
      // F1 TV cookies are required for the license server and the F1 TV web window.
      await new Promise((r) => setTimeout(r, 2000));
      if (settled || loginWin.isDestroyed()) return;
      const toPersist = [];
      try {
        const loginSession = loginWin.webContents.session;
        const urls = ['https://formula1.com', 'https://account.formula1.com', 'https://f1tv.formula1.com'];
        const exp = Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000);
        for (const baseUrl of urls) {
          const list = await loginSession.cookies.get({ url: baseUrl });
          const defaultCookies = session.defaultSession.cookies;
          for (const c of list) {
            const expirationDate = c.session ? exp : c.expirationDate;
            await defaultCookies.set({
              url: baseUrl,
              name: c.name,
              value: c.value,
              path: c.path || '/',
              domain: c.domain || undefined,
              secure: c.secure,
              httpOnly: c.httpOnly,
              expirationDate,
            }).catch(() => {});
            toPersist.push({
              url: baseUrl,
              name: c.name,
              value: c.value,
              path: c.path || '/',
              domain: c.domain || undefined,
              secure: !!c.secure,
              httpOnly: !!c.httpOnly,
              expirationDate,
            });
          }
          if (list.length) console.log('[login] copied', list.length, 'cookies for', baseUrl);
        }
        persistCookies(toPersist);
      } catch (e) {
        console.warn('[login] copy cookies:', e?.message);
      }
      finish(null, token);
    });

    loginWin.on('closed', () => {
      if (!settled) finish(new Error('Window closed without completing sign-in.'));
    });

    loginWin.loadURL(F1_LOGIN_URL).then(() => {}).catch((e) => finish(e));

    loginWin.webContents.on('did-finish-load', () => {
      loginWin.webContents.executeJavaScript(LOGIN_PAGE_INJECT).catch(() => {});
    });
  });
}

function createWindow() {
  const iconPath = path.join(__dirname, 'icon.png');
  const iconPathIco = path.join(__dirname, 'icon.ico');
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    backgroundColor: '#0b0f14',
    icon: fs.existsSync(iconPathIco) ? iconPathIco : (fs.existsSync(iconPath) ? iconPath : undefined),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      plugins: true, // required for CDM/DRM in some configurations
      webSecurity: false, // avoid CORS blocks on manifest/segment/license F1 TV CDN
    },
  });

  const startUrl = process.env.ELECTRON_START_URL;
  // Diagnostics for "black screen" / renderer crash: pipe renderer events to main logs.
  win.webContents.on('did-start-loading', () => {
    console.log('[window] did-start-loading');
  });
  win.webContents.on('did-finish-load', () => {
    console.log('[window] did-finish-load | url:', win.webContents.getURL());
  });
  win.webContents.on('did-fail-load', (_evt, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    console.warn('[window] did-fail-load:', errorCode, errorDescription, '| url:', validatedURL);
  });
  win.webContents.on('render-process-gone', (_evt, details) => {
    console.warn('[window] render-process-gone:', details?.reason, details?.exitCode ?? '');
  });
  win.webContents.on('unresponsive', () => {
    console.warn('[window] renderer unresponsive');
  });
  win.webContents.on('responsive', () => {
    console.log('[window] renderer responsive');
  });
  win.webContents.on('console-message', (_evt, level, message, line, sourceId) => {
    // level: 0=log,1=warning,2=error
    const tag = level === 2 ? 'error' : level === 1 ? 'warn' : 'log';
    console.log(`[renderer:${tag}] ${message} (${sourceId}:${line})`);
  });

  if (startUrl) {
    win.loadURL(startUrl);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  if (process.env.ELECTRON_OPEN_DEVTOOLS === 'true') {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  return win;
}

function setupCorsRelaxForDev() {
  // Renderer uses IPC, not direct calls. We still enable a dev-only policy for cross-origin (manifest/segment).
  if (process.env.ELECTRON_RELAX_CORS === 'true') {
    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
      details.requestHeaders['Origin'] = details.requestHeaders['Origin'] || 'https://localhost';
      callback({ requestHeaders: details.requestHeaders });
    });
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      const headers = details.responseHeaders || {};
      headers['access-control-allow-origin'] = ['*'];
      headers['access-control-allow-headers'] = ['*'];
      callback({ responseHeaders: headers });
    });
  }
}

/** Log LA request response status for debug (403/401 = rejected). */
function setupLicenseResponseLog() {
  session.defaultSession.webRequest.onCompleted((details) => {
    const url = details.url || '';
    if (url.includes('formula1.com') && (url.includes('/LA') || url.includes('/CONTENT/LA'))) {
      console.log('[license] LA response status:', details.statusCode, details.statusCode >= 400 ? '(request rejected)' : '');
    }
  });
}

/** Injects ascendon/entitlement and cookies on every request to the F1 license server. */
function setupLicenseRequestHeaders() {
  session.defaultSession.webRequest.onBeforeSendHeaders(async (details, callback) => {
    const url = details.url || '';
    const isF1License = url.includes('formula1.com') && (url.includes('/LA') || url.includes('/CONTENT/LA'));
    if (!isF1License) {
      callback({ requestHeaders: details.requestHeaders });
      return;
    }
    const requestHeaders = { ...details.requestHeaders };
    const headers = f1tv.getLicenseRequestHeaders();
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        requestHeaders[k] = v;
      }
    }
    let cookieCount = 0;
    try {
      const cookies = await session.defaultSession.cookies.get({ url });
      if (cookies.length) {
        requestHeaders.Cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
        cookieCount = cookies.length;
      }
    } catch (_) {}
    console.log('[license] headers injected on LA request' + (cookieCount ? ` | ${cookieCount} cookies` : ' (no cookies)'));
    callback({ requestHeaders });
  });
}

function setupIpc() {
  ipcMain.handle('session:get', async () => ({ accessToken: memSession.accessToken }));
  ipcMain.handle('session:set', async (_evt, s) => {
    const token = s && typeof s.accessToken === 'string' ? s.accessToken : undefined;
    memSession.accessToken = token;
    persistSession(token);
  });
  ipcMain.handle('session:clear', async () => {
    memSession.accessToken = undefined;
    persistSession(null);
    try {
      const p = getCookiesFilePath();
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch (_) {}
    f1tv.clearSession();
    try {
      const urls = ['https://formula1.com', 'https://account.formula1.com', 'https://f1tv.formula1.com'];
      for (const u of urls) {
        const list = await session.defaultSession.cookies.get({ url: u });
        for (const c of list) await session.defaultSession.cookies.remove(u, c.name).catch(() => {});
      }
    } catch (_) {}
  });

  ipcMain.handle('f1:login', async (_evt, email, password) => {
    const { subscriptionToken } = await f1tv.login(email, password);
    await f1tv.initClient(subscriptionToken);
    memSession.accessToken = subscriptionToken;
    persistSession(subscriptionToken);
    return { accessToken: subscriptionToken };
  });
  ipcMain.handle('f1:loginWithToken', async (_evt, tokenOrJson) => {
    const { subscriptionToken } = f1tv.loginWithToken(tokenOrJson);
    await f1tv.initClient(subscriptionToken);
    memSession.accessToken = subscriptionToken;
    persistSession(subscriptionToken);
    return { accessToken: subscriptionToken };
  });
  ipcMain.handle('f1:loginWithBrowser', async () => {
    const raw = await openLoginWindow();
    const { subscriptionToken } = f1tv.loginWithToken(raw);
    await f1tv.initClient(subscriptionToken);
    memSession.accessToken = subscriptionToken;
    persistSession(subscriptionToken);
    return { accessToken: subscriptionToken };
  });
  ipcMain.handle('f1:restoreSession', async () => {
    if (f1tv.isClientReady) return { accessToken: memSession.accessToken, restored: true };
    const token = memSession.accessToken || loadPersistedSession();
    if (!token) return { accessToken: null, restored: false };
    try {
      await f1tv.initClient(token);
      memSession.accessToken = token;
      return { accessToken: token, restored: true };
    } catch (e) {
      console.warn('[session] restore failed, token expired:', e?.message);
      persistSession(null);
      memSession.accessToken = undefined;
      return { accessToken: null, restored: false };
    }
  });
  ipcMain.handle('f1:getLiveNow', async () => f1tv.getLiveNow());
  ipcMain.handle('f1:searchVod', async (_evt, params) => f1tv.searchVod(params || {}));
  ipcMain.handle('f1:getVodCatalog', async () => f1tv.getVodCatalog());
  ipcMain.handle('f1:getVodSeasons', async () => f1tv.getVodSeasons());
  ipcMain.handle('f1:getVodEvents', async (_evt, seasonPageId) => f1tv.getVodEvents(seasonPageId));
  ipcMain.handle('f1:getVodSessions', async (_evt, gpPageId) => f1tv.getVodSessions(gpPageId));
  ipcMain.handle('f1:getContentVideo', async (_evt, contentId) => f1tv.getContentVideo(contentId));

  // Serialize contentPlay so "Play all" / multiple streams don't run initClient in parallel (client gets reset and "not ready")
  // Add delay between requests to avoid CloudFront 403 "Request blocked" / "too much traffic" when opening many streams
  const CONTENT_PLAY_DELAY_MS = 450;
  let contentPlayQueue = Promise.resolve();
  ipcMain.handle('f1:contentPlay', async (_evt, contentId, channelId) => {
    contentPlayQueue = contentPlayQueue
      .catch(() => null)
      .then(async () => {
        if (!f1tv.isClientReady) {
          await refreshSessionBeforePlayback();
        }
        return f1tv.contentPlay(contentId, channelId);
      })
      .then((result) => {
        if (result?.playToken) {
          currentPlayToken = result.playToken;
          console.log('[session] playToken stored for license proxy');
          const cdnOrigins = ['https://f1tv.formula1.com', 'https://ott-video-fer-cf.formula1.com', 'https://ott-video-cf.formula1.com'];
          for (const origin of cdnOrigins) {
            session.defaultSession.cookies.set({ url: origin, name: 'playToken', value: currentPlayToken, path: '/' }).catch(() => {});
          }
        }
        if (result?.licenseUrl && result.licenseUrl.startsWith('https://') && result.licenseUrl.includes('formula1.com')) {
          licenseProxyTarget = result.licenseUrl;
          result.licenseUrl = licenseProxyUrl;
        }
        return result;
      })
      .then((result) => new Promise((resolve) => setTimeout(() => resolve(result), CONTENT_PLAY_DELAY_MS)));
    return contentPlayQueue;
  });
  ipcMain.handle('f1:openInF1TVWeb', async (_evt, contentId, title, channelId) => {
    await openCustomPlayerWindow(contentId, title, channelId);
  });
  ipcMain.handle('f1:isReady', () => f1tv.isClientReady);
  ipcMain.handle('f1:fullReset', async () => {
    await performFullReset();
    return { ok: true };
  });
  ipcMain.handle('player:getLastLicenseError', () => lastLicenseErrorMsg || '');

  ipcMain.handle('net:request', async (_evt, req) => {
    const method = req?.method;
    const url = req?.url;
    if (!method || !url) throw new Error('Invalid request (method/url).');

    const timeout = Number(req?.timeoutMs ?? 30000);
    const headers = Object.assign({}, req?.headers || {});

    // If not provided, inject bearer from in-memory session.
    if (!headers.Authorization && !headers.authorization && memSession.accessToken) {
      headers.Authorization = `Bearer ${memSession.accessToken}`;
    }

    let finalUrl = url;
    if (req?.query && typeof req.query === 'object') {
      const u = new URL(url);
      for (const [k, v] of Object.entries(req.query)) {
        if (v === undefined || v === null) continue;
        u.searchParams.set(k, String(v));
      }
      finalUrl = u.toString();
    }

    try {
      const res = await axios.request({
        method,
        url: finalUrl,
        headers,
        data: req?.body,
        timeout,
        validateStatus: () => true,
      });

      const outHeaders = {};
      for (const [k, v] of Object.entries(res.headers || {})) {
        outHeaders[String(k).toLowerCase()] = Array.isArray(v) ? v.join(',') : String(v);
      }

      return {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        headers: outHeaders,
        data: res.data,
      };
    } catch (e) {
      const msg = e?.message || 'Network error.';
      return { ok: false, status: 0, headers: {}, data: { message: msg } };
    }
  });
}

configureWidevineFromEnv();

// On Windows avoid "Sandbox cannot access executable" which can block CDM/DRM
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('no-sandbox');
}

app.whenReady().then(async () => {
  if (components && typeof components.whenReady === 'function') {
    console.log('[Widevine] waiting for castLabs CDM…');
    await components.whenReady();
    console.log('[Widevine] castLabs CDM ready.');
  }
  startLicenseProxy();
  setupCorsRelaxForDev();
  setupLicenseResponseLog();
  setupLicenseRequestHeaders();
  setupIpc();

  const savedToken = loadPersistedSession();
  await restorePersistedCookies();
  if (savedToken) {
    memSession.accessToken = savedToken;
    console.log('[session] token found on disk, restoring F1 TV client…');
    f1tv.initClient(savedToken).then(() => {
      console.log('[session] F1 TV client restored successfully');
    }).catch((e) => {
      console.warn('[session] token expired, new login required:', e?.message);
      persistSession(null);
      memSession.accessToken = undefined;
    });
  }

  Menu.setApplicationMenu(null);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

