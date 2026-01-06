// services/console_ui/src/lib/ki_client.ts

// Wir rufen im Browser am besten die Next.js API-Route auf (kein CORS, zentraler Clamp/Fix):
//   /api/ki/forecast -> routed intern an console_api
//
// Optional kannst du NEXT_PUBLIC_KI_API_URL setzen, z.B.:
//   NEXT_PUBLIC_KI_API_URL=http://localhost:3000/api
// Dann wird daraus: ${base}/ki/forecast
//
// Default: relativ (funktioniert im Container + lokal sauber)
const KI_API_BASE =
  process.env.NEXT_PUBLIC_KI_API_URL || ""; // "" => relative calls

export type HistoryPoint = {
  ts: string; // ISO
  value: number; // kW
};

export type ForecastPoint = {
  target_ts: string; // ISO
  q50: number; // Pflicht
  q10?: number; // optional (TiRex)
  q90?: number; // optional (TiRex)
  backend?: string; // z.B. "tirex_v1" / "baseline_v1"
};

export type ForecastMeta = {
  history_points: number;
  forecast_points: number;
  history_from: string;
  forecast_to: string;

  // optional (kommt von console_api)
  step_minutes?: number;
  predictor_step_minutes?: number;
  backend?: string;
};

export type ForecastResponse = {
  series: string;
  meta: ForecastMeta;
  history: HistoryPoint[];
  forecast: ForecastPoint[];
  price?: { ts: string; value: number | null }[]; // optional: console_api liefert price
};

type ForecastOptions = {
  backend?: "tirex_v1" | "baseline_v1" | string;
  stepMinutes?: number;
};

// API-Client: kompatibel, aber mit optionalen opts
export async function getForecast(
  series: string,
  historyHours: number,
  horizonHours: number,
  opts: ForecastOptions = {},
): Promise<ForecastResponse> {
  // Fix: wir arbeiten fix mit 15-Minuten und TiRex als Default
  const backend = opts.backend ?? "tirex_v1";
  const stepMinutesRequested = opts.stepMinutes ?? 15;
  const stepMinutesEffective = Math.max(15, stepMinutesRequested);

  const params = new URLSearchParams({
    series,
    history_hours: String(historyHours),
    horizon_hours: String(horizonHours),
    backend,
    step_minutes: String(stepMinutesEffective),
  });

  // Wenn KI_API_BASE leer ist, nutzen wir relative URL: "/api/ki/forecast?...".
  const base = KI_API_BASE ? KI_API_BASE.replace(/\/+$/, "") : "";
  const url = `${base}/api/ki/forecast?${params.toString()}`;

  const res = await fetch(url, { cache: "no-store" });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Forecast-API Error: ${res.status} – ${text || "<no body>"}`);
  }

  return res.json();
}

