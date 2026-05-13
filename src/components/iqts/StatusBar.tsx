import { useEffect, useState } from "react";
import { Activity, Wifi, WifiOff, Factory, Cpu, Printer } from "lucide-react";
import { getBridge, isElectronEnv, type ConnectionStatus } from "@/lib/iqts-bridge";

interface Props {
  station: string;
  operator: string;
  recordsToday: number;
  passRate: number;
}

const bridge = getBridge();

export function StatusBar({ station, operator, recordsToday, passRate }: Props) {
  const electron = isElectronEnv();
  const [conn, setConn] = useState<ConnectionStatus | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await bridge.checkConnections();
        if (alive) setConn(r);
      } catch {}
    };
    tick();
    const id = setInterval(tick, 8000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return (
    <header className="border-b bg-surface/80 backdrop-blur sticky top-0 z-10">
      <div className="max-w-[1600px] mx-auto px-3 sm:px-6 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary text-primary-foreground flex items-center justify-center shadow-industrial">
            <Factory className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-display text-lg font-bold leading-tight">IQTS</h1>
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground leading-tight">
              Industrial Quality Tracking
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 sm:gap-6 ml-2 sm:ml-4 text-xs">
          <div>
            <p className="text-muted-foreground uppercase tracking-wider">Station</p>
            <p className="font-mono font-bold">{station}</p>
          </div>
          <div>
            <p className="text-muted-foreground uppercase tracking-wider">Operator</p>
            <p className="font-mono font-bold">{operator}</p>
          </div>
        </div>

        <div className="hidden sm:block flex-1" />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm w-full sm:w-auto">
          <DeviceBadge
            icon={<Cpu className="h-3.5 w-3.5" />}
            label="PLC"
            host={conn?.plc.host}
            ok={!!conn?.plc.ok}
            err={conn?.plc.err}
            latency={conn?.plc.latency}
          />
          <DeviceBadge
            icon={<Printer className="h-3.5 w-3.5" />}
            label="Printer"
            host={conn?.printer.host}
            ok={!!conn?.printer.ok}
            err={conn?.printer.err}
            latency={conn?.printer.latency}
          />

          <div className="text-right">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Today</p>
            <p className="font-mono font-bold text-base leading-tight">{recordsToday}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Pass</p>
            <p className="font-mono font-bold text-base leading-tight text-success">{passRate.toFixed(1)}%</p>
          </div>
          <div
            className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold ${
              electron
                ? "border-success/40 bg-success/5 text-success"
                : "border-warning/40 bg-warning/5"
            }`}
            style={!electron ? { color: "oklch(0.5 0.14 75)" } : undefined}
          >
            {electron ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            {electron ? "LAN" : "Preview"}
          </div>
          <div className="hidden md:flex items-center gap-1.5 text-xs text-muted-foreground">
            <Activity className="h-3.5 w-3.5 text-success" />
            <span className="font-mono">{new Date().toLocaleDateString()}</span>
          </div>
        </div>
      </div>
    </header>
  );
}

function DeviceBadge({
  icon, label, host, ok, err, latency,
}: { icon: React.ReactNode; label: string; host?: string; ok: boolean; err?: string; latency?: number }) {
  const tone = ok
    ? "border-success/40 bg-success/5 text-success"
    : "border-destructive/40 bg-destructive/5 text-destructive";
  const dot = ok ? "bg-success" : "bg-destructive";
  const title = ok
    ? `${label} ${host} reachable${latency != null ? ` · ${latency}ms` : ""}`
    : `${label} ${host ?? "?"} unreachable${err ? ` · ${err}` : ""}`;
  return (
    <div title={title} className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold ${tone}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot} ${ok ? "" : "animate-pulse"}`} />
      {icon}
      <span className="hidden sm:inline">{label}</span>
      <span className="font-mono text-[10px] opacity-80">{host ?? "—"}</span>
    </div>
  );
}
