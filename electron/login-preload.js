/**
 * Preload for the F1 login window (account.formula1.com).
 * Exposes captureToken so the injected script can send the JWT to main.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('f1openviewer', {
  captureToken: (token) => {
    if (token && typeof token === 'string') {
      ipcRenderer.send('f1:login-token', token);
    }
  },
});
