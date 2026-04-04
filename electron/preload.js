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
  getLastLicenseError: () => ipcRenderer.invoke('player:getLastLicenseError'),
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
});

