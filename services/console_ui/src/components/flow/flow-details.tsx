"use client";

import { useEffect, useState } from "react";
import type { FlowDetail } from "@/lib/api";
import { FlowTimeline } from "./flow-timeline";

interface FlowDetailsModalProps {
  flow: any;           // Summary aus der Liste
  apiBaseUrl: string;
  open: boolean;
  onClose: () => void;
}

export function FlowDetailsModal({
  flow,
  apiBaseUrl,
  open,
  onClose,
}: FlowDetailsModalProps) {
  const [detail, setDetail] = useState<FlowDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Flow-ID bestimmen (Fallbacks, je nach Backend)
  const flowId =
    (flow && (flow.flow_id || flow.id || flow.plan_id)) || null;

  useEffect(() => {
    if (!open || !flowId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    const url = new URL(`/api/flows/${encodeURIComponent(flowId)}`, apiBaseUrl);

    fetch(url.toString(), { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as FlowDetail;
        if (!cancelled) {
          setDetail(data);
        }
      })
      .catch((err: any) => {
        console.error("Error loading flow detail", err);
        if (!cancelled) {
          setError(err?.message ?? "Unbekannter Fehler beim Laden der Details");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, flowId, apiBaseUrl]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-slate-950 rounded-lg shadow-xl w-full max-w-4xl max-height-[90vh] flex flex-col border border-slate-800">
        <div className="px-4 py-3 border-b border-slate-800 flex justify-between items-center">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">
              Flow Details
            </h2>
            <p className="text-[11px] text-slate-400 break-all">
              {flowId ?? ""}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-xs px-3 py-1 rounded bg-slate-800 text-slate-100 border border-slate-600 hover:bg-slate-700"
          >
            Close
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-4 text-xs text-slate-100">
          {loading && (
            <div className="text-xs text-slate-400">
              Lade Flow-Details…
            </div>
          )}

          {error && (
            <div className="text-xs text-red-400 bg-red-950/40 border border-red-800 rounded p-2">
              Fehler beim Laden der Flow-Details: {error}
            </div>
          )}

          {/* Wenn Detail geladen: deine Timeline-Komponente */}
          {detail && (
            <>
              <FlowTimeline flow={detail} />

              {/* Optional: Rohdaten anzeigen */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <div className="text-xs font-semibold mb-2">
                  FlowDetail JSON
                </div>
                <pre className="text-[11px] overflow-auto">
                  {JSON.stringify(detail, null, 2)}
                </pre>
              </div>
            </>
          )}

          {!loading && !detail && !error && (
            <div className="text-xs text-slate-500">
              Keine Detaildaten für diesen Flow gefunden.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

