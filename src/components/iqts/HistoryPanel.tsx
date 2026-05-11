import { useEffect, useState } from "react";
import { Search, Database, Image as ImageIcon, CheckCircle2, XCircle } from "lucide-react";
import { getBridge, type PartRecord } from "@/lib/iqts-bridge";

const bridge = getBridge();

interface Props {
  refreshKey: number;
}

export function HistoryPanel({ refreshKey }: Props) {
  const [query, setQuery] = useState("");
  const [records, setRecords] = useState<PartRecord[]>([]);
  const [selected, setSelected] = useState<PartRecord | null>(null);

  useEffect(() => {
    let active = true;
    const run = async () => {
      const res = query ? await bridge.searchRecords(query) : await bridge.listRecent(50);
      if (!active) return;
      setRecords(res);
      setSelected((prev) => prev ?? res[0] ?? null);
    };
    void run();
    return () => {
      active = false;
    };
  }, [query, refreshKey]);

  return (
    <div className="rounded-xl border bg-card shadow-industrial overflow-hidden">
      <div className="px-3 py-2 border-b bg-muted/40 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" />
          <h3 className="text-xs font-semibold uppercase tracking-wider">Quality Archive</h3>
        </div>
        <span className="text-[10px] text-muted-foreground font-mono">SQLite · local</span>
      </div>

      <div className="p-2 border-b">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Scan or type Part ID, Reference, or Status…"
            className="w-full rounded-lg border bg-background pl-8 pr-3 py-1.5 font-mono text-xs focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_1.2fr] divide-y md:divide-y-0 md:divide-x">
        <div className="max-h-[260px] overflow-y-auto">
          {records.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              <Database className="h-8 w-8 mx-auto mb-2 opacity-40" />
              {query ? "No matching records." : "No records yet. Generate a label and scan a part to begin."}
            </div>
          ) : (
            <ul className="divide-y">
              {records.map((r) => {
                const Icon = r.status === "Conforme" ? CheckCircle2 : XCircle;
                const tone =
                  r.status === "Conforme" ? "text-success" : r.status === "Non-Conforme" ? "text-destructive" : "text-warning";
                const isSel = selected?.id === r.id;
                return (
                  <li key={r.id}>
                    <button
                      onClick={() => setSelected(r)}
                      className={`w-full text-left px-4 py-3 transition-colors hover:bg-accent/50 ${
                        isSel ? "bg-accent" : ""
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Icon className={`h-4 w-4 flex-shrink-0 ${tone}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-mono font-semibold truncate">{r.partId}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(r.capturedAt).toLocaleString()} · {r.station}
                          </p>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="p-5 bg-muted/20">
          {selected ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Part ID</p>
                  <p className="font-mono font-bold text-base">{selected.partId}</p>
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-wider ${
                    selected.status === "Conforme"
                      ? "status-pill-pass"
                      : selected.status === "Non-Conforme"
                        ? "status-pill-fail"
                        : "status-pill-pending"
                  }`}
                >
                  {selected.status}
                </span>
              </div>
              <div className="rounded-lg border bg-background overflow-hidden">
                {selected.imageDataUrl ? (
                  <img src={selected.imageDataUrl} alt={selected.partId} className="w-full aspect-[4/3] object-cover" />
                ) : (
                  <div className="aspect-[4/3] flex items-center justify-center text-muted-foreground">
                    <div className="text-center">
                      <ImageIcon className="h-10 w-10 mx-auto mb-2 opacity-40" />
                      <p className="text-xs font-mono">{selected.imagePath}</p>
                    </div>
                  </div>
                )}
              </div>
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <dt className="text-muted-foreground uppercase tracking-wider">Reference</dt>
                  <dd className="font-mono font-semibold">{selected.partRef}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground uppercase tracking-wider">Station</dt>
                  <dd className="font-mono font-semibold">{selected.station}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground uppercase tracking-wider">Operator</dt>
                  <dd className="font-mono font-semibold">{selected.operator}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground uppercase tracking-wider">Captured</dt>
                  <dd className="font-mono font-semibold">{new Date(selected.capturedAt).toLocaleString()}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-muted-foreground uppercase tracking-wider">Image path</dt>
                  <dd className="font-mono text-[11px] break-all">{selected.imagePath}</dd>
                </div>
              </dl>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              Select a record to view details.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
