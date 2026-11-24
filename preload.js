const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petBridge', {
  sendAudio: (arrayBuffer) => ipcRenderer.send('audio', arrayBuffer),
  setIgnoreMouse: (ignore) => ipcRenderer.send('mouse-ignore', ignore),
  getCursor: () => ipcRenderer.invoke('cursor'),
  getStatus: () => ipcRenderer.invoke('get-status'),
  readAsset: (name) => ipcRenderer.invoke('read-asset', name),
  onTranscript: (cb) => ipcRenderer.on('transcript', (_e, m) => cb(m)),
  onStatus: (cb) => ipcRenderer.on('status', (_e, s) => cb(s)),
  onSettings: (cb) => ipcRenderer.on('settings', (_e, s) => cb(s)),
});
