/**
 * Preload per la finestra di login F1 (account.formula1.com).
 * Espone captureToken così lo script iniettato può inviare il JWT al main.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('f1openviewer', {
  captureToken: (token) => {
    if (token && typeof token === 'string') {
      ipcRenderer.send('f1:login-token', token);
    }
  },
});
