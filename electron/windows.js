/**
 * BrowserWindow management: the main dashboard window, multiview popouts, standalone live-timing
 * windows, and the frameless custom-player window. Owns the window registries and the broadcast
 * helpers that push events to every window of a given kind.
 */

const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { BrowserWindow, screen } = require('electron');
const { devEnv, devToolsAllowed } = require('./devFlags');
const { isAppNavigation } = require('./navigationPolicy');
const { redactUrl } = require('./util');

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
  const startUrl = devEnv('ELECTRON_START_URL');
  if (startUrl) return startUrl;
  // Escaped like Chromium does, so it compares equal to the URLs the windows report (paths may
  // contain spaces, '%', '#' or non-ASCII characters).
  return pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).href;
}

const MAX_CRASH_RELOADS = 3;
const CRASH_WINDOW_MS = 60 * 1000;

/**
 * App windows run with relaxed web security (F1 CDN/DRM), so they may only ever show the app itself:
 * foreign navigations are blocked and window.open() is denied.
 */
function hardenWebContents(webContents) {
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // A crashed renderer used to leave a blank window. Reload it, but give up on a crash loop.
  const crashes = [];
  webContents.on('render-process-gone', (_evt, details) => {
    const reason = details?.reason;
    if (reason === 'clean-exit' || webContents.isDestroyed()) return;
    const now = Date.now();
    while (crashes.length && now - crashes[0] > CRASH_WINDOW_MS) crashes.shift();
    crashes.push(now);
    if (crashes.length > MAX_CRASH_RELOADS) {
      console.warn('[window] renderer keeps crashing (' + reason + '), not reloading again');
      return;
    }
    console.warn('[window] renderer gone (' + reason + '), reloading');
    setTimeout(() => { if (!webContents.isDestroyed()) webContents.reload(); }, 1000);
  });
  webContents.on('will-navigate', (event, url) => {
    if (isAppNavigation(url, getMainAppUrl())) return;
    event.preventDefault();
    console.warn('[security] blocked navigation to', redactUrl(url));
  });
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
      backgroundThrottling: false, // keep clocks and video at full rate while covered/minimised
      plugins: true, // required for CDM/DRM in some configurations
      webSecurity: false, // avoid CORS blocks on manifest/segment/license F1 TV CDN
    },
  });

  hardenWebContents(win.webContents);
  const startUrl = devEnv('ELECTRON_START_URL');
  // Pipe renderer errors/warnings to main logs (black-screen diagnostics).
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
  win.webContents.on('console-message', (evt, level, message, line, sourceId) => {
    const lvl = evt.level ?? level ?? 0;
    if (lvl < 1) return;
    const msg = evt.message ?? message ?? '';
    const tag = lvl === 2 ? 'error' : lvl === 1 ? 'warn' : 'log';
    if (devEnv('ELECTRON_START_URL') && typeof msg === 'string' && msg.includes('Electron Security Warning')) return;
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

  if (devEnv('ELECTRON_OPEN_DEVTOOLS') === 'true') {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  win.webContents.on('before-input-event', (_evt, input) => {
    if (input.type === 'keyDown' && input.key === 'F12' && devToolsAllowed()) {
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

/** Open multiview windows: id -> BrowserWindow (multiple monitors / layouts). */
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

/** Open a new numbered multiview window (#standalone-multiview?mv=n). */
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
    title: `OpenViewer — Multiview #${id}`,
    icon: getAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false, // keep clocks and video at full rate while covered/minimised
      plugins: true,
      webSecurity: false, // avoid CORS blocks on manifest/segment/license F1 TV CDN
    },
  });

  hardenWebContents(win.webContents);
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

function broadcastVideoSeekRequest(payload) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('livetiming:seekRequest', payload);
  }
}

/**
 * Put an existing window on the live-timing broadcast list (no new BrowserWindow).
 * The in-window dock uses this to get the same livetiming:liveUpdate/liveStatus/clock
 * events as a popout.
 */
function registerLiveTimingBroadcastTarget(win) {
  if (!win || win.isDestroyed() || liveTimingWindows.has(win)) return;
  liveTimingWindows.add(win);
  win.once('closed', () => { liveTimingWindows.delete(win); notifyClockListeners(); });
  notifyClockListeners();
}
function unregisterLiveTimingBroadcastTarget(win) {
  if (win) liveTimingWindows.delete(win);
  notifyClockListeners();
}

function liveTimingListenerCount() {
  let n = 0;
  for (const w of liveTimingWindows) if (!w.isDestroyed()) n += 1;
  return n;
}

/** Players only relay their clock (4 Hz IPC) while some timing window/dock listens. */
function notifyClockListeners() {
  const has = liveTimingListenerCount() > 0;
  for (const w of BrowserWindow.getAllWindows()) {
    try { if (!w.isDestroyed()) w.webContents.send('livetiming:clockListeners', has); } catch (_) {}
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
  // Session tag so this window only follows the clock of the multiview showing the same session.
  if (opts.contentId != null) params.set('cid', String(opts.contentId));
  const fragment = `standalone-livetiming?${params.toString()}`;
  const url = baseUrl.includes('#')
    ? baseUrl.replace(/#.*$/, '') + '#' + fragment
    : baseUrl + '#' + fragment;

  const win = new BrowserWindow({
    width: 1100,
    height: 860,
    backgroundColor: '#0b0f14',
    title: `OpenViewer — Live Timing${title ? ' — ' + title : ''}`,
    icon: getAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false, // keep clocks and video at full rate while covered/minimised
    },
  });
  hardenWebContents(win.webContents);
  liveTimingWindows.add(win);
  win.on('closed', () => { liveTimingWindows.delete(win); notifyClockListeners(); });
  notifyClockListeners();
  win.loadURL(url).catch((e) => console.warn('[livetiming] window load failed:', e?.message));
  win.webContents.on('before-input-event', (_evt, input) => {
    if (input.type === 'keyDown' && input.key === 'F12' && devToolsAllowed()) {
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
    title: `OpenViewer – ${title || id}`,
    icon: getAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false, // keep clocks and video at full rate while covered/minimised
      plugins: true,
      webSecurity: false,
    },
  });
  hardenWebContents(win.webContents);
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
    if (input.type === 'keyDown' && input.key === 'F12' && devToolsAllowed()) {
      win.webContents.isDevToolsOpened() ? win.webContents.closeDevTools() : win.webContents.openDevTools({ mode: 'detach' });
    }
  });
}

/**
 * Close the secondary app windows (multiview, live timing, standalone player) on sign-out or when
 * the session expires: they would keep playing with a session that no longer exists. The main
 * window and non-app windows (the F1 sign-in window) are left alone.
 */
function closeSecondaryWindows() {
  const appUrl = getMainAppUrl();
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed() || w === mainWindow) continue;
    let url = '';
    try { url = w.webContents.getURL(); } catch (_) {}
    if (!isAppNavigation(url, appUrl)) continue;
    try { w.close(); } catch (_) {}
  }
}

module.exports = {
  liveTimingListenerCount,
  closeSecondaryWindows,
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
  broadcastVideoSeekRequest,
  registerLiveTimingBroadcastTarget,
  unregisterLiveTimingBroadcastTarget,
  openCustomPlayerWindow,
  fitStandalonePlayerWindow,
};
