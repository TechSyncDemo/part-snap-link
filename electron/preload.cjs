// Preload — exposes a safe, minimal API surface to the renderer.
const { contextBridge, ipcRenderer } = require("electron");

const listeners = new Set();
ipcRenderer.on("iqts:pending", (_e, payload) => {
  listeners.forEach((cb) => {
    try { cb(payload); } catch (err) { console.error(err); }
  });
});

contextBridge.exposeInMainWorld("iqts", {
  isElectron: true,
  generateLabel: (partRef) => ipcRenderer.invoke("iqts:generateLabel", partRef),
  associateScan: (partId) => ipcRenderer.invoke("iqts:associateScan", partId),
  searchRecords: (q) => ipcRenderer.invoke("iqts:searchRecords", q),
  listRecent: (limit) => ipcRenderer.invoke("iqts:listRecent", limit),
  getConfig: () => ipcRenderer.invoke("iqts:getConfig"),
  setConfig: (patch) => ipcRenderer.invoke("iqts:setConfig", patch),
  getPending: () => ipcRenderer.invoke("iqts:getPending"),
  onPendingChange: (cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
});
