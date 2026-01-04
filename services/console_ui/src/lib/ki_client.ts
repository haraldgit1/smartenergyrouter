// src/lib/ki_client.ts

const KI_API_BASE =
  process.env.NEXT_PUBLIC_KI_API_URL || "http://localhost:8101"; // besserer Default

export type HistoryPoint = {
  ts: string;     // ISO
  value: number;  // kW
};

export type ForecastPoint = {
  target_ts: string; // ISO
  q50: number;       // Pflicht
  q10?: number;      // optional (TiRex)
  q90?: number;      // optional (TiRex)
  backend?: string;  // z.B. "tirex_v1" / "baseline_v1"
};

export type ForecastMeta = {
  history_points: number;
  forecast_points: number;
  history_from: string;
  forecast_to: string;
};

export type ForecastResponse = {
  series: string;
  meta: ForecastMeta;
  history: HistoryPoint[];
  forecast: ForecastPoint[];
};

// API-Client: Signatur bleibt wie bisher
export async function getForecast(
  series: string,
  historyHours: number,
  horizonHours: number,
): Promise<ForecastResponse> {
  const params = new URLSearchParams({
    series,
    history_hours: String(historyHours),
    horizon_hours: String(horizonHours),
  });

  const res = await fetch(
    `${KI_API_BASE}/ki/forecast?${params.toString()}`,
    { cache: "no-store" },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Forecast-API Error: ${res.status} – ${text}`);
  }

  return res.json();
}

