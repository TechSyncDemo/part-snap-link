import { CheckCircle2, XCircle, Clock, Image as ImageIcon, Printer, AlertTriangle } from "lucide-react";
import { type ProcessResult, type QualityStatus } from "@/lib/iqts-bridge";
import { cn } from "@/lib/utils";

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

interface Props {
  result: ProcessResult | null;
}

export function LastProcessed({ result }: Props) {
  return (
    <div className="rounded-xl border bg-card shadow-industrial overflow-hidden h-full flex flex-col">
      <div className="px-3 py-2 border-b bg-muted/40 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ImageIcon className="h-4 w-4 text-primary" />
          <h3 className="text-xs font-semibold uppercase tracking-wider">Last Processed Part</h3>
        </div>
        <span className="text-[10px] text-muted-foreground font-mono">IFM → Archive</span>
      </div>

      <div className="p-3 flex-1 min-h-0">
        {!result && (
          <div className="rounded-lg border border-dashed h-full min-h-[220px] flex items-center justify-center">
            <div className="text-center">
              <ImageIcon className="h-8 w-8 mx-auto mb-1 text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground">Awaiting first PLC trigger…</p>
            </div>
          </div>
        )}

        {result && !result.ok && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-destructive">Processing failed</p>
              <p className="text-xs text-muted-foreground">{result.error}</p>
            </div>
          </div>
        )}

        {result && result.ok && (
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-start">
            <div className="rounded-lg border bg-muted/20 overflow-hidden">
              {result.imageDataUrl ? (
                <img
                  src={result.imageDataUrl}
                  alt={result.partId}
                  className="w-full h-auto max-h-[260px] object-contain bg-black/5"
                />
              ) : (
                <div className="aspect-[16/9] flex items-center justify-center text-muted-foreground text-xs">
                  No preview
                </div>
              )}
            </div>

            <div className="space-y-2 sm:min-w-[220px]">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Part ID</p>
                <p className="font-mono text-xs font-bold break-all">{result.partId}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Status</p>
                <StatusPill status={(result.status as QualityStatus) ?? "Pending"} />
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Label</p>
                {result.skippedPrint ? (
                  <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold border border-warning/40 bg-warning/10" style={{ color: "oklch(0.5 0.14 75)" }}>
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Not printed (NCR)
                  </span>
                ) : result.printed ? (
                  <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold status-pill-pass">
                    <Printer className="h-3.5 w-3.5" />
                    Printed
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold status-pill-fail">
                    <XCircle className="h-3.5 w-3.5" />
                    Print failed
                  </span>
                )}
                {result.printError && !result.skippedPrint && (
                  <p className="text-[10px] text-muted-foreground mt-1">{result.printError}</p>
                )}
              </div>
              <div className="text-[10px] text-muted-foreground">
                <p>Station <span className="font-mono">{result.station}</span></p>
                <p>Operator <span className="font-mono">{result.operator}</span></p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
