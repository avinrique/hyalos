const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onStatsData: (callback) => ipcRenderer.on('stats-data', (_event, data) => callback(data)),
  onPinStatus: (callback) => ipcRenderer.on('pin-status', (_event, pinned) => callback(pinned)),
  onGhostMode: (callback) => ipcRenderer.on('ghost-mode', (_event, active) => callback(active)),
  closeApp: () => ipcRenderer.send('close-app'),
  refreshData: () => ipcRenderer.send('refresh-data'),
  toggleExpand: (expanded) => ipcRenderer.send('toggle-expand', expanded),
  togglePin: () => ipcRenderer.send('toggle-pin'),
});
