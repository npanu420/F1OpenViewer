const path = require('path');
const fs = require('fs');
const http = require('http');
const electron = require('electron');
const { app, BrowserWindow, ipcMain, session } = electron;
const components = electron.components;
const axios = require('axios');
const f1tv = require('./f1tv-bridge');

const memSession = { accessToken: undefined };

const LICENSE_PROXY_PORT = 18765;
const LICENSE_PROXY_URL = `http://127.0.0.1:${LICENSE_PROXY_PORT}/la`;
let licenseProxyTarget = '';

const F1TV_WEB_BASE = 'https://f1tv.formula1.com';

/** Slug per URL detail F1 TV: /detail/{contentId}/{slug} */
function slugify(title) {
  if (!title || typeof title !== 'string') return 'video';
  const s = title.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  return s.length ? s : 'video';
}

/**
 * Apre una finestra con il player custom (pagina locale + Shaka). Stessa partition della sessione
 * per DRM; il proxy licenze e gli header vengono usati dalla finestra player.
 */
async function openCustomPlayerWindow(contentId, title, channelId) {
  const id = Number(contentId);
  if (!Number.isFinite(id) || id <= 0) {
    console.warn('[player] contentId non valido:', contentId);
    return;
  }
  let result;
  try {
    result = await f1tv.contentPlay(id, channelId ?? undefined);
  } catch (e) {
    console.warn('[player] contentPlay fallito:', e?.message);
    return;
  }
  if (!result?.manifestUrl) {
    console.warn('[player] nessun manifestUrl in risposta');
    return;
  }
  let licenseUrl = result.licenseUrl || '';
  if (licenseUrl.startsWith('https://') && licenseUrl.includes('formula1.com')) {
    licenseProxyTarget = licenseUrl;
    licenseUrl = LICENSE_PROXY_URL;
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
    console.warn('[player] loadFile:', e?.message);
  });
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('player:load', payload);
  });
}

function startLicenseProxy() {
  const server = http.createServer(async (req, res) => {
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
      console.warn('[license-proxy] nessun target LA impostato');
      res.writeHead(502);
      res.end();
      return;
    }
    try {
      const headers = f1tv.getLicenseRequestHeaders() || {};
      const cookies = await session.defaultSession.cookies.get({ url: target });
      if (cookies.length) headers.Cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
      headers['Content-Type'] = req.headers['content-type'] || 'application/octet-stream';
      const r = await axios.post(target, body, {
        headers,
        responseType: 'arraybuffer',
        validateStatus: () => true,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
      const buf = Buffer.from(r.data);
      const outHeaders = {};
      if (r.headers['content-type']) outHeaders['Content-Type'] = r.headers['content-type'];
      res.writeHead(r.status, outHeaders);
      res.end(buf);
      console.log('[license-proxy] F1 → status', r.status);
      if (r.status === 403 && buf.length < 500) {
        try {
          const j = JSON.parse(buf.toString('utf8'));
          const err = j?.resultObj?.keyos?.errormsg || j?.message || '';
          if (err) console.log('[license-proxy] 403:', err.slice(0, 80));
        } catch (_) {}
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
      console.warn('[license-proxy] errore:', e?.message);
      res.writeHead(502);
      res.end();
    }
  });
  server.listen(LICENSE_PROXY_PORT, '127.0.0.1', () => {
    console.log('[license-proxy] in ascolto su', LICENSE_PROXY_URL);
  });
  server.on('error', (e) => {
    console.warn('[license-proxy] server error:', e?.message);
  });
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

/** Salva i cookie su disco per ripristinarli al prossimo avvio (finestra F1 TV già loggata). */
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

/** Ripristina i cookie salvati nella defaultSession (così la finestra F1 TV è già loggata). */
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
    console.log('[session] ripristinati', list.length, 'cookie da disco');
  } catch (_) {}
}

/**
 * Trova la cartella Widevine CDM di Chrome su Windows (per uso con Electron).
 * Restituisce { path, version } o null.
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
      console.log('[Widevine] usato CDM Chrome:', cdmPath, '| version:', cdmVersion);
    }
  }
  if (cdmPath) app.commandLine.appendSwitch('widevine-cdm-path', cdmPath);
  if (cdmVersion) app.commandLine.appendSwitch('widevine-cdm-version', cdmVersion);
  app.commandLine.appendSwitch('enable-widevine-cdm');
}

const F1_LOGIN_URL = 'https://account.formula1.com/';

/** Script iniettato nella pagina F1 per intercettare la risposta by-password (fetch e XHR) e inviare il token. */
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

    const loginWin = new BrowserWindow({
      width: 900,
      height: 700,
      title: 'Accedi a F1 TV',
      webPreferences: {
        preload: path.join(__dirname, 'login-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    const timeout = setTimeout(() => {
      finish(new Error('Timeout: completa il login nella finestra entro qualche minuto.'));
    }, 300000);

    ipcMain.once('f1:login-token', async (_, token) => {
      if (settled) return;
      // Come MultiViewer: i cookie impostati da F1 TV sono necessari per il server licenze e per la finestra web F1 TV.
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
          if (list.length) console.log('[login] copiati', list.length, 'cookie per', baseUrl);
        }
        persistCookies(toPersist);
      } catch (e) {
        console.warn('[login] copia cookie:', e?.message);
      }
      finish(null, token);
    });

    loginWin.on('closed', () => {
      if (!settled) finish(new Error('Finestra chiusa senza aver completato il login.'));
    });

    loginWin.loadURL(F1_LOGIN_URL).then(() => {}).catch((e) => finish(e));

    loginWin.webContents.on('did-finish-load', () => {
      loginWin.webContents.executeJavaScript(LOGIN_PAGE_INJECT).catch(() => {});
    });
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    backgroundColor: '#0b0f14',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      plugins: true, // necessario per CDM/DRM in alcune configurazioni
      webSecurity: false, // evita blocchi CORS su manifest/segment/license CDN F1 TV
    },
  });

  const startUrl = process.env.ELECTRON_START_URL;
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
  // Milestone 1: il renderer NON fa chiamate dirette; usa IPC.
  // Tuttavia abilitiamo una policy dev-only che può aiutare con risorse cross-origin (manifest/segment).
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

/** Log status risposta richieste LA per debug (403/401 = rifiutato). */
function setupLicenseResponseLog() {
  session.defaultSession.webRequest.onCompleted((details) => {
    const url = details.url || '';
    if (url.includes('formula1.com') && (url.includes('/LA') || url.includes('/CONTENT/LA'))) {
      console.log('[license] risposta LA status:', details.statusCode, details.statusCode >= 400 ? '(richiesta rifiutata)' : '');
    }
  });
}

/** Inietta ascendon/entitlement e cookie su ogni richiesta al server licenze F1 (come MultiViewer). */
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
    console.log('[license] header iniettati su richiesta LA' + (cookieCount ? ` | ${cookieCount} cookie` : ' (nessun cookie)'));
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
      console.warn('[session] restore fallito, token scaduto:', e?.message);
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
  ipcMain.handle('f1:contentPlay', async (_evt, contentId, channelId) => {
    const result = await f1tv.contentPlay(contentId, channelId);
    if (result?.licenseUrl && result.licenseUrl.startsWith('https://') && result.licenseUrl.includes('formula1.com')) {
      licenseProxyTarget = result.licenseUrl;
      result.licenseUrl = LICENSE_PROXY_URL;
    }
    return result;
  });
  ipcMain.handle('f1:openInF1TVWeb', async (_evt, contentId, title, channelId) => {
    await openCustomPlayerWindow(contentId, title, channelId);
  });
  ipcMain.handle('f1:isReady', () => f1tv.isClientReady);

  ipcMain.handle('net:request', async (_evt, req) => {
    const method = req?.method;
    const url = req?.url;
    if (!method || !url) throw new Error('Richiesta non valida (method/url).');

    const timeout = Number(req?.timeoutMs ?? 30000);
    const headers = Object.assign({}, req?.headers || {});

    // Se non fornito, iniettiamo il bearer dalla sessione in memoria.
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
      const msg = e?.message || 'Errore rete.';
      return { ok: false, status: 0, headers: {}, data: { message: msg } };
    }
  });
}

configureWidevineFromEnv();

// Su Windows evita "Sandbox cannot access executable" che può bloccare CDM/DRM
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('no-sandbox');
}

app.whenReady().then(async () => {
  if (components && typeof components.whenReady === 'function') {
    console.log('[Widevine] attesa CDM castLabs…');
    await components.whenReady();
    console.log('[Widevine] CDM castLabs pronto.');
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
    console.log('[session] token trovato su disco, ripristino client F1 TV…');
    f1tv.initClient(savedToken).then(() => {
      console.log('[session] client F1 TV ripristinato con successo');
    }).catch((e) => {
      console.warn('[session] token scaduto, richiesto nuovo login:', e?.message);
      persistSession(null);
      memSession.accessToken = undefined;
    });
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

