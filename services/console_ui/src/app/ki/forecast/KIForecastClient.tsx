// src/app/ki/forecast/KIForecastClient.tsx
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
  ts: string;   // ISO-String (für Debug / Tooltip)
  tsMs: number; // numeric timestamp für gemeinsame Domain
  history?: number;
  forecast_q50?: number;
  forecast_q10?: number;
  forecast_q90?: number;
};

type PricePoint = {
  ts: string;
  tsMs: number;
  price: number; // in ct/kWh
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

  // Daten laden, wenn sich Series/Zeiträume ändern
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await getForecast(series, historyHours, horizonHours);
        if (!cancelled) {
          setData(res);
        }
      } catch (e: any) {
        if (!cancelled) {
          setData(null);
          setError(e?.message ?? "Fehler beim Laden der Forecast-Daten");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [series, historyHours, horizonHours]);

  // History + Forecast in eine gemeinsame Zeitachse mergen
  const chartData: ChartPoint[] = useMemo(() => {
    if (!data) return [];

    const anyData: any = data as any;
    const map = new Map<string, ChartPoint>();

    // Helper zum Erzeugen eines ChartPoints
    const ensurePoint = (isoTs: string): ChartPoint => {
      const existing = map.get(isoTs);
      if (existing) return existing;
      const tsMs = new Date(isoTs).getTime();
      const p: ChartPoint = { ts: isoTs, tsMs };
      map.set(isoTs, p);
      return p;
    };

    // Fall 1: Aggregator-Format mit data.history + data.forecast
    if (Array.isArray(anyData.history) && Array.isArray(anyData.forecast)) {
      for (const h of anyData.history) {
        const p = ensurePoint(h.ts);
        p.history = h.value;
      }

      for (const f of anyData.forecast) {
        const p = ensurePoint(f.target_ts);
        p.forecast_q50 = f.q50;
        if (typeof f.q10 === "number") p.forecast_q10 = f.q10;
        if (typeof f.q90 === "number") p.forecast_q90 = f.q90;
      }
    }
    // Fall 2: Direktes Predictor-Format mit data.points[]
    else if (Array.isArray(anyData.points)) {
      for (const pRaw of anyData.points as {
        ts: string;
        q10?: number;
        q50: number;
        q90?: number;
      }[]) {
        const p = ensurePoint(pRaw.ts);
        p.forecast_q50 = pRaw.q50;
        if (typeof pRaw.q10 === "number") p.forecast_q10 = pRaw.q10;
        if (typeof pRaw.q90 === "number") p.forecast_q90 = pRaw.q90;
      }
    } else {
      // unbekanntes Format
      return [];
    }

    return Array.from(map.values()).sort((a, b) =>
      a.tsMs < b.tsMs ? -1 : a.tsMs > b.tsMs ? 1 : 0
    );
  }, [data]);

  // Preis-Zeitreihe extrahieren (EUR/MWh → ct/kWh)
  const priceChartData: PricePoint[] = useMemo(() => {
    if (!data) return [];

    const anyData: any = data as any;
    if (!Array.isArray(anyData.price)) return [];

    return (anyData.price as { ts: string; value: number | null }[])
      .filter((p) => p.value !== null && p.value !== undefined)
      .map((p) => {
        const eurPerMWh = p.value as number;
        const ctPerKWh = eurPerMWh * 0.1; // 1 EUR/MWh = 0.1 ct/kWh
        const tsMs = new Date(p.ts).getTime();
        return {
          ts: p.ts,
          tsMs,
          price: ctPerKWh,
        };
      })
      .sort((a, b) => (a.tsMs < b.tsMs ? -1 : a.tsMs > b.tsMs ? 1 : 0));
  }, [data]);

  // Gemeinsame Zeit-Domain über Last + Preis
  const xDomain = useMemo(() => {
    const allTs: number[] = [];
    for (const p of chartData) allTs.push(p.tsMs);
    for (const p of priceChartData) allTs.push(p.tsMs);

    if (allTs.length === 0) return null;

    const min = Math.min(...allTs);
    const max = Math.max(...allTs);
    return { min, max };
  }, [chartData, priceChartData]);

  const selectedOption = seriesOptions.find((o) => o.value === series);

  // Backend-Namen ermitteln
  const backendName =
    (data as any)?.forecast?.[0]?.backend ??
    (data as any)?.backend ??
    "tirex_v1";

  // Meta-Infos bestmöglich ermitteln
  const historyPoints =
    (data as any)?.meta?.history_points ??
    (Array.isArray((data as any)?.history)
      ? (data as any).history.length
      : 0);
  const forecastPoints =
    (data as any)?.meta?.forecast_points ??
    (Array.isArray((data as any)?.forecast)
      ? (data as any).forecast.length
      : Array.isArray((data as any)?.points)
      ? (data as any).points.length
      : 0);

  const historyFrom =
    (data as any)?.meta?.history_from ??
    (Array.isArray((data as any)?.history) &&
    (data as any).history.length > 0
      ? (data as any).history[0].ts
      : chartData.length > 0
      ? chartData[0].ts
      : undefined);

  const forecastTo =
    (data as any)?.meta?.forecast_to ??
    (Array.isArray((data as any)?.forecast) &&
    (data as any).forecast.length > 0
      ? (data as any).forecast[(data as any).forecast.length - 1].target_ts
      : chartData.length > 0
      ? chartData[chartData.length - 1].ts
      : undefined);

  const xAxisDomain =
    xDomain !== null ? [xDomain.min, xDomain.max] : ["auto", "auto"];

  return (
    <div className="space-y-4">
      {/* Header + Branding */}
      <div className="flex flex-wrap items-baseline gap-3 justify-between">
        <div className="space-y-1">
          <div className="text-sm text-slate-400">
            KI-basierte Prognose (History + Forecast, soweit verfügbar).
          </div>
          {data && (
            <div className="text-[11px] text-slate-500">
              History: {historyPoints} Punkte · Forecast: {forecastPoints} Punkte
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-wide text-emerald-300">
            Powered by TiRex (NXAI)
          </div>
          <div className="text-[10px] text-slate-500">Backend: {backendName}</div>
        </div>
      </div>

      {/* Filter-Bereich */}
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

      {/* Status / Fehler */}
      {loading && (
        <div className="text-sm text-slate-300">Lade Forecast-Daten…</div>
      )}

      {error && !loading && (
        <div className="text-sm text-red-400 border border-red-700/60 rounded-md px-3 py-2 bg-red-950/40">
          {error}
        </div>
      )}

      {/* Last-Chart (History + Forecast) */}
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
                  backgroundColor: "#020617", // slate-950
                  borderColor: "#334155", // slate-600
                  color: "#e5e7eb", // slate-200
                  fontSize: 11,
                }}
                labelStyle={{
                  color: "#e5e7eb",
                }}
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
                      ? "Forecast q90 (oberes Band)"
                      : name === "forecast_q50"
                      ? "Forecast q50 (Median)"
                      : name === "forecast_q10"
                      ? "Forecast q10 (unteres Band)"
                      : name;
                  return [
                    value?.toFixed ? value.toFixed(3) + " kW" : value,
                    label,
                  ];
                }}
              />
              <Legend />

              {/* History-Linie */}
              <Line
                type="monotone"
                dataKey="history"
                name="History"
                dot={false}
                strokeWidth={1.8}
              />

              {/* Forecast-Quantile: oben q90, Mitte q50, unten q10 */}
              <Line
                type="monotone"
                dataKey="forecast_q90"
                name="Forecast q90 (oberes Band)"
                dot={false}
                strokeWidth={1}
                strokeDasharray="3 3"
                opacity={0.7}
              />
              <Line
                type="monotone"
                dataKey="forecast_q50"
                name="Forecast q50 (Median)"
                dot={false}
                strokeWidth={2}
                strokeDasharray="5 3"
              />
              <Line
                type="monotone"
                dataKey="forecast_q10"
                name="Forecast q10 (unteres Band)"
                dot={false}
                strokeWidth={1}
                strokeDasharray="3 3"
                opacity={0.7}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Preis-Chart */}
      {!loading &&
        !error &&
        data &&
        priceChartData.length > 0 && (
          <div className="w-full h-[260px] border border-slate-800 rounded-xl bg-slate-950/60 p-3">
            <div className="text-[11px] text-slate-400 mb-1">
              Strompreis-Verlauf (z.B. Awattar / EPEX), Einheit: ct/kWh
            </div>
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
                <YAxis
                  tick={{ fontSize: 10 }}
                  width={50}
                  domain={["auto", "auto"]}
                />
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
                <Line
                  type="monotone"
                  dataKey="price"
                  name="Preis"
                  dot={false}
                  strokeWidth={1.8}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

      {!loading && !error && data && chartData.length === 0 && (
        <div className="text-sm text-slate-300">
          Keine Daten im gewählten Zeitraum vorhanden.
        </div>
      )}

      {/* Info-Box */}
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

