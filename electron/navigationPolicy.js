/**
 * Which navigations an app window may perform. The windows run with relaxed web security (needed
 * for the F1 CDN/DRM requests), so they must never be steered to a foreign page: only the app's own
 * document (any hash/query) is allowed, everything else is blocked and new windows are denied.
 */

/** @returns {boolean} true when `target` is the app document itself (same file / same dev origin). */
function isAppNavigation(target, appUrl) {
  let t;
  let a;
  try {
    t = new URL(target);
    a = new URL(appUrl);
  } catch (_) {
    return false;
  }
  if (a.protocol === 'file:') {
    if (t.protocol !== 'file:') return false;
    try {
      return decodeURIComponent(t.pathname).toLowerCase() === decodeURIComponent(a.pathname).toLowerCase();
    } catch (_) {
      return false;
    }
  }
  return t.origin === a.origin;
}

/**
 * Chromium grants every permission by default in Electron, to every page (including the F1 login
 * page). The app needs only these; camera, microphone, geolocation, notifications, clipboard read,
 * external protocols etc. are denied.
 */
const ALLOWED_PERMISSIONS = new Set(['fullscreen', 'mediaKeySystem', 'clipboard-sanitized-write']);

function isPermissionAllowed(permission) {
  return ALLOWED_PERMISSIONS.has(permission);
}

/** Only plain https pages may load in the remote (F1 login / silent-refresh) windows. */
function isSafeRemoteUrl(target) {
  try {
    return new URL(target).protocol === 'https:';
  } catch (_) {
    return false;
  }
}

/**
 * Guards for windows that show REMOTE pages (the F1 sign-in window and the hidden silent-refresh
 * window). They share the default session, which holds the F1 cookies, and the app runs with the
 * Chromium sandbox disabled on Windows (Widevine CDM requirement), so they must not be steerable:
 *  - navigation/redirects only to https (no file:, custom protocols, javascript: etc.);
 *  - popups: denied, or (allowPopups, needed by SSO/captcha flows) only https and opened with the
 *    same locked-down webPreferences and the same guards.
 * Pure policy lives in isSafeRemoteUrl; `webContents` is an Electron WebContents.
 */
function hardenRemoteWebContents(webContents, { allowPopups = false } = {}) {
  const block = (event, legacyUrl) => {
    if (isSafeRemoteUrl(event?.url ?? legacyUrl)) return;
    event.preventDefault();
    console.warn('[security] blocked remote-window navigation to a non-https URL');
  };
  webContents.on('will-navigate', block);
  webContents.on('will-redirect', block);
  webContents.setWindowOpenHandler(({ url }) => {
    if (!allowPopups || !isSafeRemoteUrl(url)) return { action: 'deny' };
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
      },
    };
  });
  webContents.on('did-create-window', (child) => {
    hardenRemoteWebContents(child.webContents, { allowPopups: false });
  });
}

module.exports = { isAppNavigation, isPermissionAllowed, isSafeRemoteUrl, hardenRemoteWebContents };
