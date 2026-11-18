const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  getInitialFile: () => ipcRenderer.invoke('initial-file'),
  openDefaultApps: () => ipcRenderer.invoke('open-default-apps'),
  installUpdate: url => ipcRenderer.invoke('install-update', url),
  onUpdateProgress: cb => ipcRenderer.on('update-progress', (_e, p) => cb(p)),
  onDownloadDone: cb => ipcRenderer.on('download-done', (_e, d) => cb(d)),
  openPath: p => ipcRenderer.invoke('open-path', p),
  showInFolder: p => ipcRenderer.invoke('show-in-folder', p),
  onOpenFile: cb => ipcRenderer.on('open-file', (_e, f) => cb(f)),
});
