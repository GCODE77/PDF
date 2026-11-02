const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  getInitialFile: () => ipcRenderer.invoke('initial-file'),
  onOpenFile: cb => ipcRenderer.on('open-file', (_e, f) => cb(f)),
});
