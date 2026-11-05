const path = require('path');
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (_) {}
const os = require('os');
const { app, BrowserWindow, Menu, session } = require('electron');

const widevine = require('./widevine');
const sessionState = require('./session');
const licenseProxy = require('./licenseProxy');
const livetiming = require('./livetiming');
const windows = require('./windows');
const updater = require('./updater');
const { setupIpc } = require('./ipc');
const { isPermissionAllowed } = require('./navigationPolicy');

// Log instead of dying (or showing Electron's modal error box) on a stray error in a callback.
process.on('uncaughtException', (e) => console.error('[main] uncaught exception:', e && e.stack ? e.stack : e));
process.on('unhandledRejection', (e) => console.error('[main] unhandled rejection:', e && e.stack ? e.stack : e));

widevine.configureWidevineFromEnv();

// On Windows avoid "Sandbox cannot access executable" which can block CDM/DRM
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('no-sandbox');
}

// Avoid "Unable to move the cache: Access denied" and "Gpu Cache Creation failed" on Windows:
// use a dedicated per-process cache directory and disable GPU shader disk cache
const cacheDir = path.join(os.tmpdir(), 'f1openviewer-cache', String(process.pid));
app.commandLine.appendSwitch('disk-cache-dir', cacheDir);
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

/**
 * Each launch uses %TEMP%/f1openviewer-cache/<pid> (see above) and nothing removed them, so every
 * launch left a Chromium cache behind. Delete the folders of processes that are no longer running.
 */
function pruneStaleCacheDirs() {
  const root = path.join(os.tmpdir(), 'f1openviewer-cache');
  const fs = require('fs');
  fs.promises.readdir(root).then((names) => {
    for (const name of names) {
      if (!/^\d+$/.test(name) || Number(name) === process.pid) continue;
      let alive = true;
      try { process.kill(Number(name), 0); } catch (e) { alive = e.code === 'EPERM'; }
      if (alive) continue;
      fs.promises.rm(path.join(root, name), { recursive: true, force: true }).catch(() => {});
    }
  }).catch(() => {});
}

// One instance per profile: two instances would race on the same session/cookie/settings files and
// on the license proxy ports. A second launch just focuses the running app.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const w = windows.getMainWindow();
    if (!w || w.isDestroyed()) return;
    if (w.isMinimized()) w.restore();
    w.focus();
  });
}

app.whenReady().then(async () => {
  if (!gotLock) return;
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(isPermissionAllowed(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => isPermissionAllowed(permission));
  // Don't hold the window for the CDM (up to 45 s on a fresh profile): start the wait now, playback
  // awaits it (ipc.js contentPlay).
  widevine.whenCdmReady();
  pruneStaleCacheDirs();
  livetiming.setCacheDir(path.join(app.getPath('userData'), 'livetiming-cache'));
  // The static timing archive requires the F1 TV subscription token (Bearer) since Nov 2026.
  livetiming.setAuthTokenProvider(() => sessionState.memSession.accessToken);
  licenseProxy.startLicenseProxy();
  licenseProxy.installWebRequestHooks();
  setupIpc();

  try {
    await sessionState.restoreSessionOnStartup();
  } catch (e) {
    console.warn('[main] session restore failed, continuing to the login screen:', e?.message);
  }
  sessionState.startProactiveRefreshLoop();

  Menu.setApplicationMenu(null);

  windows.createWindow();
  // Not startup-critical, so delay it past the initial load/session-restore burst.
  setTimeout(() => { updater.checkForUpdate().catch(() => {}); }, 5000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) windows.createWindow();
  });
}).catch((e) => {
  // Whatever failed, never leave a running app without a window: it would also hold the
  // single-instance lock, so every relaunch would silently exit.
  console.error('[main] startup failed:', e && e.stack ? e.stack : e);
  if (gotLock && BrowserWindow.getAllWindows().length === 0) {
    try { windows.createWindow(); } catch (err) { console.error('[main] could not open the window:', err?.message); app.exit(1); }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
