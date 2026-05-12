// IQTS Electron main process
// Flow: PLC trigger → generate Part ID → grab latest IFM image →
//       rename it to <PartID>.<ext> → if Conforme print Zebra label →
//       archive in SQLite → notify renderer.

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const net = require("net");
const os = require("os");

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
  station: os.hostname() || "STATION-01",
  operator: "OP-001",
  plc: { listenHost: "0.0.0.0", listenPort: 9500, enabled: true },
  // After PLC trigger, wait up to this many ms for a fresh IFM image to arrive
  // before falling back to the most recent existing file in the watch folder.
  imageWaitMs: 2000,
  // Only print Zebra label when image status is Conforme.
  requireConformToPrint: true,
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

// ---------- IFM folder watcher ----------
// Tracks recently-arrived images so we can match them quickly after a PLC trigger.
const recent = []; // { fullPath, filename, mtime, status }

function parseStatus(filename) {
  const lower = filename.toLowerCase();
  if (/(_nok|_fail|_ko|nonconforme|non-conforme)/.test(lower)) return "Non-Conforme";
  if (/(_ok|_pass|conforme)/.test(lower)) return "Conforme";
  return "Pending";
}

let mainWindow = null;
let lastNewFileResolver = null; // resolves with file info on next add

function startWatcher() {
  if (!chokidar) return null;
  fs.mkdirSync(config.watchFolder, { recursive: true });
  const watcher = chokidar.watch(config.watchFolder, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
  });
  watcher.on("add", (fullPath) => {
    if (!/\.(jpe?g|png|bmp|tiff?)$/i.test(fullPath)) return;
    const filename = path.basename(fullPath);
    let mtime = Date.now();
    try { mtime = fs.statSync(fullPath).mtimeMs; } catch {}
    const entry = { fullPath, filename, mtime, status: parseStatus(filename) };
    recent.push(entry);
    // keep buffer small
    if (recent.length > 50) recent.splice(0, recent.length - 50);
    if (lastNewFileResolver) {
      const r = lastNewFileResolver;
      lastNewFileResolver = null;
      r(entry);
    }
  });
  return watcher;
}
let watcher = startWatcher();

function newestExistingImage() {
  // First try buffered entries
  if (recent.length) return recent[recent.length - 1];
  // Fall back to scanning the watch folder
  try {
    const files = fs.readdirSync(config.watchFolder)
      .filter((f) => /\.(jpe?g|png|bmp|tiff?)$/i.test(f))
      .map((f) => {
        const full = path.join(config.watchFolder, f);
        let mtime = 0;
        try { mtime = fs.statSync(full).mtimeMs; } catch {}
        return { fullPath: full, filename: f, mtime, status: parseStatus(f) };
      })
      .sort((a, b) => b.mtime - a.mtime);
    return files[0] || null;
  } catch {
    return null;
  }
}

function waitForNewImage(timeoutMs) {
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      lastNewFileResolver = null;
      resolve(null);
    }, timeoutMs);
    lastNewFileResolver = (entry) => {
      clearTimeout(t);
      resolve(entry);
    };
  });
}

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

function readAsDataUrl(p) {
  try {
    const buf = fs.readFileSync(p);
    const ext = (path.extname(p).slice(1) || "jpeg").toLowerCase();
    const mime = ext === "jpg" ? "jpeg" : ext;
    return `data:image/${mime};base64,${buf.toString("base64")}`;
  } catch { return null; }
}

// ---------- Core: process a part ----------
// 1) generate partId  2) grab latest IFM image (waiting briefly for a fresh one)
// 3) rename to <partId>.<ext> in processedFolder
// 4) if Conforme → print  5) archive  6) emit event
async function processPart(partRefRaw) {
  const partRef = String(partRefRaw || "").trim().toUpperCase();
  if (!partRef) {
    return { ok: false, error: "Empty part reference" };
  }
  const partId = formatPartId(partRef);

  // Wait briefly for a fresh image. If one doesn't arrive, fall back to the
  // most recent file already on disk.
  let img = await waitForNewImage(config.imageWaitMs);
  if (!img) img = newestExistingImage();
  if (!img) {
    const payload = { ok: false, partId, partRef, error: "No image found in IFM folder" };
    if (mainWindow) mainWindow.webContents.send("iqts:partProcessed", payload);
    return payload;
  }

  // remove from in-memory buffer if present
  const idx = recent.findIndex((r) => r.fullPath === img.fullPath);
  if (idx >= 0) recent.splice(idx, 1);

  // Rename / move
  const ext = path.extname(img.filename) || ".jpg";
  const destPath = path.join(config.processedFolder, `${partId}${ext}`);
  try {
    fs.mkdirSync(config.processedFolder, { recursive: true });
    fs.renameSync(img.fullPath, destPath);
  } catch (e) {
    // fall back to copy + unlink (cross-volume)
    try {
      fs.copyFileSync(img.fullPath, destPath);
      fs.unlinkSync(img.fullPath);
    } catch (e2) {
      console.error("[IQTS] move failed:", e2.message);
    }
  }

  const status = img.status;
  const shouldPrint = !config.requireConformToPrint || status === "Conforme";
  let printed = false;
  let printError;
  if (shouldPrint) {
    const zpl = buildZpl(partRef, partId);
    const r = await sendZpl(config.printer.host, config.printer.port, zpl);
    printed = r.ok;
    printError = r.err;
  }

  const record = {
    partId,
    partRef,
    imagePath: destPath,
    status,
    capturedAt: img.mtime || Date.now(),
    station: config.station,
    operator: config.operator,
    notes: shouldPrint ? null : "Label not printed (Non-Conforme)",
  };

  let id = 0;
  if (db) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO records (partId, partRef, imagePath, status, capturedAt, station, operator, notes)
      VALUES (@partId, @partRef, @imagePath, @status, @capturedAt, @station, @operator, @notes)
    `);
    const info = stmt.run(record);
    id = info.lastInsertRowid;
  }

  const payload = {
    ok: true,
    id,
    ...record,
    imageDataUrl: readAsDataUrl(destPath),
    printed,
    printError,
    skippedPrint: !shouldPrint,
  };
  if (mainWindow) mainWindow.webContents.send("iqts:partProcessed", payload);
  return payload;
}

// ---------- Siemens PLC TCP listener ----------
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
          processPart(partRef)
            .then((r) => {
              if (!r.ok) socket.write(`ERR ${r.error}\n`);
              else if (r.skippedPrint) socket.write(`OK ${r.partId} NO_PRINT (NCR)\n`);
              else if (r.printed) socket.write(`OK ${r.partId} PRINTED\n`);
              else socket.write(`OK ${r.partId} PRINT_FAILED ${r.printError || ""}\n`);
            })
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

// ---------- IPC ----------
ipcMain.handle("iqts:getConfig", () => config);
ipcMain.handle("iqts:setConfig", (_e, patch) => {
  const oldFolder = config.watchFolder;
  config = { ...config, ...patch, printer: { ...config.printer, ...(patch?.printer || {}) } };
  saveConfig(config);
  if (config.watchFolder !== oldFolder) {
    if (watcher) watcher.close();
    recent.length = 0;
    watcher = startWatcher();
  }
  return config;
});

// Manual / UI-driven trigger (same as PLC)
ipcMain.handle("iqts:processPart", async (_e, partRef) => processPart(partRef));

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
    mainWindow.loadURL(process.env.IQTS_DEV_URL || "http://localhost:8080");
  }
  mainWindow.on("closed", () => { mainWindow = null; });
}

app.whenReady().then(() => { createWindow(); startPlcServer(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
