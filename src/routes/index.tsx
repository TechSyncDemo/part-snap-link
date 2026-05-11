import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { StatusBar } from "@/components/iqts/StatusBar";
import { LabelGenerator } from "@/components/iqts/LabelGenerator";
import { ScanCapture } from "@/components/iqts/ScanCapture";
import { HistoryPanel } from "@/components/iqts/HistoryPanel";
import { getBridge, type PartRecord, type SystemConfig } from "@/lib/iqts-bridge";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "IQTS · Industrial Quality Tracking System" },
      {
        name: "description",
        content:
          "Offline industrial quality tracking: QR-linked image acquisition, Zebra label printing, IFM camera pairing, and local SQLite archive.",
      },
    ],
  }),
  component: IndexPage,
});

const bridge = getBridge();

function IndexPage() {
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [partRef, setPartRef] = useState("PR-12345");
  const [lastRecord, setLastRecord] = useState<PartRecord | null>(null);
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

  function handleScanned(rec: PartRecord) {
    setLastRecord(rec);
    setRefreshKey((k) => k + 1);
  }

  return (
    <div className="min-h-screen bg-background bg-grid">
      <StatusBar
        station={config?.station ?? "—"}
        operator={config?.operator ?? "—"}
        recordsToday={stats.count}
        passRate={stats.rate}
      />

      <main className="max-w-[1600px] mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-6">
        {/* Phase A — Identification */}
        <section>
          <SectionHeader phase="A" title="Identification" subtitle="Operator generates a QR label and applies it to the part." />
          <LabelGenerator partRef={partRef} onPartRefChange={setPartRef} />
        </section>

        {/* Phase B + C — Inspection & Pairing */}
        <section>
          <SectionHeader
            phase="B · C"
            title="Inspection & Pairing"
            subtitle="The IFM camera captures an image; the operator scans the QR to associate it with the latest snapshot."
          />
          <ScanCapture partRef={partRef} onScanned={handleScanned} lastRecord={lastRecord} />
        </section>

        {/* Phase D — Retrieval */}
        <section>
          <SectionHeader
            phase="D"
            title="Retrieval & Archive"
            subtitle="Supervisors search the local SQLite archive by Part ID, reference, or status."
          />
          <HistoryPanel refreshKey={refreshKey} />
        </section>

        <footer className="text-center text-xs text-muted-foreground py-6 border-t">
          IQTS · Local LAN Operation · Zero-Internet Dependency · {new Date().getFullYear()}
        </footer>
      </main>
    </div>
  );
}

function SectionHeader({ phase, title, subtitle }: { phase: string; title: string; subtitle: string }) {
  return (
    <div className="mb-3 flex items-end gap-3">
      <span className="rounded-md bg-primary/10 text-primary px-2 py-1 text-xs font-mono font-bold">
        PHASE {phase}
      </span>
      <div>
        <h2 className="font-display text-xl font-bold leading-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}
