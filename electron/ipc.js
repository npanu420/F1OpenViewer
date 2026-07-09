/** Wires every ipcMain handler the renderer/preload talk to. Pure glue over the other modules. */

const fs = require('fs');
const { ipcMain, BrowserWindow, shell, session } = require('electron');
const axios = require('axios');
const f1tv = require('./f1tv-bridge');
const livetiming = require('./livetiming');
const sessionState = require('./session');
const licenseProxy = require('./licenseProxy');
const windows = require('./windows');
const { openLoginWindow } = require('./loginWindow');
const { hasFormula1Host } = require('./util');

const { memSession } = sessionState;

function setupIpc() {
  ipcMain.handle('session:get', async () => ({ accessToken: memSession.accessToken }));
  ipcMain.handle('session:set', async (_evt, s) => {
    const token = s && typeof s.accessToken === 'string' ? s.accessToken : undefined;
    memSession.accessToken = token;
    sessionState.persistSession(token);
  });
  ipcMain.handle('session:clear', async () => {
    licenseProxy.clearStreams();
    await sessionState.clearSessionAndCookies();
  });

  ipcMain.handle('f1:login', async (_evt, email, password) => {
    const { subscriptionToken } = await f1tv.login(email, password);
    await f1tv.initClient(subscriptionToken);
    memSession.accessToken = subscriptionToken;
    sessionState.persistSession(subscriptionToken);
    return { accessToken: subscriptionToken };
  });
  ipcMain.handle('f1:loginWithToken', async (_evt, tokenOrJson) => {
    const { subscriptionToken } = f1tv.loginWithToken(tokenOrJson);
    await f1tv.initClient(subscriptionToken);
    memSession.accessToken = subscriptionToken;
    sessionState.persistSession(subscriptionToken);
    return { accessToken: subscriptionToken };
  });
  ipcMain.handle('f1:loginWithBrowser', async () => {
    const raw = await openLoginWindow();
    const { subscriptionToken } = f1tv.loginWithToken(raw);
    await f1tv.initClient(subscriptionToken);
    memSession.accessToken = subscriptionToken;
    sessionState.persistSession(subscriptionToken);
    return { accessToken: subscriptionToken };
  });
  ipcMain.handle('f1:restoreSession', async () => {
    if (f1tv.isClientReady) return { accessToken: memSession.accessToken, restored: true };
    const token = memSession.accessToken || sessionState.loadPersistedSession();
    if (token && !sessionState.isTokenExpired(token)) {
      try {
        await f1tv.initClient(token);
        memSession.accessToken = token;
        return { accessToken: token, restored: true };
      } catch (e) {
        console.warn('[session] restore failed, trying silent refresh:', e?.message);
      }
    } else if (token) {
      console.warn('[session] persisted token expired (jwt exp), attempting silent refresh…');
    }
    // Persisted token missing/expired/rejected: try to recover from persisted F1 cookies.
    // Skip when there is no trace of a previous login (avoids a pointless hidden window).
    if (!token && !fs.existsSync(sessionState.getCookiesFilePath())) return { accessToken: null, restored: false };
    const fresh = await sessionState.silentTokenRefresh();
    if (fresh) return { accessToken: fresh, restored: true };
    sessionState.persistSession(null);
    memSession.accessToken = undefined;
    return { accessToken: null, restored: false };
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
          await sessionState.refreshSessionBeforePlayback();
        }
        return f1tv.contentPlay(contentId, channelId);
      })
      .then((result) => {
        f1tv.setPlaybackEntitlementOverride(result?.licenseEntitlementToken || null);
        if (result?.playToken) {
          // Cookie write is optional; some pipelines need it for segment fetches.
          // The proxy itself uses the per-stream playToken from the registry, not this cookie.
          const cdnOrigins = ['https://f1tv.formula1.com', 'https://ott-video-fer-cf.formula1.com', 'https://ott-video-cf.formula1.com'];
          for (const origin of cdnOrigins) {
            session.defaultSession.cookies.set({ url: origin, name: 'playToken', value: result.playToken, path: '/' }).catch(() => {});
          }
        }
        if (result?.licenseUrl && result.licenseUrl.startsWith('https://') && hasFormula1Host(result.licenseUrl)) {
          const streamKey = licenseProxy.buildStreamKey(result.contentId ?? contentId, result.channelId ?? channelId);
          const proxied = licenseProxy.registerLicenseStream(streamKey, result);
          if (proxied) result.licenseUrl = proxied;
        }
        return result;
      })
      .then((result) => new Promise((resolve) => setTimeout(() => resolve(result), CONTENT_PLAY_DELAY_MS)));
    return contentPlayQueue;
  });
  ipcMain.handle('f1:openInF1TVWeb', async (_evt, contentId, title, channelId) => {
    await windows.openCustomPlayerWindow(contentId, title, channelId);
  });
  ipcMain.handle('f1:isReady', () => f1tv.isClientReady);
  ipcMain.handle('f1:fullReset', async () => {
    licenseProxy.clearStreams();
    await sessionState.resetSessionAndStorage();
    return { ok: true };
  });
  ipcMain.handle('app:openExternal', (_evt, url) => {
    if (typeof url === 'string' && /^https:\/\/github\.com\//.test(url)) shell.openExternal(url);
  });
  ipcMain.handle('settings:getAll', () => sessionState.loadPersistedSettings());
  ipcMain.on('settings:set', (_evt, key, value) => {
    if (typeof key === 'string' && typeof value === 'string') sessionState.persistSettingsKey(key, value);
  });
  ipcMain.handle('player:getLastLicenseError', (_evt, streamKey) => licenseProxy.getLastLicenseError(streamKey));

  ipcMain.on('player:resetAspect', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win && !win.isDestroyed()) win.setAspectRatio(0);
  });
  ipcMain.on('player:intrinsicVideoSize', (e, w, h) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win.isDestroyed()) return;
    windows.fitStandalonePlayerWindow(win, w, h);
  });

  // ----- Live Timing (separate public feed; no DRM) -----
  ipcMain.handle('livetiming:resolveSession', async (_evt, year, query) =>
    livetiming.resolveSessionPath(year, query)
  );
  ipcMain.handle('livetiming:loadSession', async (_evt, sessionPath, feeds) =>
    livetiming.loadSession(sessionPath, feeds)
  );
  // Relays the main feed's video clock to every open live-timing window so they can sync to it.
  ipcMain.on('livetiming:reportClock', (_evt, payload) => windows.broadcastLiveTimingClock(payload));
  ipcMain.handle('livetiming:getSyncData', async (_evt, meetingKey, sessionKey) =>
    livetiming.fetchSyncData(meetingKey, sessionKey)
  );
  // Team radio mp3s hit the same VPN split-tunnel wall as the archive feeds, so this proxies
  // through curl too instead of letting the renderer's <audio> tag hit the CDN directly, which
  // would just sit there unable to reach it.
  ipcMain.handle('livetiming:getAudio', async (_evt, sessionPath, clipPath) =>
    livetiming.fetchTeamRadioClip(sessionPath, clipPath)
  );

  // Subset of live-timing windows currently in live (SignalR) mode. The connection is shared
  // across all of them, refcounted here so it drops as soon as the last live-mode window closes.
  const liveTimingLiveWindows = new Set();
  function stopLiveTimingIfUnused() {
    if (liveTimingLiveWindows.size === 0) livetiming.disconnectLiveSocket();
  }

  // Starts (or attaches to) the shared SignalR live connection. Resolves the archive Path too
  // (cheap Index.json lookup) purely so the window can build team-radio audio URLs. The radio
  // clips themselves stream in live via TeamRadio records, same as replay.
  ipcMain.handle('livetiming:liveStart', async (evt, opts = {}) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    if (win) {
      liveTimingLiveWindows.add(win);
      win.once('closed', () => {
        liveTimingLiveWindows.delete(win);
        stopLiveTimingIfUnused();
      });
    }
    let path = null;
    try {
      const year = opts.year || new Date().getFullYear();
      const found = await livetiming.resolveSessionPath(year, opts);
      path = found ? found.path : null;
    } catch (_) {
      // Archive not resolvable yet (session still in progress). Live feed still works, just
      // no radio audio URL until it is.
    }
    const token = f1tv.ascendonToken;
    if (!token) return { path, hasToken: false };
    livetiming
      .connectLiveSocket(token, livetiming.DEFAULT_FEEDS, windows.broadcastLiveTimingUpdate, windows.broadcastLiveTimingStatus)
      .catch((e) => windows.broadcastLiveTimingStatus('error', e?.message));
    return { path, hasToken: true };
  });
  ipcMain.handle('livetiming:liveStop', async (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    if (win) liveTimingLiveWindows.delete(win);
    stopLiveTimingIfUnused();
    return { ok: true };
  });
  ipcMain.handle('livetiming:openWindow', async (_evt, opts = {}) => {
    // Opens right away and lets the window resolve the path and fetch its own sync data, so the
    // click never waits on a network round trip and never freezes the UI. Any failure just shows
    // up in that window's own loading state.
    windows.createLiveTimingWindow(opts);
    return { ok: true };
  });
  // In-window dock: same broadcast list as a popout, no extra window.
  ipcMain.handle('livetiming:dockRegister', (evt) => {
    windows.registerLiveTimingBroadcastTarget(BrowserWindow.fromWebContents(evt.sender));
    return { ok: true };
  });
  ipcMain.handle('livetiming:dockUnregister', (evt) => {
    windows.unregisterLiveTimingBroadcastTarget(BrowserWindow.fromWebContents(evt.sender));
    return { ok: true };
  });

  ipcMain.handle('multiview:openWindow', () => {
    const { id } = windows.createMultiviewWindow();
    return { id };
  });
  ipcMain.handle('multiview:listWindows', () => windows.listMultiviewWindowIds());
  ipcMain.handle('multiview:closeWindow', (evt) => {
    windows.closeMultiviewWindowFor(evt.sender);
  });

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

module.exports = { setupIpc };
