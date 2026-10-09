const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('devclean', {
  cleanup: (indices, token, automatic) => ipcRenderer.invoke('cleanup', indices, token, automatic === true),
  scan: () => ipcRenderer.invoke('scan'),
  reveal: index => ipcRenderer.invoke('reveal', index),
  exportReport: () => ipcRenderer.invoke('export'),
});
