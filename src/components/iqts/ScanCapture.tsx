import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, XCircle, Clock, ScanLine, Printer, AlertTriangle } from "lucide-react";
import { getBridge, type PartRecord, type QualityStatus } from "@/lib/iqts-bridge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const bridge = getBridge();

function StatusPill({ status }: { status: QualityStatus }) {
  const cls =
    status === "Conforme"
      ? "status-pill-pass"
      : status === "Non-Conforme"
        ? "status-pill-fail"
        : "status-pill-pending";
  const Icon = status === "Conforme" ? CheckCircle2 : status === "Non-Conforme" ? XCircle : Clock;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-wider", cls)}>
      <Icon className="h-3.5 w-3.5" />
      {status}
    </span>
  );
}

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

interface Props {
  partRef: string;
  onScanned: (record: PartRecord) => void;
  lastRecord: PartRecord | null;
}

export function ScanCapture({ partRef, onScanned, lastRecord }: Props) {
  const [pending, setPending] = useState<{ filename: string; createdAt: number; status: QualityStatus } | null>(null);
  const [scanInput, setScanInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bridge.getPending().then(setPending);
    const off = bridge.onPendingChange(setPending);
    return off;
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      if (document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        inputRef.current?.focus();
      }
    }, 800);
    return () => clearInterval(t);
  }, []);

  async function handleScan(qr: string) {
    setError(null);
    setBusy(true);
    try {
      const rec = await bridge.associateScan(qr);
      if (!rec) {
        setError(
          "No recent camera image found. Make sure the camera captured a snapshot before scanning, or trigger a mock capture below.",
        );
      } else {
        onScanned(rec);
      }
    } finally {
      setBusy(false);
      setScanInput("");
    }
  }

  async function mockCapture(status: QualityStatus) {
    if (!bridge.mockCameraCapture) return;
    await bridge.mockCameraCapture(status);
  }

  const ageSec = pending ? Math.max(0, Math.floor((Date.now() - pending.createdAt) / 1000)) : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Pending capture */}
      <div className="rounded-xl border bg-card shadow-industrial overflow-hidden">
        <div className="px-5 py-3 border-b bg-muted/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold uppercase tracking-wider">Camera Buffer</h3>
          </div>
          {pending ? (
            <span className="text-xs font-mono text-muted-foreground">age {ageSec}s</span>
          ) : (
            <span className="text-xs text-muted-foreground">idle</span>
          )}
        </div>
        <div className="p-5">
          {pending ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <code className="text-xs font-mono text-muted-foreground truncate">{pending.filename}</code>
                <StatusPill status={pending.status} />
              </div>
              <div className="rounded-lg border bg-muted/30 aspect-[4/3] flex items-center justify-center overflow-hidden">
                <div className="text-center">
                  <Camera className="h-10 w-10 mx-auto mb-2 text-muted-foreground/60" />
                  <p className="text-sm text-muted-foreground">Image awaiting scan</p>
                  <p className="text-xs text-muted-foreground mt-1 font-mono">{fmtTime(pending.createdAt)}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed aspect-[4/3] flex items-center justify-center">
              <div className="text-center">
                <Camera className="h-10 w-10 mx-auto mb-2 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">Waiting for IFM camera capture…</p>
              </div>
            </div>
          )}

          {!bridge.isElectron && (
            <div className="mt-4 pt-4 border-t">
              <p className="text-xs text-muted-foreground mb-2 font-medium">Preview mode — simulate camera</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="flex-1" onClick={() => mockCapture("Conforme")}>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1 text-success" />
                  Pass
                </Button>
                <Button size="sm" variant="outline" className="flex-1" onClick={() => mockCapture("Non-Conforme")}>
                  <XCircle className="h-3.5 w-3.5 mr-1 text-destructive" />
                  Fail
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Scanner */}
      <div className="rounded-xl border bg-card shadow-industrial overflow-hidden">
        <div className="px-5 py-3 border-b bg-muted/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ScanLine className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold uppercase tracking-wider">Scanner Input</h3>
          </div>
          <span className="text-xs text-muted-foreground">HID keyboard wedge</span>
        </div>
        <div className="p-5 space-y-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (scanInput.trim()) void handleScan(scanInput.trim());
            }}
          >
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Scan or type Part ID
            </label>
            <input
              ref={inputRef}
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              placeholder={partRef ? `${partRef}_…` : "Awaiting scan…"}
              className="mt-2 w-full rounded-lg border-2 border-input bg-background px-4 py-4 text-2xl font-mono font-bold tracking-wider focus:border-primary focus:outline-none focus:ring-4 focus:ring-ring/20"
              autoFocus
              disabled={busy}
            />
          </form>

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 flex gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
              <p className="text-destructive">{error}</p>
            </div>
          )}

          {lastRecord && (
            <div className="rounded-lg border bg-muted/30 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Last association
              </p>
              <div className="flex items-start gap-3">
                {lastRecord.imageDataUrl && (
                  <img
                    src={lastRecord.imageDataUrl}
                    alt={lastRecord.partId}
                    className="w-20 h-16 object-cover rounded border"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-mono text-muted-foreground truncate">{lastRecord.partId}</p>
                  <div className="mt-1">
                    <StatusPill status={lastRecord.status} />
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-start gap-2 text-xs text-muted-foreground border-t pt-3">
            <Printer className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
            <p>Scanner Enter-suffix triggers association with the latest image in the buffer.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
