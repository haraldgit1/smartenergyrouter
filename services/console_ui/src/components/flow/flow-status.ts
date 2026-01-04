import type { Flow } from "@/lib/api";

export type FlowStatus = "ok" | "pending" | "error";

export interface FlowStep {
  key: "forecast" | "optimize" | "route" | "command";
  label: string;
  ts?: string | null;
}

export function getFlowSteps(flow: any): FlowStep[] {
  return [
    {
      key: "forecast",
      label: "Forecast",
      ts: flow.ts_forecast ?? flow.forecast_ts ?? null,
    },
    {
      key: "optimize",
      label: "Optimizer",
      ts: flow.ts_optimize ?? flow.optimizer_ts ?? null,
    },
    {
      key: "route",
      label: "Router-Agent",
      ts: flow.ts_route ?? flow.router_ts ?? null,
    },
    {
      key: "command",
      label: "Command Out",
      ts: flow.ts_command ?? flow.command_ts ?? null,
    },
  ];
}

export function deriveFlowStatus(flow: any): FlowStatus {
  if (flow.error) return "error";

  const steps = getFlowSteps(flow);

  const hasCommand = steps.find((s) => s.key === "command")?.ts;
  const anyStarted = steps.some((s) => !!s.ts);

  if (hasCommand) return "ok";
  if (anyStarted) return "pending";
  return "pending";
}

export function statusClasses(status: FlowStatus): string {
  switch (status) {
    case "error":
      return "bg-red-100 text-red-700 border-red-300";
    case "pending":
      return "bg-amber-100 text-amber-700 border-amber-300";
    case "ok":
    default:
      return "bg-emerald-100 text-emerald-700 border-emerald-300";
  }
}

