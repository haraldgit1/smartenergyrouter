// components/flow/flow-timeline.tsx
"use client";

import { FlowDetail } from "@/lib/api";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { ArrowRight } from "lucide-react";

interface Props {
  flow: FlowDetail;
}

const STAGES = [
  { key: "forecast", label: "Forecast" },
  { key: "optimizer", label: "Optimizer" },
  { key: "schedule", label: "Schedule" },
  { key: "router", label: "Router-Agent" },
  { key: "device", label: "Device" },
];

function stageForEventType(eventType: string): string {
  const t = eventType.toLowerCase();
  if (t.includes("forecast")) return "forecast";
  if (t.includes("optimizer")) return "optimizer";
  if (t.includes("schedule")) return "schedule";
  if (t.includes("setpoint")) return "router";
  if (t.includes("device")) return "device";
  return "optimizer"; // default
}

export function FlowTimeline({ flow }: Props) {
  const { summary, events } = flow;

  // Simple mapping: first event -> start stage, last event -> end stage
  const activeStages = new Set(
    events.map((e) => stageForEventType(e.event_type)),
  );

  return (
    <div className="space-y-4">
      {/* Pipeline-Visualisierung */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
        <div className="text-xs text-slate-400 mb-3">
          High-Level Flow &mdash;{" "}
          <span className="font-mono text-[11px] text-slate-300">
            {summary.flow_id}
          </span>
        </div>
        <div className="relative flex items-center justify-between gap-2">
          {STAGES.map((stage, index) => {
            const isActive = activeStages.has(stage.key);
            return (
              <div
                key={stage.key}
                className="flex-1 flex flex-col items-center gap-2"
              >
                <motion.div
                  className="relative flex items-center justify-center"
                  initial={{ scale: 0.8, opacity: 0.5 }}
                  animate={{
                    scale: isActive ? 1 : 0.9,
                    opacity: isActive ? 1 : 0.6,
                  }}
                  transition={{ type: "spring", stiffness: 200, damping: 15 }}
                >
                  <div className="h-8 w-8 rounded-full border border-slate-700 bg-slate-900 flex items-center justify-center shadow-inner shadow-slate-900">
                    <div className="h-4 w-4 rounded-full bg-gradient-to-br from-sky-400 to-emerald-400" />
                  </div>
                  {isActive && (
                    <motion.div
                      className="absolute inset-0 rounded-full border border-sky-500/80"
                      initial={{ opacity: 0, scale: 1.2 }}
                      animate={{ opacity: 0.8, scale: 1.4 }}
                      transition={{
                        repeat: Infinity,
                        repeatType: "reverse",
                        duration: 1.4,
                      }}
                    />
                  )}
                </motion.div>
                <div className="text-[11px] text-slate-300">{stage.label}</div>
                {index < STAGES.length - 1 && (
                  <div className="absolute inset-x-0 top-4 -z-10 flex items-center justify-center">
                    <div className="h-[2px] w-full bg-gradient-to-r from-sky-500/40 via-slate-700 to-emerald-400/40" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
          <Badge variant="outline">
            Events: {summary.event_count}
          </Badge>
          <span>
            {new Date(summary.started_at).toLocaleString("de-AT", {
              hour12: false,
            })}{" "}
            <ArrowRight className="inline-block h-3 w-3 mx-1" />
            {new Date(summary.ended_at).toLocaleString("de-AT", {
              hour12: false,
            })}
          </span>
          {summary.duration_seconds !== null && (
            <span>· Dauer: {summary.duration_seconds}s</span>
          )}
          {summary.primary_device_id && (
            <span>· Device: {summary.primary_device_id}</span>
          )}
        </div>
      </div>

      {/* Chronologische Eventliste */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
        <div className="text-sm font-semibold mb-2">
          Flow Events (chronologisch)
        </div>
        <div className="space-y-2 max-h-[420px] overflow-auto text-xs">
          {events.map((e) => (
            <motion.div
              key={e.event_id}
              className="flex gap-3"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.15 }}
            >
              <div className="flex flex-col items-center">
                <div className="h-2 w-2 rounded-full bg-sky-400" />
                <div className="flex-1 w-px bg-slate-700" />
              </div>
              <div className="flex-1 rounded-md border border-slate-800 bg-slate-900/70 p-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium text-[11px]">
                    {e.event_type}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {new Date(e.ts).toLocaleTimeString("de-AT", {
                      hour12: false,
                    })}
                  </div>
                </div>
                {e.message && (
                  <div className="mt-1 text-[11px] text-slate-300">
                    {e.message}
                  </div>
                )}
                <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-slate-400">
                  {e.service_name && <span>svc: {e.service_name}</span>}
                  {e.entity_type && (
                    <span>
                      ent: {e.entity_type}:{e.entity_id}
                    </span>
                  )}
                  {e.severity && <span>sev: {e.severity}</span>}
                  {e.flow_id && <span>flow: {e.flow_id}</span>}
                </div>
              </div>
            </motion.div>
          ))}
          {events.length === 0 && (
            <div className="text-xs text-slate-500">
              Keine Events für diesen Flow.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

