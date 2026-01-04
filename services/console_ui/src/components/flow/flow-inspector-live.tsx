// src/components/flow/flow-inspector-live.tsx
"use client";

import useSWR from "swr";

interface Flow {
  flow_id?: string;
  plan_id?: string;
  device: string;
  usecase: string;
  power_kw: number;
  window?: [string, string][];
  ts: string;
  status?: string;
  [key: string]: any;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface FlowInspectorLiveProps {
  id: string;
}

export function FlowInspectorLive({ id }: FlowInspectorLiveProps) {
  const { data, error, isLoading } = useSWR<Flow>(
    `/api/flows/${encodeURIComponent(id)}`,
    fetcher,
    { refreshInterval: 5000 }
  );

  if (error) {
    return (
      <section className="border border-rose-800/60 rounded-xl p-4 bg-rose-950/40 text-xs text-rose-200">
        Fehler beim Live-Refresh des Flows: {String(error)}
      </section>
    );
  }

  if (isLoading || !data) {
    return (
      <section className="border border-slate-800 rounded-xl p-4 bg-slate-950/40 text-xs text-slate-400">
        Live-Daten werden geladen…
      </section>
    );
  }

  return (
    <section className="border border-slate-800 rounded-xl p-4 bg-slate-950/40 space-y-2">
      <h2 className="text-sm font-semibold text-slate-100">
        Live-Ansicht (alle 5s aktualisiert)
      </h2>
      <p className="text-[11px] text-slate-400">
        Status: <span className="font-mono">{data.status ?? "unknown"}</span>{" "}
        · Last Update: <span className="font-mono">{data.ts}</span>
      </p>
      <pre className="text-[11px] text-emerald-200 bg-black/60 rounded-lg p-3 overflow-auto max-h-64">
        {JSON.stringify(
          {
            id: data.plan_id ?? data.flow_id,
            status: data.status,
            device: data.device,
            usecase: data.usecase,
            power_kw: data.power_kw,
            window: data.window,
          },
          null,
          2
        )}
      </pre>
    </section>
  );
}

