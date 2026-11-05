/** Wires every ipcMain handler the renderer/preload talk to. Pure glue over the other modules. */

const fs = require('fs');
const { ipcMain, BrowserWindow, shell, session } = require('electron');
const f1tv = require('./f1tv-bridge');
const livetiming = require('./livetiming');
const sessionState = require('./session');
const widevine = require('./widevine');
const licenseProxy = require('./licenseProxy');
const windows = require('./windows');
const { openLoginWindow } = require('./loginWindow');
const { hasFormula1Host, isOfflineError, toPositiveInt, rendererPlayback, sanitizeSearchParams, isAllowedExternalUrl } = require('./util');
const { isAppNavigation } = require('./navigationPolicy');

const { memSession } = sessionState;

/**
 * Only documents of this app may use the bridge. The preload is only attached to app windows and
 * their navigation is locked, so this is defence in depth against a frame or navigation that slips
 * through (Electron security checklist: validate the sender of every IPC message).
 */
function isTrustedSender(evt) {
  const url = evt && evt.senderFrame && evt.senderFrame.url;
  return !!url && isAppNavigation(url, windows.getMainAppUrl());
}

function handle(channel, fn) {
  ipcMain.handle(channel, (evt, ...args) => {
    if (!isTrustedSender(evt)) {
      console.warn('[ipc] rejected', channel, 'from untrusted sender');
      throw new Error('Untrusted sender');
    }
    return fn(evt, ...args);
  });
}

function on(channel, fn) {
  ipcMain.on(channel, (evt, ...args) => {
    if (!isTrustedSender(evt)) {
      console.warn('[ipc] ignored', channel, 'from untrusted sender');
      return;
    }
    fn(evt, ...args);
  });
}

/** The renderer never receives the account token: it only needs to know whether a session exists. */
function completeLogin(subscriptionToken) {
  memSession.accessToken = subscriptionToken;
  sessionState.persistSession(subscriptionToken);
  return { signedIn: true };
}

function setupIpc() {
  handle('session:get', async () => ({ signedIn: !!memSession.accessToken }));
  handle('session:clear', async () => {
    windows.closeSecondaryWindows();
    f1tv.clearCatalogCache();
    licenseProxy.clearStreams();
    await sessionState.clearSessionAndCookies();
  });
  // F1 rejected the saved session mid-use: close the popouts and send the main window to sign-in.
  sessionState.sessionEvents.on('expired', () => {
    windows.closeSecondaryWindows();
    licenseProxy.clearStreams();
    const main = windows.getMainWindow();
    if (main && !main.isDestroyed()) main.webContents.send('session:expired');
  });

  handle('f1:login', async (_evt, email, password) => {
    const { subscriptionToken } = await f1tv.login(email, password);
    await sessionState.initClientWithRetry(subscriptionToken);
    return completeLogin(subscriptionToken);
  });
  handle('f1:loginWithToken', async (_evt, tokenOrJson) => {
    const { subscriptionToken } = f1tv.loginWithToken(tokenOrJson);
    await sessionState.initClientWithRetry(subscriptionToken);
    return completeLogin(subscriptionToken);
  });
  handle('f1:loginWithBrowser', async (evt) => {
    try {
      const subscriptionToken = await openLoginWindow(async (raw) => {
        const { subscriptionToken: token } = f1tv.loginWithToken(raw);
        await sessionState.initClientWithRetry(token);
        return token;
      }, (message) => {
        if (!evt.sender.isDestroyed()) evt.sender.send('f1:loginValidationError', message);
      });
      console.log('[login] browser sign-in completed and app session initialized');
      return completeLogin(subscriptionToken);
    } catch (e) {
      console.warn('[login] browser sign-in failed:', e?.message);
      throw e;
    }
  });
  handle('f1:restoreSession', async () => {
    if (f1tv.isClientReady) return { restored: true };
    const token = memSession.accessToken || sessionState.loadPersistedSession();
    let restoreErr = null;
    if (token && !sessionState.isTokenExpired(token)) {
      try {
        await sessionState.initClientWithRetry(token);
        memSession.accessToken = token;
        return { restored: true };
      } catch (e) {
        restoreErr = e;
        if (f1tv.isClientReady) return { restored: true };
        // Offline: no point opening the slow hidden window, and keep the saved session. Other
        // transient failures (e.g. an init timeout) still try the refresh below; the session is kept
        // either way unless the failure is a real auth one (dropSessionUnlessRecoverable).
        if (isOfflineError(e)) {
          sessionState.dropSessionUnlessRecoverable(e);
          return { restored: false, offline: true }; // renderer shows "can't reach F1 TV, retry"
        }
        console.warn('[session] restore failed, trying silent refresh:', e?.message);
      }
    } else if (token) {
      console.warn('[session] persisted token expired (jwt exp), attempting silent refresh…');
    }
    // Persisted token missing/expired/rejected: try to recover from persisted F1 cookies.
    // Skip when there is no trace of a previous login (avoids a pointless hidden window).
    if (!token && !fs.existsSync(sessionState.getCookiesFilePath())) return { restored: false };
    const fresh = await sessionState.silentTokenRefresh();
    if (fresh || f1tv.isClientReady) return { restored: true };
    sessionState.dropSessionUnlessRecoverable(restoreErr);
    return { restored: false };
  });
  handle('f1:getLiveNow', async () => f1tv.getLiveNow());
  // Forwarded as query params of an authenticated F1 request: only the known keys, short plain values.
  handle('f1:searchVod', async (_evt, params) => f1tv.searchVod(sanitizeSearchParams(params)));
  // Seasons are fetched on (re)load/Refresh only: drop the short-lived event/stream caches then.
  handle('f1:getVodSeasons', async () => {
    f1tv.clearCatalogCache();
    return f1tv.getVodSeasons();
  });
  // Ids end up in F1 API URL paths (requests that carry the account tokens): integers only.
  handle('f1:getVodEvents', async (_evt, seasonPageId) => f1tv.getVodEvents(toPositiveInt(seasonPageId, 'pageId')));
  handle('f1:getVodSessions', async (_evt, gpPageId) => f1tv.getVodSessions(toPositiveInt(gpPageId, 'pageId')));
  handle('f1:getContentVideo', async (_evt, contentId) => f1tv.getContentVideo(toPositiveInt(contentId, 'contentId')));

  // Serialize playback setup because client initialization resets shared state.
  // Add delay between requests to avoid CloudFront 403 "Request blocked" / "too much traffic" when opening many streams
  const CONTENT_PLAY_DELAY_MS = 450;
  let contentPlayQueue = Promise.resolve();
  handle('f1:contentPlay', async (_evt, rawContentId, rawChannelId) => {
    const contentId = toPositiveInt(rawContentId, 'contentId');
    const channelId = rawChannelId == null || rawChannelId === '' ? undefined : toPositiveInt(rawChannelId, 'channelId');
    const job = contentPlayQueue
      .catch(() => null)
      .then(async () => {
        // Startup no longer blocks on the CDM (window opens right away); playback needs it.
        await widevine.whenCdmReady();
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
        let proxied = false;
        if (result?.licenseUrl && result.licenseUrl.startsWith('https://') && hasFormula1Host(result.licenseUrl)) {
          const streamKey = licenseProxy.buildStreamKey(result.contentId ?? contentId, result.channelId ?? channelId);
          const proxyUrl = licenseProxy.registerLicenseStream(streamKey, result);
          if (proxyUrl) {
            result.licenseUrl = proxyUrl;
            proxied = true;
          }
        }
        return rendererPlayback(result, proxied);
      });
    // Space EVERY request, failed ones too: a batch of failures (e.g. region blocks) used to fire
    // back-to-back, which is exactly the burst the delay exists to avoid.
    const spaced = (v) => new Promise((resolve) => setTimeout(() => resolve(v), CONTENT_PLAY_DELAY_MS));
    contentPlayQueue = job.then(
      (result) => spaced(result),
      (err) => spaced(null).then(() => { throw err; })
    );
    return contentPlayQueue;
  });
  handle('f1:openInF1TVWeb', async (_evt, contentId, title, channelId) => {
    await windows.openCustomPlayerWindow(contentId, title, channelId);
  });
  handle('f1:isReady', () => f1tv.isClientReady);
  handle('f1:fullReset', async () => {
    windows.closeSecondaryWindows();
    f1tv.clearCatalogCache();
    licenseProxy.clearStreams();
    await sessionState.resetSessionAndStorage();
    livetiming.clearCache();
    return { ok: true };
  });
  handle('app:openExternal', (_evt, url) => {
    if (isAllowedExternalUrl(url)) shell.openExternal(url);
  });
  handle('settings:getAll', () => sessionState.loadPersistedSettings());
  on('settings:set', (_evt, key, value) => {
    if (typeof key === 'string' && typeof value === 'string') sessionState.persistSettingsKey(key, value);
  });
  handle('player:getLastLicenseError', (_evt, streamKey) => licenseProxy.getLastLicenseError(streamKey));

  on('player:intrinsicVideoSize', (e, w, h) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win.isDestroyed()) return;
    windows.fitStandalonePlayerWindow(win, w, h);
  });

  // ----- Live Timing (separate public feed; no DRM) -----
  handle('livetiming:resolveSession', async (_evt, year, query) => livetiming.resolveSessionPath(year, query));
  handle('livetiming:loadSession', async (_evt, sessionPath, feeds) => livetiming.loadSession(sessionPath, feeds));
  // Relays the main feed's video clock to every open live-timing window so they can sync to it.
  on('livetiming:reportClock', (_evt, payload) => windows.broadcastLiveTimingClock(payload));
  handle('livetiming:hasClockListeners', () => windows.liveTimingListenerCount() > 0);
  // Relays timing-bar seeks back to the video window.
  on('livetiming:requestSeek', (_evt, payload) => windows.broadcastVideoSeekRequest(payload));
  handle('livetiming:getSyncData', async (_evt, meetingKey, sessionKey) => livetiming.fetchSyncData(meetingKey, sessionKey));
  // Team radio mp3s hit the same VPN split-tunnel wall as the archive feeds, so this proxies
  // through curl too instead of letting the renderer's <audio> tag hit the CDN directly, which
  // would just sit there unable to reach it.
  handle('livetiming:getAudio', async (_evt, sessionPath, clipPath) => livetiming.fetchTeamRadioClip(sessionPath, clipPath));

  // Subset of live-timing windows currently in live (SignalR) mode. The connection is shared
  // across all of them, refcounted here so it drops as soon as the last live-mode window closes.
  const liveTimingLiveWindows = new Set();
  /** Windows whose 'closed' hook is already registered (liveStart can run again after liveStop). */
  const liveCloseHooked = new WeakSet();
  function stopLiveTimingIfUnused() {
    if (liveTimingLiveWindows.size === 0) livetiming.disconnectLiveSocket();
  }

  // Starts (or attaches to) the shared SignalR live connection. Resolves the archive Path too
  // (cheap Index.json lookup) purely so the window can build team-radio audio URLs. The radio
  // clips themselves stream in live via TeamRadio records, same as replay.
  handle('livetiming:liveStart', async (evt, opts = {}) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    if (win) {
      liveTimingLiveWindows.add(win);
      if (!liveCloseHooked.has(win)) {
        liveCloseHooked.add(win);
        win.once('closed', () => {
          liveTimingLiveWindows.delete(win);
          stopLiveTimingIfUnused();
        });
      }
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
    livetiming
      .connectLiveSocket(livetiming.DEFAULT_FEEDS, windows.broadcastLiveTimingUpdate, windows.broadcastLiveTimingStatus)
      .catch((e) => windows.broadcastLiveTimingStatus('error', e?.message));
    return { path };
  });
  handle('livetiming:liveStop', async (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    if (win) liveTimingLiveWindows.delete(win);
    stopLiveTimingIfUnused();
    return { ok: true };
  });
  handle('livetiming:openWindow', async (_evt, opts = {}) => {
    // Opens right away and lets the window resolve the path and fetch its own sync data, so the
    // click never waits on a network round trip and never freezes the UI. Any failure just shows
    // up in that window's own loading state.
    windows.createLiveTimingWindow(opts);
    return { ok: true };
  });
  // In-window dock: same broadcast list as a popout, no extra window.
  handle('livetiming:dockRegister', (evt) => {
    windows.registerLiveTimingBroadcastTarget(BrowserWindow.fromWebContents(evt.sender));
    return { ok: true };
  });
  handle('livetiming:dockUnregister', (evt) => {
    windows.unregisterLiveTimingBroadcastTarget(BrowserWindow.fromWebContents(evt.sender));
    return { ok: true };
  });

  handle('multiview:openWindow', () => {
    const { id } = windows.createMultiviewWindow();
    return { id };
  });
  handle('multiview:listWindows', () => windows.listMultiviewWindowIds());
  handle('multiview:closeWindow', (evt) => {
    windows.closeMultiviewWindowFor(evt.sender);
  });
}

module.exports = { setupIpc };
