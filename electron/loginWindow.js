/** The "Sign in with browser" flow: a real F1 login page in an isolated window, token sniffed via injected script. */

const path = require('path');
const { BrowserWindow, ipcMain, session } = require('electron');
const { F1_LOGIN_URL, FORMULA1_URLS, persistCookies } = require('./session');

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
        const exp = Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000);
        for (const baseUrl of FORMULA1_URLS) {
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

module.exports = { openLoginWindow };
