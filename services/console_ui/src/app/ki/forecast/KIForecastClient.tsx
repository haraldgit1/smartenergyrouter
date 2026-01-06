// services/console_ui/src/app/ki/forecast/KIForecastClient.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { getForecast, ForecastResponse } from "@/lib/ki_client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";

type SeriesOption = {
  value: string;
  label: string;
};

type Props = {
  seriesOptions: SeriesOption[];
  defaultSeries: string;
  defaultHistoryHours?: number;
  defaultHorizonHours?: number;
};

type ChartPoint = {
  ts: string;
  tsMs: number;
  history?: number;
  forecast_q50?: number;
  forecast_q10?: number;
  forecast_q90?: number;
};

type PricePoint = {
  ts: string;
  tsMs: number;
  price: number; // ct/kWh
};

export default function KIForecastClient({
  seriesOptions,
  defaultSeries,
  defaultHistoryHours = 48,
  defaultHorizonHours = 48,
}: Props) {
  const [series, setSeries] = useState(defaultSeries);
  const [historyHours, setHistoryHours] = useState(defaultHistoryHours);
  const [horizonHours, setHorizonHours] = useState(defaultHorizonHours);
  const [data, setData] = useState<ForecastResponse | any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fix: wir arbeiten fix mit 15min + tirex_v1
  const backendFixed = "tirex_v1";
  const stepFixed = 15;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const res = await getForecast(series, historyHours, horizonHours, {
          backend: backendFixed,
          stepMinutes: stepFixed,
        });
        if (!cancelled) setData(res);
      } catch (e: any) {
        if (!cancelled) {
          setData(null);
          setError(e?.message ?? "Fehler beim Laden der Forecast-Daten");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [series, historyHours, horizonHours]);

  const chartData: ChartPoint[] = useMemo(() => {
    if (!data) return [];
    const anyData: any = data;

    const map = new Map<string, ChartPoint>();
    const ensurePoint = (isoTs: string): ChartPoint => {
      const existing = map.get(isoTs);
      if (existing) return existing;
      const tsMs = new Date(isoTs).getTime();
      const p: ChartPoint = { ts: isoTs, tsMs };
      map.set(isoTs, p);
      return p;
    };

    // Aggregator-Format (console_api): history + forecast
    if (Array.isArray(anyData.history)) {
      for (const h of anyData.history) {
        if (!h?.ts) continue;
        const p = ensurePoint(h.ts);
        if (typeof h.value === "number") p.history = h.value;
      }
    }

    if (Array.isArray(anyData.forecast)) {
      for (const f of anyData.forecast) {
        const t = f?.target_ts ?? f?.ts;
        if (!t) continue;
        const p = ensurePoint(t);
        // robust: nur numbers übernehmen
        if (typeof f.q50 === "number") p.forecast_q50 = f.q50;
        if (typeof f.q10 === "number") p.forecast_q10 = f.q10;
        if (typeof f.q90 === "number") p.forecast_q90 = f.q90;
      }
    }
    // Predictor-Format (falls jemals direkt): points[]
    else if (Array.isArray(anyData.points)) {
      for (const pr of anyData.points) {
        if (!pr?.ts) continue;
        const p = ensurePoint(pr.ts);
        if (typeof pr.q50 === "number") p.forecast_q50 = pr.q50;
        if (typeof pr.q10 === "number") p.forecast_q10 = pr.q10;
        if (typeof pr.q90 === "number") p.forecast_q90 = pr.q90;
      }
    }

    return Array.from(map.values())
      .filter((p) => Number.isFinite(p.tsMs))
      .sort((a, b) => a.tsMs - b.tsMs);
  }, [data]);

  const priceChartData: PricePoint[] = useMemo(() => {
    if (!data) return [];
    const anyData: any = data;
    if (!Array.isArray(anyData.price)) return [];

    return anyData.price
      .filter((p: any) => p?.ts && p.value != null)
      .map((p: any) => {
        const eurPerMWh = Number(p.value);
        const ctPerKWh = eurPerMWh * 0.1;
        const tsMs = new Date(p.ts).getTime();
        return { ts: p.ts, tsMs, price: ctPerKWh };
      })
      .filter((p: any) => Number.isFinite(p.tsMs) && Number.isFinite(p.price))
      .sort((a: any, b: any) => a.tsMs - b.tsMs);
  }, [data]);

  const xDomain = useMemo(() => {
    const allTs: number[] = [];
    for (const p of chartData) allTs.push(p.tsMs);
    for (const p of priceChartData) allTs.push(p.tsMs);
    if (allTs.length === 0) return null;
    return { min: Math.min(...allTs), max: Math.max(...allTs) };
  }, [chartData, priceChartData]);

  const selectedOption = seriesOptions.find((o) => o.value === series);

  const backendName =
    (data as any)?.meta?.backend ??
    (data as any)?.forecast?.[0]?.backend ??
    (data as any)?.backend ??
    backendFixed;

  const stepInfo = (data as any)?.meta?.step_minutes ?? stepFixed;

  const historyPoints =
    (data as any)?.meta?.history_points ??
    (Array.isArray((data as any)?.history) ? (data as any).history.length : 0);

  const forecastPoints =
    (data as any)?.meta?.forecast_points ??
    (Array.isArray((data as any)?.forecast)
      ? (data as any).forecast.length
      : Array.isArray((data as any)?.points)
      ? (data as any).points.length
      : 0);

  const historyFrom = (data as any)?.meta?.history_from;
  const forecastTo = (data as any)?.meta?.forecast_to;

  const xAxisDomain =
    xDomain !== null ? [xDomain.min, xDomain.max] : ["auto", "auto"];

  // Helper: merken, ob wir überhaupt Forecast-Werte haben
  const hasAnyForecast = useMemo(() => {
    return chartData.some((p) => typeof p.forecast_q50 === "number");
  }, [chartData]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-baseline gap-3 justify-between">
        <div className="space-y-1">
          <div className="text-sm text-slate-400">
            KI-basierte Prognose (History + Forecast).
          </div>
          <div className="text-[11px] text-slate-500">
            Backend: {backendName} · Step: {stepInfo}m · History: {historyPoints} ·
            Forecast: {forecastPoints} · ChartPoints: {chartData.length}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-wide text-emerald-300">
            Powered by TiRex (NXAI)
          </div>
        </div>
      </div>

      {/* Filter */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-400">Zeitreihe (series)</label>
          <select
            value={series}
            onChange={(e) => setSeries(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded-md text-sm px-2 py-1"
          >
            {seriesOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-400">History (Stunden)</label>
          <input
            type="number"
            min={1}
            max={240}
            value={historyHours}
            onChange={(e) =>
              setHistoryHours(
                Math.max(1, Math.min(240, Number(e.target.value) || 1))
              )
            }
            className="bg-slate-950 border border-slate-700 rounded-md text-sm px-2 py-1 w-24"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-400">Horizon (Stunden)</label>
          <input
            type="number"
            min={1}
            max={240}
            value={horizonHours}
            onChange={(e) =>
              setHorizonHours(
                Math.max(1, Math.min(240, Number(e.target.value) || 1))
              )
            }
            className="bg-slate-950 border border-slate-700 rounded-md text-sm px-2 py-1 w-24"
          />
        </div>
      </div>

      {/* Status */}
      {loading && <div className="text-sm text-slate-300">Lade Forecast-Daten…</div>}

      {error && !loading && (
        <div className="text-sm text-red-400 border border-red-700/60 rounded-md px-3 py-2 bg-red-950/40">
          {error}
        </div>
      )}

      {/* Wenn chartData da ist, aber keine Forecast-Werte -> Hinweis */}
      {!loading && !error && data && chartData.length > 0 && !hasAnyForecast && (
        <div className="text-sm text-amber-200 border border-amber-600/40 rounded-md px-3 py-2 bg-amber-950/20">
          Daten geladen, aber keine Forecast-Werte (q50) erkannt. Prüfe das JSON
          (forecast[].q50).
        </div>
      )}

      {/* Load Chart */}
      {!loading && !error && data && chartData.length > 0 && (
        <div className="w-full h-[400px] border border-slate-800 rounded-xl bg-slate-950/60 p-3">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} syncId="ki-forecast-sync">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="tsMs"
                type="number"
                domain={xAxisDomain as any}
                tickFormatter={(value) =>
                  new Date(value as number).toLocaleTimeString("de-AT", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                }
                tick={{ fontSize: 10 }}
              />
              <YAxis tick={{ fontSize: 10 }} width={40} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#020617",
                  borderColor: "#334155",
                  color: "#e5e7eb",
                  fontSize: 11,
                }}
                labelStyle={{ color: "#e5e7eb" }}
                labelFormatter={(label) =>
                  new Date(label as number).toLocaleString("de-AT", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                }
                formatter={(value: any, name: string) => {
                  const label =
                    name === "history"
                      ? "History"
                      : name === "forecast_q90"
                      ? "Forecast q90"
                      : name === "forecast_q50"
                      ? "Forecast q50"
                      : name === "forecast_q10"
                      ? "Forecast q10"
                      : name;
                  return [
                    value?.toFixed ? value.toFixed(3) + " kW" : value,
                    label,
                  ];
                }}
              />
              <Legend />

              <Line type="monotone" dataKey="history" name="History" dot={false} strokeWidth={1.8} />
              <Line type="monotone" dataKey="forecast_q90" name="Forecast q90" dot={false} strokeWidth={1} strokeDasharray="3 3" opacity={0.7} />
              <Line type="monotone" dataKey="forecast_q50" name="Forecast q50" dot={false} strokeWidth={2} strokeDasharray="5 3" />
              <Line type="monotone" dataKey="forecast_q10" name="Forecast q10" dot={false} strokeWidth={1} strokeDasharray="3 3" opacity={0.7} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Preis */}
      {!loading && !error && data && priceChartData.length > 0 && (
        <div className="w-full h-[260px] border border-slate-800 rounded-xl bg-slate-950/60 p-3">
          <div className="text-[11px] text-slate-400 mb-1">Strompreis (ct/kWh)</div>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={priceChartData} syncId="ki-forecast-sync">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="tsMs"
                type="number"
                domain={xAxisDomain as any}
                tickFormatter={(value) =>
                  new Date(value as number).toLocaleTimeString("de-AT", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                }
                tick={{ fontSize: 10 }}
              />
              <YAxis tick={{ fontSize: 10 }} width={50} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#020617",
                  borderColor: "#334155",
                  color: "#e5e7eb",
                  fontSize: 11,
                }}
                labelStyle={{ color: "#e5e7eb" }}
                labelFormatter={(label) =>
                  new Date(label as number).toLocaleString("de-AT", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                }
                formatter={(value: any) => [
                  value?.toFixed ? value.toFixed(2) + " ct/kWh" : value,
                  "Preis",
                ]}
              />
              <Legend />
              <Line type="monotone" dataKey="price" name="Preis" dot={false} strokeWidth={1.8} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Info */}
      {data && selectedOption && (
        <div className="text-xs text-slate-500 border border-slate-800 rounded-md px-3 py-2 bg-slate-950/40">
          <div>
            <span className="font-semibold">Series:</span>{" "}
            <code>{(data as any).series ?? selectedOption.value}</code> (
            {selectedOption.label})
          </div>
          {historyFrom && forecastTo && (
            <div>
              <span className="font-semibold">Zeitfenster:</span>{" "}
              History ab {historyFrom}, Forecast bis {forecastTo}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

