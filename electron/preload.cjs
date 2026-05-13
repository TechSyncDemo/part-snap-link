// Preload — exposes a safe, minimal API surface to the renderer.
const { contextBridge, ipcRenderer } = require("electron");

const plcListeners = new Set();
const processedListeners = new Set();

ipcRenderer.on("iqts:plcTrigger", (_e, partRef) => {
  plcListeners.forEach((cb) => { try { cb(partRef); } catch (err) { console.error(err); } });
});
ipcRenderer.on("iqts:partProcessed", (_e, payload) => {
  processedListeners.forEach((cb) => { try { cb(payload); } catch (err) { console.error(err); } });
});

contextBridge.exposeInMainWorld("iqts", {
  isElectron: true,
  processPart: (partRef) => ipcRenderer.invoke("iqts:processPart", partRef),
  searchRecords: (q) => ipcRenderer.invoke("iqts:searchRecords", q),
  listRecent: (limit) => ipcRenderer.invoke("iqts:listRecent", limit),
  getConfig: () => ipcRenderer.invoke("iqts:getConfig"),
  setConfig: (patch) => ipcRenderer.invoke("iqts:setConfig", patch),
  checkConnections: () => ipcRenderer.invoke("iqts:checkConnections"),
  onPlcTrigger: (cb) => { plcListeners.add(cb); return () => plcListeners.delete(cb); },
  onPartProcessed: (cb) => { processedListeners.add(cb); return () => processedListeners.delete(cb); },
});
