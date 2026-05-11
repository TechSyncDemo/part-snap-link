import { useEffect, useState } from "react";
import { Printer, Tag, Loader2, CheckCircle2, AlertTriangle, Radio } from "lucide-react";
import { getBridge } from "@/lib/iqts-bridge";
import { Button } from "@/components/ui/button";

const bridge = getBridge();

interface Props {
  partRef: string;
  onPartRefChange: (v: string) => void;
}

export function LabelGenerator({ partRef, onPartRefChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ partId: string; printed: boolean; error?: string; trigger?: "manual" | "plc" } | null>(null);
  const [plcArmed, setPlcArmed] = useState(true);

  async function generate(trigger: "manual" | "plc" = "manual", refOverride?: string) {
    const ref = (refOverride ?? partRef).trim().toUpperCase();
    if (!ref) return;
    setBusy(true);
    try {
      const res = await bridge.generateLabel(ref);
      setLast({ partId: res.partId, printed: res.printed, error: res.error, trigger });
    } finally {
      setBusy(false);
    }
  }

  // Listen for Siemens PLC print trigger
  useEffect(() => {
    const off = bridge.onPlcTrigger((triggeredRef) => {
      if (!plcArmed) return;
      const ref = (triggeredRef || partRef).trim().toUpperCase();
      if (ref) {
        if (triggeredRef) onPartRefChange(ref);
        void generate("plc", ref);
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plcArmed, partRef]);

  return (
    <div className="rounded-xl border bg-card shadow-industrial overflow-hidden">
      <div className="px-3 py-2 border-b bg-muted/40 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Tag className="h-4 w-4 text-primary" />
          <h3 className="text-xs font-semibold uppercase tracking-wider">Label Generation</h3>
        </div>
        <span className="text-[10px] text-muted-foreground font-mono">Zebra · TCP/9100</span>
      </div>
      <div className="p-3 space-y-3">
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Part Reference
          </label>
          <div className="mt-1 flex flex-col sm:flex-row gap-2">
            <input
              value={partRef}
              onChange={(e) => onPartRefChange(e.target.value.toUpperCase())}
              placeholder="e.g. PR-12345"
              className="flex-1 min-w-0 rounded-lg border-2 border-input bg-background px-3 py-2 text-base font-mono font-bold uppercase tracking-wider focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20"
              maxLength={32}
            />
            <Button
              onClick={() => void generate("manual")}
              disabled={busy || !partRef.trim()}
              className="px-4 font-semibold w-full sm:w-auto"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
              <span className="ml-2">Generate Label</span>
            </Button>
          </div>
        </div>

        {/* PLC trigger row */}
        <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-2.5 py-1.5">
          <div className="flex items-center gap-2">
            <Radio className={`h-4 w-4 ${plcArmed ? "text-success" : "text-muted-foreground"}`} />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider">Siemens PLC trigger</p>
              <p className="text-[11px] text-muted-foreground">
                {plcArmed ? "Armed — auto-print on PLC signal" : "Disarmed"}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={plcArmed ? "default" : "outline"}
              onClick={() => setPlcArmed((v) => !v)}
            >
              {plcArmed ? "Disarm" : "Arm"}
            </Button>
            {!bridge.isElectron && bridge.mockPlcTrigger && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => bridge.mockPlcTrigger?.(partRef.trim().toUpperCase())}
                disabled={!partRef.trim()}
              >
                Simulate PLC
              </Button>
            )}
          </div>
        </div>

        {last && (
          <div
            className={`rounded-lg border p-3 flex items-start gap-2 ${
              last.printed
                ? "border-success/30 bg-success/5"
                : "border-warning/40 bg-warning/5"
            }`}
          >
            {last.printed ? (
              <CheckCircle2 className="h-4 w-4 text-success flex-shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-warning flex-shrink-0 mt-0.5" style={{ color: "oklch(0.55 0.16 75)" }} />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">
                {last.printed ? "Label printed" : "Label staged"}
                {last.trigger === "plc" && (
                  <span className="ml-2 text-[10px] font-mono uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                    via PLC
                  </span>
                )}
              </p>
              <p className="text-xs font-mono text-muted-foreground truncate">{last.partId}</p>
              {last.error && <p className="text-xs text-muted-foreground mt-1">{last.error}</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
