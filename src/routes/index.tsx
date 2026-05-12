import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { StatusBar } from "@/components/iqts/StatusBar";
import { LabelGenerator } from "@/components/iqts/LabelGenerator";
import { LastProcessed } from "@/components/iqts/LastProcessed";
import { HistoryPanel } from "@/components/iqts/HistoryPanel";
import { getBridge, type PartRecord, type ProcessResult, type SystemConfig } from "@/lib/iqts-bridge";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "IQTS · Industrial Quality Tracking System" },
      {
        name: "description",
        content:
          "Offline industrial quality tracking: PLC-driven label printing paired with IFM camera vision and local SQLite archive.",
      },
    ],
  }),
  component: IndexPage,
});

const bridge = getBridge();

function IndexPage() {
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [partRef, setPartRef] = useState("PR-12345");
  const [lastResult, setLastResult] = useState<ProcessResult | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [allRecords, setAllRecords] = useState<PartRecord[]>([]);

  useEffect(() => {
    bridge.getConfig().then(setConfig);
  }, []);

  useEffect(() => {
    bridge.listRecent(500).then(setAllRecords);
  }, [refreshKey]);

  const stats = useMemo(() => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const today = allRecords.filter((r) => r.capturedAt >= startOfDay.getTime());
    const pass = today.filter((r) => r.status === "Conforme").length;
    const rate = today.length ? (pass / today.length) * 100 : 0;
    return { count: today.length, rate };
  }, [allRecords]);

  function handleProcessed(res: ProcessResult) {
    setLastResult(res);
    if (res.ok) setRefreshKey((k) => k + 1);
  }

  return (
    <div className="h-screen flex flex-col bg-background bg-grid overflow-hidden">
      <StatusBar
        station={config?.station ?? "—"}
        operator={config?.operator ?? "—"}
        recordsToday={stats.count}
        passRate={stats.rate}
      />

      <main className="flex-1 min-h-0 overflow-auto">
        <div className="max-w-[1600px] mx-auto px-2 sm:px-4 py-2 sm:py-3 grid gap-3 grid-cols-1 xl:grid-cols-12 xl:auto-rows-min">
          <section className="xl:col-span-5">
            <SectionHeader phase="A" title="Operation & Trigger" />
            <LabelGenerator
              partRef={partRef}
              onPartRefChange={setPartRef}
              onProcessed={handleProcessed}
            />
          </section>

          <section className="xl:col-span-7">
            <SectionHeader phase="B" title="Vision · Pair · Print" />
            <LastProcessed result={lastResult} />
          </section>

          <section className="xl:col-span-12">
            <SectionHeader phase="C" title="Archive" />
            <HistoryPanel refreshKey={refreshKey} />
          </section>

          <footer className="xl:col-span-12 text-center text-[11px] text-muted-foreground py-2 border-t">
            IQTS · Local LAN · Zero-Internet · {new Date().getFullYear()}
          </footer>
        </div>
      </main>
    </div>
  );
}

function SectionHeader({ phase, title }: { phase: string; title: string }) {
  return (
    <div className="mb-1.5 flex items-center gap-2">
      <span className="rounded bg-primary/10 text-primary px-1.5 py-0.5 text-[10px] font-mono font-bold tracking-wider">
        PHASE {phase}
      </span>
      <h2 className="font-display text-sm font-bold leading-tight uppercase tracking-wider">{title}</h2>
    </div>
  );
}
