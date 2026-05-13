// IQTS Bridge — uniform API for both Electron (real hardware) and browser preview (mock).
// In packaged app, electron/preload.cjs exposes window.iqts with the real implementations.

import { formatPartId } from "./iqts-partid";

export type QualityStatus = "Conforme" | "Non-Conforme" | "Pending";

export interface PartRecord {
  id: number;
  partId: string;
  partRef: string;
  imagePath: string | null;
  imageDataUrl?: string | null;
  status: QualityStatus;
  capturedAt: number;
  station: string;
  operator: string;
  notes?: string | null;
}

export interface ProcessResult extends Partial<PartRecord> {
  ok: boolean;
  partId?: string;
  partRef?: string;
  printed?: boolean;
  skippedPrint?: boolean;
  printError?: string;
  error?: string;
}

export interface PrinterConfig {
  host: string;
  port: number;
}

export interface SystemConfig {
  watchFolder: string;
  processedFolder: string;
  printer: PrinterConfig;
  station: string;
  operator: string;
  imageWaitMs?: number;
  requireConformToPrint?: boolean;
  plc?: {
    listenHost?: string;
    listenPort?: number;
    enabled?: boolean;
    deviceHost?: string;
    devicePort?: number;
  };
}

export interface ConnectionProbe {
  host?: string;
  port?: number;
  ok: boolean;
  err?: string;
  latency?: number;
}

export interface ConnectionStatus {
  printer: ConnectionProbe;
  plc: ConnectionProbe;
  checkedAt: number;
}

export interface IQTSApi {
  isElectron: boolean;
  processPart(partRef: string): Promise<ProcessResult>;
  searchRecords(query: string): Promise<PartRecord[]>;
  listRecent(limit?: number): Promise<PartRecord[]>;
  getConfig(): Promise<SystemConfig>;
  setConfig(patch: Partial<SystemConfig>): Promise<SystemConfig>;
  checkConnections(): Promise<ConnectionStatus>;
  onPlcTrigger(cb: (partRef: string) => void): () => void;
  onPartProcessed(cb: (r: ProcessResult) => void): () => void;
  // Browser-preview helpers (not present in Electron build)
  mockPlcTrigger?(partRef: string): Promise<void>;
  mockSetNextImageStatus?(status: QualityStatus): void;
}

declare global {
  interface Window {
    iqts?: IQTSApi;
  }
}

// ---------- In-browser mock implementation ----------

const MOCK_KEY = "iqts.mock.v2";

interface MockState {
  records: PartRecord[];
  config: SystemConfig;
  nextId: number;
  nextImageStatus: QualityStatus;
}

const defaultConfig: SystemConfig = {
  watchFolder: "C:\\IQTS\\camera_in",
  processedFolder: "C:\\IQTS\\processed",
  printer: { host: "192.168.1.50", port: 9100 },
  station: "STATION-01",
  operator: "OP-001",
  imageWaitMs: 2000,
  requireConformToPrint: true,
};

function loadMock(): MockState {
  if (typeof localStorage === "undefined") {
    return { records: [], config: defaultConfig, nextId: 1, nextImageStatus: "Conforme" };
  }
  try {
    const raw = localStorage.getItem(MOCK_KEY);
    if (raw) return { nextImageStatus: "Conforme", ...JSON.parse(raw) };
  } catch {}
  return { records: [], config: defaultConfig, nextId: 1, nextImageStatus: "Conforme" };
}

function saveMock(state: MockState) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(MOCK_KEY, JSON.stringify(state));
}

const plcListeners = new Set<(partRef: string) => void>();
const processedListeners = new Set<(r: ProcessResult) => void>();

function makeFakeCapture(status: QualityStatus): string {
  if (typeof document === "undefined") return "";
  const c = document.createElement("canvas");
  c.width = 480;
  c.height = 360;
  const ctx = c.getContext("2d")!;
  const grad = ctx.createLinearGradient(0, 0, 480, 360);
  grad.addColorStop(0, "#cfd6df");
  grad.addColorStop(1, "#9aa4b2");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 480, 360);
  ctx.fillStyle = "#2b3340";
  ctx.fillRect(140, 110, 200, 140);
  ctx.strokeStyle = "#0a0d12";
  ctx.lineWidth = 3;
  ctx.strokeRect(140, 110, 200, 140);
  ctx.fillStyle = "#5b6776";
  for (const [x, y] of [[160, 130], [320, 130], [160, 230], [320, 230]] as const) {
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = status === "Conforme" ? "#16a34a" : status === "Non-Conforme" ? "#dc2626" : "#d97706";
  ctx.fillRect(0, 0, 480, 36);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 18px Inter, sans-serif";
  ctx.fillText(`IFM Vision · ${status}`, 12, 24);
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 330, 480, 30);
  ctx.fillStyle = "#fff";
  ctx.font = "12px JetBrains Mono, monospace";
  ctx.fillText(new Date().toISOString(), 12, 350);
  return c.toDataURL("image/jpeg", 0.85);
}

const mockApi: IQTSApi = {
  isElectron: false,

  async processPart(partRefRaw: string) {
    const partRef = String(partRefRaw || "").trim().toUpperCase();
    if (!partRef) return { ok: false, error: "Empty part reference" };

    const state = loadMock();
    const partId = formatPartId(partRef);
    const status = state.nextImageStatus;
    const imageDataUrl = makeFakeCapture(status);
    const requireConform = state.config.requireConformToPrint !== false;
    const shouldPrint = !requireConform || status === "Conforme";

    const record: PartRecord = {
      id: state.nextId++,
      partId,
      partRef,
      imagePath: `${state.config.processedFolder}\\${partId}.jpg`,
      imageDataUrl,
      status,
      capturedAt: Date.now(),
      station: state.config.station,
      operator: state.config.operator,
      notes: shouldPrint ? null : "Label not printed (Non-Conforme)",
    };
    state.records.unshift(record);
    saveMock(state);

    const result: ProcessResult = {
      ok: true,
      ...record,
      printed: false, // preview has no printer
      skippedPrint: !shouldPrint,
      printError: shouldPrint ? "Printer not connected (preview mode)" : undefined,
    };
    processedListeners.forEach((cb) => cb(result));
    return result;
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
  onPlcTrigger(cb) {
    plcListeners.add(cb);
    return () => { plcListeners.delete(cb); };
  },
  onPartProcessed(cb) {
    processedListeners.add(cb);
    return () => { processedListeners.delete(cb); };
  },
  async mockPlcTrigger(partRef: string) {
    plcListeners.forEach((cb) => cb(partRef));
  },
  mockSetNextImageStatus(status: QualityStatus) {
    const state = loadMock();
    state.nextImageStatus = status;
    saveMock(state);
  },
};

export function getBridge(): IQTSApi {
  if (typeof window !== "undefined" && window.iqts) return window.iqts;
  return mockApi;
}

export const isElectronEnv = (): boolean =>
  typeof window !== "undefined" && !!window.iqts?.isElectron;
