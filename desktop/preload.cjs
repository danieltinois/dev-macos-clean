const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('devclean', {
  cleanup: (indices, token) => ipcRenderer.invoke('cleanup', indices, token),
  scan: () => ipcRenderer.invoke('scan'),
  reveal: index => ipcRenderer.invoke('reveal', index),
  exportReport: () => ipcRenderer.invoke('export'),
});
