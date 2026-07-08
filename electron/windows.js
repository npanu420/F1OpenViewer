/**
 * BrowserWindow management: the main dashboard window, multiview popouts, standalone live-timing
 * windows, and the frameless custom-player window. Owns the window registries and the broadcast
 * helpers that push events to every window of a given kind.
 */

const path = require('path');
const fs = require('fs');
const { BrowserWindow, screen } = require('electron');

/** The single main dashboard window, not the multiview/livetiming/player popouts. Update notices target this one. */
let mainWindow = null;
function getMainWindow() {
  return mainWindow;
}

/** Resolve the app icon path once (icon.ico preferred on Windows, falls back to icon.png). */
function getAppIcon() {
  const ico = path.join(__dirname, 'icon.ico');
  const png = path.join(__dirname, 'icon.png');
  if (fs.existsSync(ico)) return ico;
  if (fs.existsSync(png)) return png;
  return undefined;
}

/** URL of the main app (same one createWindow loads) used to build every standalone popout's URL. */
function getMainAppUrl() {
  const startUrl = process.env.ELECTRON_START_URL;
  if (startUrl) return startUrl;
  return 'file://' + path.join(__dirname, '..', 'dist', 'index.html').replace(/\\/g, '/');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    backgroundColor: '#0b0f14',
    icon: getAppIcon(),
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
  win.webContents.on('console-message', (evt, level, message, line, sourceId) => {
    const lvl = evt.level ?? level ?? 0;
    const msg = evt.message ?? message ?? '';
    const tag = lvl === 2 ? 'error' : lvl === 1 ? 'warn' : 'log';
    if (process.env.ELECTRON_START_URL && typeof msg === 'string' && msg.includes('Electron Security Warning')) return;
    const sid = evt.sourceId ?? sourceId;
    const ln = evt.line ?? line;
    const loc = sid && ln != null ? ` (${sid}:${ln})` : '';
    console.log(`[renderer:${tag}] ${msg}${loc}`);
  });

  if (startUrl) {
    win.loadURL(startUrl);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  if (process.env.ELECTRON_OPEN_DEVTOOLS === 'true') {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  win.webContents.on('before-input-event', (_evt, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      win.webContents.isDevToolsOpened() ? win.webContents.closeDevTools() : win.webContents.openDevTools({ mode: 'detach' });
    }
  });

  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  return win;
}

// ----- multiview popouts -----

/** Istanze multiview aperte: id → finestra (più monitor / più layout). */
const multiviewWindows = new Map();
let multiviewInstanceSeq = 0;

function broadcastMultiviewWindows() {
  const ids = Array.from(multiviewWindows.keys()).sort((a, b) => a - b);
  const payload = { ids, count: ids.length };
  for (const bw of BrowserWindow.getAllWindows()) {
    try {
      if (bw.isDestroyed()) continue;
      bw.webContents.send('multiview:windowsChanged', payload);
    } catch (_) {}
  }
}

/** Apre una nuova finestra multiview numerata (#standalone-multiview?mv=n). */
function createMultiviewWindow() {
  const id = ++multiviewInstanceSeq;
  const baseUrl = getMainAppUrl();
  const fragment = `standalone-multiview?mv=${id}`;
  const multiviewUrl = baseUrl.includes('#')
    ? baseUrl.replace(/#.*$/, '') + '#' + fragment
    : baseUrl + '#' + fragment;

  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    backgroundColor: '#0b0f14',
    title: `F1 OpenViewer — Multiview #${id}`,
    icon: getAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      plugins: true,
      webSecurity: false, // avoid CORS blocks on manifest/segment/license F1 TV CDN
    },
  });

  multiviewWindows.set(id, win);
  win.on('closed', () => {
    multiviewWindows.delete(id);
    broadcastMultiviewWindows();
  });

  win.loadURL(multiviewUrl).catch((e) => console.warn('[multiview] load failed:', e?.message));
  broadcastMultiviewWindows();
  return { win, id };
}

function listMultiviewWindowIds() {
  return Array.from(multiviewWindows.keys()).sort((a, b) => a - b);
}

/** Closes the multiview window that owns `webContents` (documented API; getOwnerBrowserWindow is not). */
function closeMultiviewWindowFor(webContents) {
  const w = BrowserWindow.fromWebContents(webContents)
    || (typeof webContents.getOwnerBrowserWindow === 'function' ? webContents.getOwnerBrowserWindow() : null);
  if (w && !w.isDestroyed()) w.close();
}

// ----- live timing popouts -----

/** Live-timing windows currently open, so we can relay the video master clock to all of them. */
const liveTimingWindows = new Set();

function broadcastLiveTimingUpdate(feed, data) {
  for (const w of liveTimingWindows) {
    if (!w.isDestroyed()) w.webContents.send('livetiming:liveUpdate', { feed, data });
  }
}
function broadcastLiveTimingStatus(status, detail) {
  for (const w of liveTimingWindows) {
    if (!w.isDestroyed()) w.webContents.send('livetiming:liveStatus', { status, detail });
  }
}
function broadcastLiveTimingClock(payload) {
  for (const w of liveTimingWindows) {
    if (!w.isDestroyed()) w.webContents.send('livetiming:clock', payload);
  }
}

/** Opens a standalone Live Timing window for an archived session Path (or `live: true` for a running one). */
function createLiveTimingWindow(opts = {}) {
  const baseUrl = getMainAppUrl();
  const title = opts.title;
  const params = new URLSearchParams();
  if (opts.live) {
    // Still-running session: no static archive to resolve yet, the window starts the SignalR
    // live subscription itself and resolves the archive Path separately just for the team-radio
    // audio base URL (see livetiming:liveStart).
    params.set('live', '1');
    if (opts.sessionKey != null) params.set('sessionKey', String(opts.sessionKey));
    if (opts.meetingName) params.set('meetingName', String(opts.meetingName));
    if (opts.sessionName) params.set('sessionName', String(opts.sessionName));
    if (opts.year != null) params.set('year', String(opts.year));
  } else if (opts.path) {
    params.set('path', String(opts.path));
  } else {
    // No resolved path yet, so just pass the raw query and let the window resolve it and fetch
    // sync itself. That way the click stays instant, no network to await before the window shows up,
    // and the window already has its own loading spinner to cover the wait.
    if (opts.year != null) params.set('year', String(opts.year));
    if (opts.meetingName) params.set('meetingName', String(opts.meetingName));
    if (opts.meetingNumber != null) params.set('meetingNumber', String(opts.meetingNumber));
    if (opts.sessionName) params.set('sessionName', String(opts.sessionName));
    if (opts.sessionType) params.set('sessionType', String(opts.sessionType));
    if (opts.sessionKey != null) params.set('sessionKey', String(opts.sessionKey));
  }
  if (title) params.set('title', String(title));
  const fragment = `standalone-livetiming?${params.toString()}`;
  const url = baseUrl.includes('#')
    ? baseUrl.replace(/#.*$/, '') + '#' + fragment
    : baseUrl + '#' + fragment;

  const win = new BrowserWindow({
    width: 1100,
    height: 860,
    backgroundColor: '#0b0f14',
    title: `F1 OpenViewer — Live Timing${title ? ' — ' + title : ''}`,
    icon: getAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  liveTimingWindows.add(win);
  win.on('closed', () => liveTimingWindows.delete(win));
  win.loadURL(url).catch((e) => console.warn('[livetiming] window load failed:', e?.message));
  win.webContents.on('before-input-event', (_evt, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      win.webContents.isDevToolsOpened() ? win.webContents.closeDevTools() : win.webContents.openDevTools({ mode: 'detach' });
    }
  });
  return win;
}

// ----- standalone custom player window -----

/** Last reported intrinsic video size per standalone player window (avoid resize loops). */
const playerWindowVideoSize = new WeakMap();

/**
 * Resize a frameless player window so its content area exactly matches the video aspect ratio.
 * No letterboxing: the window shape follows the stream.
 */
function fitStandalonePlayerWindow(win, videoW, videoH) {
  if (!win || win.isDestroyed()) return;
  const ww = Number(videoW);
  const hh = Number(videoH);
  if (!Number.isFinite(ww) || !Number.isFinite(hh) || ww <= 0 || hh <= 0) return;

  const prev = playerWindowVideoSize.get(win);
  if (prev && prev.w === ww && prev.h === hh) return;
  playerWindowVideoSize.set(win, { w: ww, h: hh });

  const aspect = ww / hh;
  win.setAspectRatio(aspect);

  const bounds = win.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const work = display?.workArea ?? { x: 0, y: 0, width: 1920, height: 1080 };
  const maxW = Math.max(320, work.width - 24);
  const maxH = Math.max(180, work.height - 24);

  let contentW = Math.min(1280, maxW);
  let contentH = Math.round(contentW / aspect);
  if (contentH > maxH) {
    contentH = maxH;
    contentW = Math.round(contentH * aspect);
  }

  win.setContentSize(contentW, contentH);
  try { win.center(); } catch (_) {}
}

/**
 * Opens a frameless window with the custom React player (#standalone-player route).
 * The window resolves playback itself via f1:contentPlay (license proxy registration included),
 * so this only needs to build the URL, same as the multiview windows.
 */
async function openCustomPlayerWindow(contentId, title, channelId) {
  const id = Number(contentId);
  if (!Number.isFinite(id) || id <= 0) {
    console.warn('[player] invalid contentId:', contentId);
    return;
  }
  const params = new URLSearchParams();
  params.set('content', String(id));
  if (channelId != null && channelId !== '') params.set('channel', String(channelId));
  if (title) params.set('title', String(title));
  const baseUrl = getMainAppUrl();
  const fragment = `standalone-player?${params.toString()}`;
  const url = baseUrl.includes('#')
    ? baseUrl.replace(/#.*$/, '') + '#' + fragment
    : baseUrl + '#' + fragment;

  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    frame: false,
    backgroundColor: '#000000',
    title: `F1 OpenViewer – ${title || id}`,
    icon: getAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      partition: 'default',
      plugins: true,
      webSecurity: false,
    },
  });
  win.loadURL(url).catch((e) => {
    console.warn('[player] loadURL failed:', e?.message);
  });
  win.on('closed', () => {
    playerWindowVideoSize.delete(win);
  });
  // Destroying the window while Shaka/EME is mid-playback (active DRM session, GPU decode
  // in flight) can crash the whole app natively. Give the renderer a moment to tear the
  // player down cleanly first, then actually close.
  let teardownStarted = false;
  win.on('close', (e) => {
    if (teardownStarted) return;
    teardownStarted = true;
    e.preventDefault();
    try { win.webContents.send('player:teardownRequest'); } catch (_) {}
    setTimeout(() => { if (!win.isDestroyed()) win.destroy(); }, 350);
  });
  win.webContents.on('before-input-event', (_evt, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      win.webContents.isDevToolsOpened() ? win.webContents.closeDevTools() : win.webContents.openDevTools({ mode: 'detach' });
    }
  });
}

module.exports = {
  getMainWindow,
  getAppIcon,
  getMainAppUrl,
  createWindow,
  createMultiviewWindow,
  listMultiviewWindowIds,
  closeMultiviewWindowFor,
  createLiveTimingWindow,
  broadcastLiveTimingUpdate,
  broadcastLiveTimingStatus,
  broadcastLiveTimingClock,
  openCustomPlayerWindow,
  fitStandalonePlayerWindow,
};
