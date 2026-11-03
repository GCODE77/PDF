const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  getInitialFile: () => ipcRenderer.invoke('initial-file'),
  openDefaultApps: () => ipcRenderer.invoke('open-default-apps'),
  installUpdate: url => ipcRenderer.invoke('install-update', url),
  onUpdateProgress: cb => ipcRenderer.on('update-progress', (_e, p) => cb(p)),
  onOpenFile: cb => ipcRenderer.on('open-file', (_e, f) => cb(f)),
});
