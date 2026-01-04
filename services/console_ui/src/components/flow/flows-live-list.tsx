// src/components/flow/flows-live-list.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { FlowCard } from "./flow-card";

interface FlowsLiveListProps {
  initialFlows: Flow[];
  hours: number;
  deviceId?: string;
  apiBaseUrl: string; // bleibt im Typ, auch wenn wir es hier nicht mehr brauchen
}

export function FlowsLiveList({
  initialFlows,
  hours,
  deviceId,
  apiBaseUrl,
}: FlowsLiveListProps) {
  const [flows, setFlows] = useState<Flow[]>(initialFlows ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      const res = await fetch(`/api/flows?hours=${hours}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setFlows(data);
    } catch (err: any) {
      console.error("Error loading flows", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    reload();

    const id = setInterval(reload, 5000); // Live-Refresh alle 5s
    return () => clearInterval(id);
  }, [hours, deviceId, apiBaseUrl]);

  const filteredFlows = useMemo(
    () =>
      deviceId
        ? flows.filter((f: any) => f.device === deviceId)
        : flows,
    [flows, deviceId]
  );

  if (!filteredFlows.length && !loading && !error) {
    return (
      <div className="text-sm text-slate-400">
        Keine Flows im gewählten Zeitraum gefunden.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center text-xs text-slate-400">
        <span>
          {filteredFlows.length} Flows (letzte {hours} Stunden
          {deviceId ? `, Device: ${deviceId}` : ""})
        </span>
        <span>{loading ? "Aktualisiere…" : "Live alle 5s"}</span>
      </div>

      {error && (
        <div className="text-xs text-red-500">
          Fehler beim Laden der Flows: {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {filteredFlows.map((flow: any, index: number) => (
          <FlowCard
            key={
              flow.id ??
              flow.flow_id ?? // falls dein Backend so ein Feld liefert
              flow.correlation_id ??
              flow.plan_id ??
              // letzter Fallback: stabiler Index-basierter Key
              `flow-${index}`
            }
            flow={flow}
            apiBaseUrl={apiBaseUrl}
          />
        ))}
      </div>
    </div>
  );
}

