// src/lib/flows.ts

export type Flow = {
  plan_id: string;
  device: string;
  usecase: string;
  power_kw: number;
  window: [string, string][];
  status?: string;
  ts: string;
  raw_payload?: unknown;
};

export async function getFlowByPlanId(planId: string): Promise<Flow | null> {
  const res = await fetch(
    `${process.env.ROUTER_AGENT_BASE_URL ?? "http://router_agent:8000"}/flows/${encodeURIComponent(planId)}`,
    { cache: "no-store" }
  );

  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Failed to fetch flow ${planId}: ${res.statusText}`);
  }

  return (await res.json()) as Flow;
}

