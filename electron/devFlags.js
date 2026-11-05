/**
 * Developer switches (dev server URL, auto-open DevTools, relaxed CORS) only apply to unpackaged
 * runs (`npm run dev` / `electron .`). In a packaged build anyone who can set the environment of
 * the process could otherwise point the app at another page or loosen its network policy.
 * DevTools (F12) stay reachable in packaged builds only with F1OV_DEVTOOLS=1, for DRM debugging
 * of signed builds.
 */
const { app } = require('electron');

function isDevRun() {
  return !app.isPackaged;
}

/** process.env[name] in a dev run, undefined in a packaged build. */
function devEnv(name) {
  return isDevRun() ? process.env[name] : undefined;
}

function devToolsAllowed() {
  return isDevRun() || process.env.F1OV_DEVTOOLS === '1';
}

module.exports = { isDevRun, devEnv, devToolsAllowed };
