// src/components/flow/flow-card.tsx
"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";

type FlowCardProps = {
  flow: any;
  apiBaseUrl: string;
};

function formatTs(ts?: string) {
  if (!ts) return "-";
  try {
    return new Date(ts).toISOString().replace("T", " ").replace("Z", "");
  } catch {
    return ts;
  }
}

// kleine Helper für Severity-Badge
function severityClasses(sev?: string) {
  const s = (sev ?? "").toLowerCase();
  switch (s) {
    case "error":
      return "bg-red-900/60 text-red-200 border border-red-500/60";
    case "warning":
      return "bg-yellow-900/60 text-yellow-200 border border-yellow-500/60";
    case "debug":
      return "bg-slate-900/80 text-slate-300 border border-slate-600/60";
    case "info":
    default:
      return "bg-emerald-900/60 text-emerald-200 border border-emerald-500/60";
  }
}

export function FlowCard({ flow, apiBaseUrl }: FlowCardProps) {
  const [showDetails, setShowDetails] = useState(false);

  const flowId =
    flow.flow_id ??
    flow.id ??
    flow.correlation_id ??
    flow.plan_id ??
    "unbekannter Flow";

  // Device: verschiedene mögliche Feldnamen berücksichtigen
  const device =
    flow.device ??
    flow.device_id ??
    flow.primary_device_id ?? // <- wichtig für dein Beispiel
    flow.entity_id ??
    (Array.isArray(flow.devices) ? flow.devices.join(", ") : undefined);

  const usecase =
    flow.usecase ??
    flow.usecase_key ??
    (Array.isArray(flow.usecases) ? flow.usecases.join(", ") : undefined);

  const lastTs =
    flow.last_ts ??
    flow.ended_at ?? // bei deinen Aggregaten
    flow.ts ??
    flow.updated_at ??
    flow.created_at;

  const firstTs = flow.first_ts ?? flow.started_at ?? undefined;

  const eventCount = flow.event_count ?? flow.count ?? undefined;
  const maxSeverity = flow.max_severity ?? flow.severity ?? "info";

  // Services: verschiedene mögliche Feldnamen berücksichtigen
  const services =
    flow.services ??
    flow.service_names ??
    flow.services_involved ?? // <- dein Beispiel-Feld
    (Array.isArray(flow.service_list) ? flow.service_list : undefined);

  return (
    <Card className="bg-slate-950 border border-slate-800 hover:bg-slate-900 transition-colors">
      <CardContent className="p-4 space-y-3">
        {/* Kopfzeile: Flow-Name + Severity */}
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="text-sm font-semibold text-slate-50">
              {flowId}
            </div>
            <div className="text-xs text-slate-400">
              {device ? (
                <>
                  Device:{" "}
                  <span className="font-mono text-slate-200">{device}</span>
                </>
              ) : (
                "Kein Device zugeordnet"
              )}
            </div>
            {usecase && (
              <div className="text-xs text-slate-500">
                UseCase:{" "}
                <span className="font-mono text-slate-300">{usecase}</span>
              </div>
            )}
          </div>

          {/* Severity-Badge */}
          <div
            className={`text-[10px] px-2 py-1 rounded-full uppercase tracking-wide ${severityClasses(
              maxSeverity
            )}`}
          >
            {maxSeverity ?? "info"}
          </div>
        </div>

        {/* Meta-Infos: Zeit, Events, Services */}
        <div className="space-y-1 text-xs text-slate-400">
          <div className="flex justify-between gap-2">
            <span>Last event:</span>
            <span className="font-mono text-slate-200">
              {formatTs(lastTs)}
            </span>
          </div>

          {firstTs && (
            <div className="flex justify-between gap-2">
              <span>First event:</span>
              <span className="font-mono text-slate-400">
                {formatTs(firstTs)}
              </span>
            </div>
          )}

          {typeof eventCount === "number" && (
            <div className="flex justify-between gap-2">
              <span>Events:</span>
              <span className="font-mono text-slate-200">{eventCount}</span>
            </div>
          )}

          {services && Array.isArray(services) && services.length > 0 && (
            <div className="flex justify-between gap-2">
              <span>Services:</span>
              <span className="font-mono text-slate-300 truncate">
                {services.join(", ")}
              </span>
            </div>
          )}
        </div>

        {/* Details-Button */}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            className="text-xs px-3 py-1 rounded bg-slate-900 border border-slate-600 text-slate-100 hover:bg-slate-800 hover:border-slate-400"
          >
            {showDetails ? "Details ausblenden" : "Details anzeigen"}
          </button>
        </div>

        {/* Detailbereich mit JSON */}
        {showDetails && (
          <div className="mt-2 space-y-1">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">
              FlowDetail JSON
            </div>
            <pre className="text-[11px] leading-snug bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 overflow-x-auto">
              {JSON.stringify(flow, null, 2)}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

