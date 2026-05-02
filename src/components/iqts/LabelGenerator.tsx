import { useState } from "react";
import { Printer, Tag, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { getBridge } from "@/lib/iqts-bridge";
import { Button } from "@/components/ui/button";

const bridge = getBridge();

interface Props {
  partRef: string;
  onPartRefChange: (v: string) => void;
}

export function LabelGenerator({ partRef, onPartRefChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ partId: string; printed: boolean; error?: string } | null>(null);

  async function generate() {
    if (!partRef.trim()) return;
    setBusy(true);
    try {
      const res = await bridge.generateLabel(partRef.trim().toUpperCase());
      setLast({ partId: res.partId, printed: res.printed, error: res.error });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border bg-card shadow-industrial overflow-hidden">
      <div className="px-5 py-3 border-b bg-muted/40 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Tag className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold uppercase tracking-wider">Label Generation</h3>
        </div>
        <span className="text-xs text-muted-foreground font-mono">Zebra · TCP/9100</span>
      </div>
      <div className="p-5 space-y-4">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Part Reference
          </label>
          <div className="mt-2 flex gap-2">
            <input
              value={partRef}
              onChange={(e) => onPartRefChange(e.target.value.toUpperCase())}
              placeholder="e.g. PR-12345"
              className="flex-1 rounded-lg border-2 border-input bg-background px-4 py-3 text-lg font-mono font-bold uppercase tracking-wider focus:border-primary focus:outline-none focus:ring-4 focus:ring-ring/20"
              maxLength={32}
            />
            <Button
              size="lg"
              onClick={generate}
              disabled={busy || !partRef.trim()}
              className="px-6 text-base font-semibold"
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Printer className="h-5 w-5" />}
              <span className="ml-2">Generate Label</span>
            </Button>
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
