// IQTS Electron main process
// Runs on the Industrial PC. Provides:
//   • SQLite archive (better-sqlite3)
//   • Folder watcher for IFM camera output (chokidar)
//   • Zebra TCP/9100 raw ZPL printing (net.Socket)
//   • IPC handlers consumed by the React renderer through preload
//
// SECURITY: contextIsolation enabled, nodeIntegration disabled.

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const net = require("net");
const os = require("os");

// Lazy-loaded native deps — provided as optional dependencies.
let Database, chokidar;
try { Database = require("better-sqlite3"); } catch (e) { console.warn("[IQTS] better-sqlite3 not available:", e.message); }
try { chokidar = require("chokidar"); } catch (e) { console.warn("[IQTS] chokidar not available:", e.message); }

// ---------- Paths ----------
const userData = app.getPath("userData");
const dataDir = path.join(userData, "iqts");
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, "iqts.sqlite");
const configPath = path.join(dataDir, "config.json");

// ---------- Config ----------
const defaultConfig = {
  watchFolder: path.join(dataDir, "camera_in"),
  processedFolder: path.join(dataDir, "processed"),
  printer: { host: "192.168.1.50", port: 9100 },
  associationWindowMs: 5000,
  station: os.hostname() || "STATION-01",
  operator: "OP-001",
  // Siemens PLC trigger listener — PLC sends a TCP message with the part reference
  // to request label generation/printing. Format: plain text "<PART_REF>\n" or JSON
  // {"partRef":"PR-12345"}.
  plc: { listenHost: "0.0.0.0", listenPort: 9500, enabled: true },
};

function loadConfig() {
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    return { ...defaultConfig, ...JSON.parse(raw) };
  } catch {
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
    return defaultConfig;
  }
}
function saveConfig(cfg) {
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
}
let config = loadConfig();
fs.mkdirSync(config.watchFolder, { recursive: true });
fs.mkdirSync(config.processedFolder, { recursive: true });

// ---------- DB ----------
let db;
if (Database) {
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      partId TEXT NOT NULL UNIQUE,
      partRef TEXT NOT NULL,
      imagePath TEXT,
      status TEXT NOT NULL,
      capturedAt INTEGER NOT NULL,
      station TEXT NOT NULL,
      operator TEXT NOT NULL,
      notes TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_records_partRef ON records(partRef);
    CREATE INDEX IF NOT EXISTS idx_records_capturedAt ON records(capturedAt DESC);
  `);
}

// ---------- Folder watcher ----------
// Tracks pending captures (newest at end). Status parsed from filename (e.g. *_OK_*, *_NOK_*).
const pending = []; // { fullPath, filename, createdAt, status }

function parseStatus(filename) {
  const lower = filename.toLowerCase();
  if (/(_nok|_fail|_ko|nonconforme|non-conforme)/.test(lower)) return "Non-Conforme";
  if (/(_ok|_pass|conforme)/.test(lower)) return "Conforme";
  return "Pending";
}

let mainWindow = null;
function emitPending() {
  if (!mainWindow) return;
  const latest = pending.length ? pending[pending.length - 1] : null;
  mainWindow.webContents.send("iqts:pending", latest
    ? { filename: latest.filename, createdAt: latest.createdAt, status: latest.status }
    : null);
}

function startWatcher() {
  if (!chokidar) return;
  fs.mkdirSync(config.watchFolder, { recursive: true });
  const watcher = chokidar.watch(config.watchFolder, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
  });
  watcher.on("add", (fullPath) => {
    if (!/\.(jpe?g|png|bmp|tiff?)$/i.test(fullPath)) return;
    const filename = path.basename(fullPath);
    pending.push({
      fullPath,
      filename,
      createdAt: Date.now(),
      status: parseStatus(filename),
    });
    emitPending();
  });
  return watcher;
}
let watcher = startWatcher();

// ---------- Zebra printing ----------
function sendZpl(host, port, zpl) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok, err) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch {}
      resolve({ ok, err });
    };
    socket.setTimeout(3000);
    socket.on("timeout", () => finish(false, "Connection timeout"));
    socket.on("error", (e) => finish(false, e.message));
    socket.connect(port, host, () => {
      socket.write(zpl, "utf8", () => finish(true));
    });
  });
}

function formatPartId(partRef, date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const dd = pad(date.getDate());
  const mm = pad(date.getMonth() + 1);
  const yyyy = String(date.getFullYear());
  const hh = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${partRef}T${dd}${mm}${yyyy}_${hh}${mi}${ss}`;
}

function buildZpl(partRef, partId) {
  const ts = new Date().toLocaleString();
  return [
    "^XA",
    "^CI28",
    `^FO40,40^A0N,40,40^FD${partRef}^FS`,
    `^FO40,100^BQN,2,6^FDLA,${partId}^FS`,
    `^FO40,330^A0N,22,22^FD${ts}^FS`,
    "^XZ",
  ].join("\n");
}

async function generateAndPrintLabel(partRef) {
  const partId = formatPartId(partRef);
  const zpl = buildZpl(partRef, partId);
  const { ok, err } = await sendZpl(config.printer.host, config.printer.port, zpl);
  return { partId, zpl, printed: ok, error: ok ? undefined : err };
}

// ---------- Siemens PLC trigger listener ----------
// Raw TCP server. PLC opens a socket and writes either:
//   - plain text:  "PR-12345\n"
//   - JSON line:   '{"partRef":"PR-12345"}\n'
// On receipt the renderer is notified ("iqts:plcTrigger") and a label is auto-printed.
let plcServer = null;
function startPlcServer() {
  if (!config.plc?.enabled) return;
  try {
    plcServer = net.createServer((socket) => {
      let buf = "";
      socket.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          let partRef = line;
          try {
            const j = JSON.parse(line);
            if (j && typeof j.partRef === "string") partRef = j.partRef;
          } catch {}
          partRef = String(partRef).trim().toUpperCase();
          if (!partRef) continue;
          console.log(`[IQTS] PLC trigger: ${partRef}`);
          if (mainWindow) mainWindow.webContents.send("iqts:plcTrigger", partRef);
          generateAndPrintLabel(partRef)
            .then((r) => socket.write(`OK ${r.partId}\n`))
            .catch((e) => socket.write(`ERR ${e.message}\n`));
        }
      });
      socket.on("error", (e) => console.warn("[IQTS] PLC socket error:", e.message));
    });
    plcServer.on("error", (e) => console.warn("[IQTS] PLC server error:", e.message));
    plcServer.listen(config.plc.listenPort, config.plc.listenHost, () => {
      console.log(`[IQTS] PLC listener on ${config.plc.listenHost}:${config.plc.listenPort}`);
    });
  } catch (e) {
    console.warn("[IQTS] PLC listener failed to start:", e.message);
  }
}

// ---------- IPC handlers ----------
ipcMain.handle("iqts:getConfig", () => config);
ipcMain.handle("iqts:setConfig", (_e, patch) => {
  const oldFolder = config.watchFolder;
  config = { ...config, ...patch, printer: { ...config.printer, ...(patch?.printer || {}) } };
  saveConfig(config);
  if (config.watchFolder !== oldFolder) {
    if (watcher) watcher.close();
    pending.length = 0;
    watcher = startWatcher();
  }
  return config;
});

ipcMain.handle("iqts:generateLabel", async (_e, partRef) => {
  return generateAndPrintLabel(String(partRef).trim().toUpperCase());
});

ipcMain.handle("iqts:getPending", () => {
  const latest = pending.length ? pending[pending.length - 1] : null;
  return latest ? { filename: latest.filename, createdAt: latest.createdAt, status: latest.status } : null;
});

ipcMain.handle("iqts:associateScan", async (_e, partId) => {
  const now = Date.now();
  // pick latest within window
  let idx = -1;
  for (let i = pending.length - 1; i >= 0; i--) {
    if (now - pending[i].createdAt <= config.associationWindowMs * 6) { idx = i; break; }
  }
  if (idx === -1) return null;
  const img = pending.splice(idx, 1)[0];
  const partRef = String(partId).split("T")[0];
  const ext = path.extname(img.filename) || ".jpg";
  const destPath = path.join(config.processedFolder, `${partId}${ext}`);
  try {
    fs.mkdirSync(config.processedFolder, { recursive: true });
    fs.renameSync(img.fullPath, destPath);
  } catch (e) {
    console.error("[IQTS] move failed:", e.message);
  }
  emitPending();

  const record = {
    partId,
    partRef,
    imagePath: destPath,
    status: img.status,
    capturedAt: img.createdAt,
    station: config.station,
    operator: config.operator,
    notes: null,
  };
  if (db) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO records (partId, partRef, imagePath, status, capturedAt, station, operator, notes)
      VALUES (@partId, @partRef, @imagePath, @status, @capturedAt, @station, @operator, @notes)
    `);
    const info = stmt.run(record);
    return { id: info.lastInsertRowid, ...record, imageDataUrl: readAsDataUrl(destPath) };
  }
  return { id: 0, ...record, imageDataUrl: readAsDataUrl(destPath) };
});

function readAsDataUrl(p) {
  try {
    const buf = fs.readFileSync(p);
    const ext = (path.extname(p).slice(1) || "jpeg").toLowerCase();
    const mime = ext === "jpg" ? "jpeg" : ext;
    return `data:image/${mime};base64,${buf.toString("base64")}`;
  } catch { return null; }
}

ipcMain.handle("iqts:listRecent", (_e, limit = 50) => {
  if (!db) return [];
  const rows = db.prepare(`SELECT * FROM records ORDER BY capturedAt DESC LIMIT ?`).all(limit);
  return rows.map((r) => ({ ...r, imageDataUrl: readAsDataUrl(r.imagePath) }));
});

ipcMain.handle("iqts:searchRecords", (_e, query) => {
  if (!db) return [];
  const q = `%${String(query || "").toLowerCase()}%`;
  const rows = db.prepare(`
    SELECT * FROM records
    WHERE LOWER(partId) LIKE ? OR LOWER(partRef) LIKE ? OR LOWER(status) LIKE ?
    ORDER BY capturedAt DESC LIMIT 200
  `).all(q, q, q);
  return rows.map((r) => ({ ...r, imageDataUrl: readAsDataUrl(r.imagePath) }));
});

// ---------- Window ----------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: "#f5f7fa",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  const indexFile = path.join(__dirname, "..", "dist", "index.html");
  if (fs.existsSync(indexFile)) {
    mainWindow.loadFile(indexFile);
  } else {
    // Dev fallback (Vite dev server). Ignored in packaged app.
    mainWindow.loadURL(process.env.IQTS_DEV_URL || "http://localhost:8080");
  }

  mainWindow.on("closed", () => { mainWindow = null; });
}

app.whenReady().then(() => { createWindow(); startPlcServer(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
