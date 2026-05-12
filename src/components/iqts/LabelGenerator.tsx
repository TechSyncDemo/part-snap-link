import { useEffect, useState } from "react";
import { Radio, Loader2, CheckCircle2, XCircle, Play } from "lucide-react";
import { getBridge, type ProcessResult, type QualityStatus } from "@/lib/iqts-bridge";
import { Button } from "@/components/ui/button";

const bridge = getBridge();

interface Props {
  partRef: string;
  onPartRefChange: (v: string) => void;
  onProcessed: (r: ProcessResult) => void;
}

export function LabelGenerator({ partRef, onPartRefChange, onProcessed }: Props) {
  const [busy, setBusy] = useState(false);
  const [plcArmed, setPlcArmed] = useState(true);
  const [mockStatus, setMockStatus] = useState<QualityStatus>("Conforme");
  const [statusMsg, setStatusMsg] = useState<string>("Waiting for PLC end-of-operation signal…");

  async function trigger(ref: string, source: "manual" | "plc") {
    const partRef = ref.trim().toUpperCase();
    if (!partRef) return;
    setBusy(true);
    setStatusMsg(`${source === "plc" ? "PLC trigger" : "Manual trigger"} — generating label & fetching IFM image…`);
    try {
      const res = await bridge.processPart(partRef);
      onProcessed(res);
      if (!res.ok) {
        setStatusMsg(`Error: ${res.error}`);
      } else if (res.skippedPrint) {
        setStatusMsg(`${res.partId} archived. Label NOT printed (Non-Conforme).`);
      } else if (res.printed) {
        setStatusMsg(`${res.partId} printed & archived.`);
      } else {
        setStatusMsg(`${res.partId} archived. Print failed: ${res.printError ?? "unknown"}`);
      }
    } finally {
      setBusy(false);
    }
  }

  // Listen for Siemens PLC trigger
  useEffect(() => {
    const off = bridge.onPlcTrigger((triggeredRef) => {
      if (!plcArmed) return;
      const ref = (triggeredRef || partRef).trim().toUpperCase();
      if (ref) {
        if (triggeredRef) onPartRefChange(ref);
        // In Electron the main process already runs processPart; only run from
        // the renderer when in browser mock mode.
        if (!bridge.isElectron) void trigger(ref, "plc");
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plcArmed, partRef]);

  // In Electron, also listen for processed events triggered by the PLC (since
  // the renderer didn't initiate them).
  useEffect(() => {
    const off = bridge.onPartProcessed((res) => {
      onProcessed(res);
      if (!res.ok) setStatusMsg(`Error: ${res.error}`);
      else if (res.skippedPrint) setStatusMsg(`${res.partId} archived. Label NOT printed (Non-Conforme).`);
      else if (res.printed) setStatusMsg(`${res.partId} printed & archived.`);
      else setStatusMsg(`${res.partId} archived. Print failed: ${res.printError ?? "unknown"}`);
    });
    return off;
  }, [onProcessed]);

  return (
    <div className="rounded-xl border bg-card shadow-industrial overflow-hidden">
      <div className="px-3 py-2 border-b bg-muted/40 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio className={`h-4 w-4 ${plcArmed ? "text-success" : "text-muted-foreground"}`} />
          <h3 className="text-xs font-semibold uppercase tracking-wider">Operation Trigger</h3>
        </div>
        <span className="text-[10px] text-muted-foreground font-mono">PLC · TCP/9500</span>
      </div>
      <div className="p-3 space-y-3">
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Part Reference
          </label>
          <input
            value={partRef}
            onChange={(e) => onPartRefChange(e.target.value.toUpperCase())}
            placeholder="e.g. PR-12345"
            className="mt-1 w-full rounded-lg border-2 border-input bg-background px-3 py-2 text-base font-mono font-bold uppercase tracking-wider focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20"
            maxLength={32}
          />
        </div>

        <div className="rounded-lg border bg-muted/30 px-2.5 py-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider">PLC end-of-op</p>
            <p className="text-[11px] text-muted-foreground truncate">
              {plcArmed ? "Armed — auto-process on PLC signal" : "Disarmed"}
            </p>
          </div>
          <Button size="sm" variant={plcArmed ? "default" : "outline"} onClick={() => setPlcArmed((v) => !v)}>
            {plcArmed ? "Disarm" : "Arm"}
          </Button>
        </div>

        {/* Live status */}
        <div className="rounded-lg border bg-background px-2.5 py-2 flex items-start gap-2">
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary mt-0.5" />
          ) : (
            <Radio className="h-4 w-4 text-muted-foreground mt-0.5" />
          )}
          <p className="text-xs leading-snug">{statusMsg}</p>
        </div>

        {/* Browser-preview tools */}
        {!bridge.isElectron && (
          <div className="rounded-lg border border-dashed p-2.5 space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Preview · simulate end-of-operation
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={mockStatus === "Conforme" ? "default" : "outline"}
                className="h-7"
                onClick={() => { setMockStatus("Conforme"); bridge.mockSetNextImageStatus?.("Conforme"); }}
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Next: Pass
              </Button>
              <Button
                size="sm"
                variant={mockStatus === "Non-Conforme" ? "destructive" : "outline"}
                className="h-7"
                onClick={() => { setMockStatus("Non-Conforme"); bridge.mockSetNextImageStatus?.("Non-Conforme"); }}
              >
                <XCircle className="h-3.5 w-3.5 mr-1" /> Next: Fail
              </Button>
              <Button
                size="sm"
                className="h-7 ml-auto"
                disabled={busy || !partRef.trim()}
                onClick={() => bridge.mockPlcTrigger?.(partRef.trim().toUpperCase())}
              >
                <Play className="h-3.5 w-3.5 mr-1" /> Simulate PLC
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              In preview, Simulate PLC fires the trigger; "Next" picks the status of the synthetic IFM image.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
