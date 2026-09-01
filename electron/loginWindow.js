/** The "Sign in with browser" flow using F1's real page and its login-session cookie. */

const { BrowserWindow, session } = require('electron');
const {
  F1_LOGIN_URL,
  isTokenExpired,
  snapshotAndPersistCookies,
} = require('./session');
const { buildLoginUserAgent, tokenFromLoginSessionCookie } = require('./loginUtils');

const LOGIN_TIMEOUT_MS = 300000;
const COOKIE_SETTLE_MS = 500;
const LOGIN_WINDOW_UA = buildLoginUserAgent(process.versions.chrome);

function isFormula1Cookie(cookie) {
  return /(^|\.)formula1\.com$/i.test(cookie?.domain || '');
}

function openLoginWindow() {
  return new Promise((resolve, reject) => {
    let settled = false;
    let acceptingToken = false;
    const loginSession = session.defaultSession;
    let cookieListener = null;
    let timeout = null;
    const finish = (err, token) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (cookieListener) loginSession.cookies.off('changed', cookieListener);
      if (!loginWin.isDestroyed()) loginWin.close();
      if (err) reject(err);
      else resolve(token);
    };

    const loginWin = new BrowserWindow({
      width: 900,
      height: 700,
      title: 'Sign in to F1 TV',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    loginWin.webContents.setUserAgent(LOGIN_WINDOW_UA);

    timeout = setTimeout(() => {
      finish(new Error('Timeout: complete sign-in in the window within a few minutes.'));
    }, LOGIN_TIMEOUT_MS);

    const acceptToken = async (token, source) => {
      if (settled || acceptingToken || !token || isTokenExpired(token)) return false;
      acceptingToken = true;
      try {
        await new Promise((r) => setTimeout(r, COOKIE_SETTLE_MS));
        await snapshotAndPersistCookies();
        console.log('[login] subscription token captured from', source);
        finish(null, token);
        return true;
      } catch (e) {
        console.warn('[login] token persistence failed:', e?.message);
        acceptingToken = false;
        return false;
      }
    };

    const tokenFromCurrentCookies = async () => {
      const cookies = await loginSession.cookies.get({ name: 'login-session' });
      for (const cookie of cookies) {
        if (!isFormula1Cookie(cookie)) continue;
        const token = tokenFromLoginSessionCookie(cookie.value);
        if (token && await acceptToken(token, 'login-session cookie')) return true;
      }
      return false;
    };

    cookieListener = (_event, cookie, _cause, removed) => {
      if (removed || cookie.name !== 'login-session' || !isFormula1Cookie(cookie)) return;
      const token = tokenFromLoginSessionCookie(cookie.value);
      if (token) acceptToken(token, 'updated login-session cookie').catch(() => {});
    };
    loginSession.cookies.on('changed', cookieListener);

    loginWin.on('closed', () => {
      if (!settled) finish(new Error('Window closed without completing sign-in.'));
    });

    loginWin.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (isMainFrame && code !== -3) {
        console.warn('[login] page load failed:', code, description, url);
      }
    });

    tokenFromCurrentCookies()
      .then((reused) => {
        if (!reused && !settled) return loginWin.loadURL(F1_LOGIN_URL);
        return null;
      })
      .catch((e) => finish(e));
  });
}

module.exports = { openLoginWindow };
