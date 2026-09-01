const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('f1', {
  request: (req) => ipcRenderer.invoke('net:request', req),
  setSession: (s) => ipcRenderer.invoke('session:set', s),
  getSession: () => ipcRenderer.invoke('session:get'),
  clearSession: () => ipcRenderer.invoke('session:clear'),
  login: (email, password) => ipcRenderer.invoke('f1:login', email, password),
  loginWithToken: (tokenOrJson) => ipcRenderer.invoke('f1:loginWithToken', tokenOrJson),
  loginWithBrowser: () => ipcRenderer.invoke('f1:loginWithBrowser'),
  getLiveNow: () => ipcRenderer.invoke('f1:getLiveNow'),
  searchVod: (params) => ipcRenderer.invoke('f1:searchVod', params),
  getVodCatalog: () => ipcRenderer.invoke('f1:getVodCatalog'),
  getVodSeasons: () => ipcRenderer.invoke('f1:getVodSeasons'),
  getVodEvents: (seasonPageId) => ipcRenderer.invoke('f1:getVodEvents', seasonPageId),
  getVodSessions: (gpPageId) => ipcRenderer.invoke('f1:getVodSessions', gpPageId),
  getContentVideo: (contentId) => ipcRenderer.invoke('f1:getContentVideo', contentId),
  contentPlay: (contentId, channelId) => ipcRenderer.invoke('f1:contentPlay', contentId, channelId),
  openInF1TVWeb: (contentId, title, channelId) => ipcRenderer.invoke('f1:openInF1TVWeb', contentId, title, channelId),
  isF1Ready: () => ipcRenderer.invoke('f1:isReady'),
  restoreSession: () => ipcRenderer.invoke('f1:restoreSession'),
  fullReset: () => ipcRenderer.invoke('f1:fullReset'),
  /** Opens a GitHub release URL in the OS default browser. */
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  /** Main window only: fires once at startup if a newer GitHub release exists. */
  onUpdateAvailable: (callback) => {
    const handler = (_event, payload) => { try { callback(payload); } catch (_) {} };
    ipcRenderer.on('app:updateAvailable', handler);
    return () => ipcRenderer.removeListener('app:updateAvailable', handler);
  },
  /** Durable (userData-backed) mirror of a fixed allowlist of localStorage settings keys.
   *  Survives a manual reinstall to a different folder, unlike localStorage itself. */
  getAllSettings: () => ipcRenderer.invoke('settings:getAll'),
  setSetting: (key, value) => ipcRenderer.send('settings:set', key, value),
  getLastLicenseError: (streamKey) => ipcRenderer.invoke('player:getLastLicenseError', streamKey),
  /** Standalone player window: lock the window aspect ratio to the incoming video's. */
  reportIntrinsicVideoSize: (w, h) => ipcRenderer.send('player:intrinsicVideoSize', w, h),
  /** Standalone player window: main process asks the renderer to tear down the DRM
   *  player (Shaka/EME) before the window is actually destroyed, avoiding a native
   *  crash from killing the page mid-teardown. */
  onPlayerTeardownRequest: (callback) => {
    const handler = () => { try { callback(); } catch (_) {} };
    ipcRenderer.on('player:teardownRequest', handler);
    return () => ipcRenderer.removeListener('player:teardownRequest', handler);
  },
  openMultiviewWindow: () => ipcRenderer.invoke('multiview:openWindow'),
  getMultiviewWindows: () => ipcRenderer.invoke('multiview:listWindows'),
  onMultiviewWindowsChanged: (callback) => {
    const handler = (_event, payload) => {
      try {
        callback(payload);
      } catch (_) {}
    };
    ipcRenderer.on('multiview:windowsChanged', handler);
    return () => ipcRenderer.removeListener('multiview:windowsChanged', handler);
  },
  closeMultiviewWindow: () => ipcRenderer.invoke('multiview:closeWindow'),
  liveTiming: {
    resolveSession: (year, query) => ipcRenderer.invoke('livetiming:resolveSession', year, query),
    loadSession: (path, feeds) => ipcRenderer.invoke('livetiming:loadSession', path, feeds),
    getSyncData: (meetingKey, sessionKey) => ipcRenderer.invoke('livetiming:getSyncData', meetingKey, sessionKey),
    getAudio: (sessionPath, clipPath) => ipcRenderer.invoke('livetiming:getAudio', sessionPath, clipPath),
    openWindow: (opts) => ipcRenderer.invoke('livetiming:openWindow', opts),
    /** In-window dock: subscribe to live-timing IPC without opening a popout. */
    dockRegister: () => ipcRenderer.invoke('livetiming:dockRegister'),
    dockUnregister: () => ipcRenderer.invoke('livetiming:dockUnregister'),
    /** Starts (or attaches to) the shared live SignalR connection for this window. */
    liveStart: (opts) => ipcRenderer.invoke('livetiming:liveStart', opts),
    liveStop: () => ipcRenderer.invoke('livetiming:liveStop'),
    /** Live feed records: {feed, data}, same shape replay records feed into the reducer. */
    onLiveUpdate: (callback) => {
      const handler = (_event, payload) => { try { callback(payload); } catch (_) {} };
      ipcRenderer.on('livetiming:liveUpdate', handler);
      return () => ipcRenderer.removeListener('livetiming:liveUpdate', handler);
    },
    onLiveStatus: (callback) => {
      const handler = (_event, payload) => { try { callback(payload); } catch (_) {} };
      ipcRenderer.on('livetiming:liveStatus', handler);
      return () => ipcRenderer.removeListener('livetiming:liveStatus', handler);
    },
    /** Source window: publish the main-feed video clock for live-timing sync. */
    reportClock: (payload) => ipcRenderer.send('livetiming:reportClock', payload),
    /** Timing window: subscribe to the relayed video clock. Returns an unsubscribe fn. */
    onClock: (callback) => {
      const handler = (_event, payload) => { try { callback(payload); } catch (_) {} };
      ipcRenderer.on('livetiming:clock', handler);
      return () => ipcRenderer.removeListener('livetiming:clock', handler);
    },
    requestSeek: (payload) => ipcRenderer.send('livetiming:requestSeek', payload),
    onSeekRequest: (callback) => {
      const handler = (_event, payload) => { try { callback(payload); } catch (_) {} };
      ipcRenderer.on('livetiming:seekRequest', handler);
      return () => ipcRenderer.removeListener('livetiming:seekRequest', handler);
    },
  },
});

