// IQTS Bridge — uniform API for both Electron (real hardware) and browser preview (mock).
// In packaged app, electron/preload.cjs exposes window.iqts with the real implementations.

export type QualityStatus = "Conforme" | "Non-Conforme" | "Pending";

export interface PartRecord {
  id: number;
  partId: string;        // QR string, e.g. PR-12345_1714600000
  partRef: string;       // base reference (e.g. PR-12345)
  imagePath: string | null;
  imageDataUrl?: string | null; // for preview rendering
  status: QualityStatus;
  capturedAt: number;    // ms epoch
  station: string;
  operator: string;
  notes?: string | null;
}

export interface PrinterConfig {
  host: string;
  port: number;
}

export interface SystemConfig {
  watchFolder: string;
  processedFolder: string;
  printer: PrinterConfig;
  associationWindowMs: number;
  station: string;
  operator: string;
}

export interface IQTSApi {
  isElectron: boolean;
  generateLabel(partRef: string): Promise<{ partId: string; zpl: string; printed: boolean; error?: string }>;
  associateScan(partId: string): Promise<PartRecord | null>;
  searchRecords(query: string): Promise<PartRecord[]>;
  listRecent(limit?: number): Promise<PartRecord[]>;
  getConfig(): Promise<SystemConfig>;
  setConfig(patch: Partial<SystemConfig>): Promise<SystemConfig>;
  // demo only — simulates a fresh camera capture in mock mode
  mockCameraCapture?(status: QualityStatus): Promise<void>;
  onPendingChange(cb: (pending: { filename: string; createdAt: number; status: QualityStatus } | null) => void): () => void;
  getPending(): Promise<{ filename: string; createdAt: number; status: QualityStatus } | null>;
}

declare global {
  interface Window {
    iqts?: IQTSApi;
  }
}

// ---------- In-browser mock implementation ----------

interface MockImage {
  filename: string;
  createdAt: number;
  status: QualityStatus;
  dataUrl: string;
}

const MOCK_KEY = "iqts.mock.v1";

interface MockState {
  records: PartRecord[];
  pending: MockImage[];
  config: SystemConfig;
  nextId: number;
}

const defaultConfig: SystemConfig = {
  watchFolder: "C:\\IQTS\\camera_in",
  processedFolder: "C:\\IQTS\\processed",
  printer: { host: "192.168.1.50", port: 9100 },
  associationWindowMs: 5000,
  station: "STATION-01",
  operator: "OP-001",
};

function loadMock(): MockState {
  if (typeof localStorage === "undefined") {
    return { records: [], pending: [], config: defaultConfig, nextId: 1 };
  }
  try {
    const raw = localStorage.getItem(MOCK_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { records: [], pending: [], config: defaultConfig, nextId: 1 };
}

function saveMock(state: MockState) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(MOCK_KEY, JSON.stringify(state));
}

const listeners = new Set<(p: MockImage | null) => void>();

function emit(state: MockState) {
  const latest = state.pending.length ? state.pending[state.pending.length - 1] : null;
  listeners.forEach((cb) =>
    cb(latest ? { filename: latest.filename, createdAt: latest.createdAt, status: latest.status } : null),
  );
}

// Generate a small synthetic JPEG-ish image as a data URL (canvas-based)
function makeFakeCapture(status: QualityStatus): string {
  if (typeof document === "undefined") return "";
  const c = document.createElement("canvas");
  c.width = 480;
  c.height = 360;
  const ctx = c.getContext("2d")!;
  // industrial gray background
  const grad = ctx.createLinearGradient(0, 0, 480, 360);
  grad.addColorStop(0, "#cfd6df");
  grad.addColorStop(1, "#9aa4b2");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 480, 360);
  // mock "part"
  ctx.fillStyle = "#2b3340";
  ctx.fillRect(140, 110, 200, 140);
  ctx.strokeStyle = "#0a0d12";
  ctx.lineWidth = 3;
  ctx.strokeRect(140, 110, 200, 140);
  // bolts
  ctx.fillStyle = "#5b6776";
  for (const [x, y] of [[160, 130], [320, 130], [160, 230], [320, 230]] as const) {
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  // status banner
  ctx.fillStyle = status === "Conforme" ? "#16a34a" : status === "Non-Conforme" ? "#dc2626" : "#d97706";
  ctx.fillRect(0, 0, 480, 36);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 18px Inter, sans-serif";
  ctx.fillText(`IFM Vision · ${status}`, 12, 24);
  // timestamp
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 330, 480, 30);
  ctx.fillStyle = "#fff";
  ctx.font = "12px JetBrains Mono, monospace";
  ctx.fillText(new Date().toISOString(), 12, 350);
  return c.toDataURL("image/jpeg", 0.85);
}

const mockApi: IQTSApi = {
  isElectron: false,
  async generateLabel(partRef: string) {
    const ts = Math.floor(Date.now() / 1000);
    const partId = `${partRef}_${ts}`;
    const zpl =
      `^XA\n^FO50,50^A0N,40,40^FD${partRef}^FS\n` +
      `^FO50,110^BQN,2,6^FDLA,${partId}^FS\n` +
      `^FO50,330^A0N,22,22^FD${new Date().toLocaleString()}^FS\n^XZ`;
    return { partId, zpl, printed: false, error: "Printer not connected (preview mode)" };
  },
  async associateScan(partId: string) {
    const state = loadMock();
    const now = Date.now();
    // find latest pending within window
    const idx = [...state.pending]
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => now - p.createdAt <= state.config.associationWindowMs * 6) // generous in mock
      .pop();
    if (!idx) return null;
    const img = idx.p;
    state.pending.splice(idx.i, 1);
    const partRef = partId.split("_")[0] ?? partId;
    const record: PartRecord = {
      id: state.nextId++,
      partId,
      partRef,
      imagePath: `${state.config.processedFolder}\\${partId}.jpg`,
      imageDataUrl: img.dataUrl,
      status: img.status,
      capturedAt: img.createdAt,
      station: state.config.station,
      operator: state.config.operator,
      notes: null,
    };
    state.records.unshift(record);
    saveMock(state);
    emit(state);
    return record;
  },
  async searchRecords(query: string) {
    const { records } = loadMock();
    const q = query.trim().toLowerCase();
    if (!q) return records.slice(0, 50);
    return records.filter(
      (r) =>
        r.partId.toLowerCase().includes(q) ||
        r.partRef.toLowerCase().includes(q) ||
        r.status.toLowerCase().includes(q),
    );
  },
  async listRecent(limit = 20) {
    return loadMock().records.slice(0, limit);
  },
  async getConfig() {
    return loadMock().config;
  },
  async setConfig(patch) {
    const state = loadMock();
    state.config = { ...state.config, ...patch, printer: { ...state.config.printer, ...(patch.printer ?? {}) } };
    saveMock(state);
    return state.config;
  },
  async mockCameraCapture(status) {
    const state = loadMock();
    const filename = `capture_${Date.now()}.jpg`;
    state.pending.push({
      filename,
      createdAt: Date.now(),
      status,
      dataUrl: makeFakeCapture(status),
    });
    saveMock(state);
    emit(state);
  },
  onPendingChange(cb) {
    listeners.add(cb as (p: MockImage | null) => void);
    return () => listeners.delete(cb as (p: MockImage | null) => void);
  },
  async getPending() {
    const { pending } = loadMock();
    const latest = pending[pending.length - 1];
    return latest ? { filename: latest.filename, createdAt: latest.createdAt, status: latest.status } : null;
  },
};

export function getBridge(): IQTSApi {
  if (typeof window !== "undefined" && window.iqts) return window.iqts;
  return mockApi;
}

export const isElectronEnv = (): boolean =>
  typeof window !== "undefined" && !!window.iqts?.isElectron;
