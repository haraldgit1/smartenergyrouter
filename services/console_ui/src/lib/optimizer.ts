// src/lib/optimizer.ts

const BASE_URL =
  process.env.NEXT_PUBLIC_CONSOLE_API_BASE ?? "http://localhost:8100";

export async function startOptimization(input: {
  device: string;
  usecase: string;
  horizon_hours: number;
}) {
  const res = await fetch(`${BASE_URL}/optimize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    throw new Error(
      `Failed to start optimization: ${res.status} ${res.statusText}`
    );
  }

  return res.json() as Promise<{
    job_id: string;
    status: string;
    plan_id?: string | null;
  }>;
}

export async function getOptimizationJob(job_id: string) {
  const res = await fetch(`${BASE_URL}/optimize/${job_id}`, {
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(
      `Failed to fetch optimization job: ${res.status} ${res.statusText}`
    );
  }

  return res.json();
}

