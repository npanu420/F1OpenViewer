/**
 * Preload for the player window: safely exposes IPC message receive (on) and send (send).
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('playerIpc', {
  on: (channel, callback) => {
    if (channel !== 'player:load') return;
    const fn = (_evt, ...args) => callback(...args);
    ipcRenderer.on(channel, fn);
    return () => ipcRenderer.removeListener(channel, fn);
  },
  send: (channel, ...args) => {
    const allowed = ['player:error', 'player:ready', 'player:closed'];
    if (allowed.includes(channel)) {
      ipcRenderer.send(channel, ...args);
    }
  },
  getLastLicenseError: () => ipcRenderer.invoke('player:getLastLicenseError'),
});
