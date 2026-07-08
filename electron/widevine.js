/** Widevine CDM discovery/configuration, applied before app.whenReady(). */

const path = require('path');
const fs = require('fs');
const { app, components } = require('electron');

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

/** castLabs' bundled-CDM path (components.whenReady) waits for the CDM download/install to finish. */
async function waitForWidevineReady() {
  if (components && typeof components.whenReady === 'function') {
    console.log('[Widevine] waiting for castLabs CDM…');
    await components.whenReady();
    console.log('[Widevine] castLabs CDM ready.');
  }
}

module.exports = { configureWidevineFromEnv, waitForWidevineReady };
