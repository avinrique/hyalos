const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Existing event listeners
  onStatsData: (callback) => ipcRenderer.on('stats-data', (_event, data) => callback(data)),
  onPinStatus: (callback) => ipcRenderer.on('pin-status', (_event, pinned) => callback(pinned)),
  onGhostMode: (callback) => ipcRenderer.on('ghost-mode', (_event, active) => callback(active)),

  // Existing actions
  closeApp: () => ipcRenderer.send('close-app'),
  refreshData: () => ipcRenderer.send('refresh-data'),
  toggleExpand: (expanded) => ipcRenderer.send('toggle-expand', expanded),
  togglePin: () => ipcRenderer.send('toggle-pin'),

  // Auth (invoke-based)
  login: (email, password) => ipcRenderer.invoke('login', email, password),
  register: (email, password, name) => ipcRenderer.invoke('register', email, password, name),
  logout: () => ipcRenderer.invoke('logout'),
  getAuthState: () => ipcRenderer.invoke('getAuthState'),

  // Teams (invoke-based)
  getMyTeams: () => ipcRenderer.invoke('getMyTeams'),
  createTeam: (name) => ipcRenderer.invoke('createTeam', name),
  joinTeam: (code) => ipcRenderer.invoke('joinTeam', code),
  getTeamMembers: (teamId) => ipcRenderer.invoke('getTeamMembers', teamId),

  // Navigation
  openAdmin: () => ipcRenderer.invoke('openAdmin'),
});
