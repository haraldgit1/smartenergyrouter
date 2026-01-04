// src/app/ki/tirex_charts/page.tsx
"use client";

import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";

type TiRexChartsResponse = {
  reference_ts: string;
  start_ts: string;
  end_ts: string;
  resolution_minutes: number;
  axis: string[];
  load_actual: (number | null)[];
  load_q50: (number | null)[];
  load_q10: (number | null)[];
  load_q90: (number | null)[];
  price_ct_per_kwh: (number | null)[];
  weather_temp_c: (number | null)[];
  weather_ghi_w_m2: (number | null)[];
  now_index: number;
  forecast_data_start_ts: string | null;
  forecast_data_end_ts: string | null;
  price_data_start_ts: string | null;
  price_data_end_ts: string | null;

  // Preis-History
  price_ct_per_kwh_compare?: (number | null)[];
  price_compare_generated_ts?: string | null;

  // Last-History
  load_q10_compare?: (number | null)[];
  load_q50_compare?: (number | null)[];
  load_q90_compare?: (number | null)[];
  load_compare_generated_ts?: string | null;

  // Wetter-History
  weather_temp_c_compare?: (number | null)[];
  weather_ghi_w_m2_compare?: (number | null)[];
  weather_compare_generated_ts?: string | null;

  // optional: Regen / Regenwahrscheinlichkeit / Wind
  weather_rain_mm?: (number | null)[];
  weather_rain_mm_compare?: (number | null)[];
  weather_rain_prob_pct?: (number | null)[];
  weather_rain_prob_pct_compare?: (number | null)[];
  weather_wind_kmh?: (number | null)[];
  weather_wind_kmh_compare?: (number | null)[];
};

const DEFAULT_SERIES = "meter1:load_kw";
const DEFAULT_HISTORY_HOURS = 48;
const DEFAULT_HORIZON_HOURS = 48;
const DEFAULT_RESOLUTION_MINUTES = 60;

// Demo-Profile für die Auswahl
const SERIES_OPTIONS = [
  {
    value: "meter1:load_kw",
    label: "Demo 1 – Idealized Sine Load",
  },
  {
    value: "residential1:load_kw",
    label: "Demo 2 – Residential PV Complex",
  },
];

// Prototyp-Standort – passend zum Wetter-Loader
const WEATHER_LOCATION = {
  name: "Graz, Österreich",
  lat: 47.07,
  lon: 15.44,
};

export const dynamic = "force-dynamic";

export default function TiRexChartsPage() {
  const [data, setData] = useState<TiRexChartsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compareBackHours, setCompareBackHours] = useState<number | null>(null);
  const [series, setSeries] = useState<string>(DEFAULT_SERIES);

  useEffect(() => {
    const nowIso = new Date().toISOString();

    const params = new URLSearchParams({
      series: series,
      history_hours: String(DEFAULT_HISTORY_HOURS),
      horizon_hours: String(DEFAULT_HORIZON_HOURS),
      resolution_minutes: String(DEFAULT_RESOLUTION_MINUTES),
      reference_ts: nowIso,
    });

    if (compareBackHours && compareBackHours > 0) {
      params.set("compare_back_hours", String(compareBackHours));
    }

    fetch(`/api/tirex_charts?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`${res.status} – ${text}`);
        }
        return res.json();
      })
      .then((json: TiRexChartsResponse) => {
        console.log("TiRexChartsResponse", json);
        setData(json);
        setError(null);
      })
      .catch((err) => {
        console.error("TiRexChartsPage error:", err);
        setError(err.message ?? String(err));
      });
  }, [compareBackHours, series]);

  // --------- Zeitformat-Helfer (einheitlich) -------------------

  const formatDate = (d: Date) =>
    d.toLocaleString("de-AT", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
    });

  const formatTsStr = (ts: string) => formatDate(new Date(ts));
  const formatTsMs = (ms: number) => formatDate(new Date(ms));

  const currentSeriesLabel =
    SERIES_OPTIONS.find((o) => o.value === series)?.label ?? series;

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">TiRex Charts</h1>
        <div className="rounded-lg border border-red-500/40 bg-red-950/20 p-3 text-sm text-red-200">
          Fehler beim Laden der TiRex-Charts: {error}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">TiRex Charts</h1>
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-sm text-slate-300">
          Lade TiRex-Daten …
        </div>
      </div>
    );
  }

  // -------- Datenaufbereitung mit echter Zeitachse --------------

  const axis = data.axis ?? [];
  const now_index = data.now_index ?? -1;
  const nowTs =
    now_index >= 0 && now_index < axis.length ? axis[now_index] : null;
  const nowMs = nowTs ? Date.parse(nowTs) : null;

  // Last – Forecast nur ab nowMs, links nur Ist-Werte
  const loadChartData = axis.map((ts, i) => {
    const t = Date.parse(ts);
    const isPast = nowMs !== null && t < nowMs;

    const q10_compare =
      data.load_q10_compare && data.load_q10_compare.length > i
        ? data.load_q10_compare[i]
        : null;
    const q50_compare =
      data.load_q50_compare && data.load_q50_compare.length > i
        ? data.load_q50_compare[i]
        : null;
    const q90_compare =
      data.load_q90_compare && data.load_q90_compare.length > i
        ? data.load_q90_compare[i]
        : null;

    return {
      ts,
      t,
      actual: data.load_actual[i],
      // Forecast-Linien nur ab "jetzt" sichtbar
      q50: isPast ? null : data.load_q50[i],
      q10: isPast ? null : data.load_q10[i],
      q90: isPast ? null : data.load_q90[i],
      q10_compare,
      q50_compare,
      q90_compare,
    };
  });

  // Preis
  const priceChartData = axis.map((ts, i) => {
    const t = Date.parse(ts);
    const price = data.price_ct_per_kwh[i];
    const priceCompare =
      data.price_ct_per_kwh_compare &&
      data.price_ct_per_kwh_compare.length > i
        ? data.price_ct_per_kwh_compare[i]
        : null;

    return {
      ts,
      t,
      price,
      price_compare: priceCompare,
    };
  });

  // Wetter: Temp + GHI
  const weatherChartData = axis.map((ts, i) => {
    const t = Date.parse(ts);

    const temp_compare =
      data.weather_temp_c_compare &&
      data.weather_temp_c_compare.length > i
        ? data.weather_temp_c_compare[i]
        : null;

    const ghi_compare =
      data.weather_ghi_w_m2_compare &&
      data.weather_ghi_w_m2_compare.length > i
        ? data.weather_ghi_w_m2_compare[i]
        : null;

    return {
      ts,
      t,
      temp: data.weather_temp_c[i],
      ghi: data.weather_ghi_w_m2[i],
      temp_compare,
      ghi_compare,
    };
  });

  // Regen / Regenwahrscheinlichkeit / Wind
  const rainChartData = axis.map((ts, i) => {
    const t = Date.parse(ts);

    const rain_mm =
      data.weather_rain_mm && data.weather_rain_mm.length > i
        ? data.weather_rain_mm[i]
        : null;
    const rain_mm_compare =
      data.weather_rain_mm_compare &&
      data.weather_rain_mm_compare.length > i
        ? data.weather_rain_mm_compare[i]
        : null;

    const rain_prob =
      data.weather_rain_prob_pct &&
      data.weather_rain_prob_pct.length > i
        ? data.weather_rain_prob_pct[i]
        : null;
    const rain_prob_compare =
      data.weather_rain_prob_pct_compare &&
      data.weather_rain_prob_pct_compare.length > i
        ? data.weather_rain_prob_pct_compare[i]
        : null;

    const wind_kmh =
      data.weather_wind_kmh && data.weather_wind_kmh.length > i
        ? data.weather_wind_kmh[i]
        : null;
    const wind_kmh_compare =
      data.weather_wind_kmh_compare &&
      data.weather_wind_kmh_compare.length > i
        ? data.weather_wind_kmh_compare[i]
        : null;

    return {
      ts,
      t,
      rain_mm,
      rain_mm_compare,
      rain_prob,
      rain_prob_compare,
      wind_kmh,
      wind_kmh_compare,
    };
  });

  // Kosten-Chart: Last x Preis – Forecast-Kosten nur ab nowMs
  const costChartData = axis.map((ts, i) => {
    const t = Date.parse(ts);
    const isPast = nowMs !== null && t < nowMs;

    const load = loadChartData[i];
    const price = priceChartData[i];

    const priceVal = price?.price ?? null;
    const priceCmp = price?.price_compare ?? null;

    const cost_actual =
      load.actual != null && priceVal != null
        ? load.actual * priceVal
        : null;

    const cost_q10 =
      !isPast && load.q10 != null && priceVal != null
        ? load.q10 * priceVal
        : null;
    const cost_q50 =
      !isPast && load.q50 != null && priceVal != null
        ? load.q50 * priceVal
        : null;
    const cost_q90 =
      !isPast && load.q90 != null && priceVal != null
        ? load.q90 * priceVal
        : null;

    const cost_q10_compare =
      load.q10_compare != null && priceCmp != null
        ? load.q10_compare * priceCmp
        : null;
    const cost_q50_compare =
      load.q50_compare != null && priceCmp != null
        ? load.q50_compare * priceCmp
        : null;
    const cost_q90_compare =
      load.q90_compare != null && priceCmp != null
        ? load.q90_compare * priceCmp
        : null;

    return {
      ts,
      t,
      cost_actual,
      cost_q10,
      cost_q50,
      cost_q90,
      cost_q10_compare,
      cost_q50_compare,
      cost_q90_compare,
    };
  });

  const hasLoadData = loadChartData.some(
    (p) =>
      p.actual != null || p.q50 != null || p.q10 != null || p.q90 != null
  );
  const hasLoadCompare = loadChartData.some(
    (p) =>
      p.q10_compare != null || p.q50_compare != null || p.q90_compare != null
  );

  const hasPriceData = priceChartData.some((p) => p.price != null);
  const hasPriceCompare = priceChartData.some(
    (p) => p.price_compare != null
  );
  const hasAnyPrice = hasPriceData || hasPriceCompare;

  const hasWeatherTemp = weatherChartData.some((p) => p.temp != null);
  const hasWeatherGhi = weatherChartData.some((p) => p.ghi != null);
  const hasWeatherTempCompare = weatherChartData.some(
    (p) => p.temp_compare != null
  );
  const hasWeatherGhiCompare = weatherChartData.some(
    (p) => p.ghi_compare != null
  );
  const hasAnyWeather = hasWeatherTemp || hasWeatherGhi;
  const hasAnyWeatherCompare =
    hasWeatherTempCompare || hasWeatherGhiCompare;

  const hasRainMm = rainChartData.some((p) => p.rain_mm != null);
  const hasRainProb = rainChartData.some((p) => p.rain_prob != null);
  const hasWind = rainChartData.some((p) => p.wind_kmh != null);

  const hasRainMmCompare = rainChartData.some(
    (p) => p.rain_mm_compare != null
  );
  const hasRainProbCompare = rainChartData.some(
    (p) => p.rain_prob_compare != null
  );
  const hasWindCompare = rainChartData.some(
    (p) => p.wind_kmh_compare != null
  );

  const hasAnyRainOrWind = hasRainMm || hasRainProb || hasWind;
  const hasAnyRainOrWindCompare =
    hasRainMmCompare || hasRainProbCompare || hasWindCompare;

  const hasCostData = costChartData.some(
    (p) =>
      p.cost_actual != null ||
      p.cost_q10 != null ||
      p.cost_q50 != null ||
      p.cost_q90 != null
  );
  const hasCostCompare = costChartData.some(
    (p) =>
      p.cost_q10_compare != null ||
      p.cost_q50_compare != null ||
      p.cost_q90_compare != null
  );

  const LOAD_TOOLTIP_ORDER = ["q90", "q50", "q10", "actual"];
  const COST_TOOLTIP_ORDER = [
    "cost_q90",
    "cost_q50",
    "cost_q10",
    "cost_actual",
  ];

  // Farben
  const COLOR_BLUE = "#60a5fa";
  const COLOR_GREEN = "#22c55e";
  const COLOR_RED = "#ef4444";
  const COLOR_YELLOW = "#facc15";
  const COLOR_LIGHT_GREEN = "#5eead4";
  const COLOR_LIGHT_BLUE = "#93c5fd";
  const COLOR_PINK = "#fb7185";

  const HISTORY_STEPS = [
    1, 2, 3, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 23,
  ];

  return (
    <div className="space-y-6">
      {/* Kopfzeile */}
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            TiRex Charts – {currentSeriesLabel}
          </h1>
          <p className="text-sm text-slate-400">
            Live-orientierte Sicht rund um den aktuellen Zeitpunkt:
            Last-History &amp; Forecast, Strompreis (Awattar), Kosten und Wetter
            auf gemeinsamer Zeitachse – inklusive Prognose-Historie.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Interne Serie:{" "}
            <span className="font-mono text-slate-300">{series}</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 text-xs text-slate-400">
          {/* Demo-Lastprofil */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Demo-Lastprofil:</span>
            <select
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100"
              value={series}
              onChange={(e) => setSeries(e.target.value)}
            >
              {SERIES_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1 text-right">
            <div>
              Range: {formatTsStr(data.start_ts)} – {formatTsStr(data.end_ts)} (
              {data.resolution_minutes} min)
            </div>
            <div>
              Backend-Referenz:{" "}
              <span className="font-mono text-amber-200">
                {formatTsStr(data.reference_ts)}
              </span>
            </div>
            {nowTs && (
              <div>
                Jetzt-Linie:{" "}
                <span className="font-mono text-amber-200">
                  {formatTsStr(nowTs)}
                </span>
              </div>
            )}

            {data.forecast_data_start_ts && data.forecast_data_end_ts && (
              <div>
                Last-Forecast in DB:{" "}
                <span className="font-mono">
                  {formatTsStr(data.forecast_data_start_ts)} –{" "}
                  {formatTsStr(data.forecast_data_end_ts)}
                </span>
              </div>
            )}

            {data.price_data_start_ts && data.price_data_end_ts && (
              <div>
                Preise in DB:{" "}
                <span className="font-mono">
                  {formatTsStr(data.price_data_start_ts)} –{" "}
                  {formatTsStr(data.price_data_end_ts)}
                </span>
              </div>
            )}

            {data.load_compare_generated_ts && hasLoadCompare && (
              <div>
                Last-History:{" "}
                <span className="font-mono">
                  Stand {formatTsStr(data.load_compare_generated_ts)}
                </span>
                {compareBackHours && (
                  <span className="ml-1 text-slate-500">
                    ({compareBackHours}h zurück)
                  </span>
                )}
              </div>
            )}

            {data.price_compare_generated_ts && hasPriceCompare && (
              <div>
                Preis-History:{" "}
                <span className="font-mono">
                  Stand {formatTsStr(data.price_compare_generated_ts)}
                </span>
                {compareBackHours && (
                  <span className="ml-1 text-slate-500">
                    ({compareBackHours}h zurück)
                  </span>
                )}
              </div>
            )}

            {data.weather_compare_generated_ts && hasAnyWeatherCompare && (
              <div>
                Wetter-History:{" "}
                <span className="font-mono">
                  Stand {formatTsStr(data.weather_compare_generated_ts)}
                </span>
                {compareBackHours && (
                  <span className="ml-1 text-slate-500">
                    ({compareBackHours}h zurück)
                  </span>
                )}
              </div>
            )}
          </div>

          {/* History-Vergleich */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">
              History-Vergleich (Last/Preis/Wetter):
            </span>
            <select
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100"
              value={compareBackHours === null ? "" : String(compareBackHours)}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "") {
                  setCompareBackHours(null);
                } else {
                  const n = Number(v);
                  setCompareBackHours(Number.isFinite(n) ? n : null);
                }
              }}
            >
              <option value="">keine</option>
              {HISTORY_STEPS.map((h) => (
                <option key={h} value={h}>
                  {h} h zurück
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Hinweise */}
      {!hasLoadData && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-950/20 p-3 text-xs text-amber-200">
          Für den aktuellen Zeitraum liegen noch keine Lastdaten vor.
        </div>
      )}

      {!hasAnyPrice && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-950/20 p-3 text-xs text-amber-200">
          Keine Strompreis-Daten verfügbar.
        </div>
      )}

      {/* 1) Last */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
        <h2 className="mb-2 text-sm font-semibold text-slate-200">
          Last (Ist + Forecast + History)
        </h2>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={loadChartData} syncId="tirex-sync">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="t"
                type="number"
                domain={["auto", "auto"]}
                tickFormatter={(value) => formatTsMs(value as number)}
                minTickGap={32}
                tick={{ fontSize: 10 }}
              />
              <YAxis
                tick={{ fontSize: 10 }}
                label={{
                  value: "kW",
                  angle: -90,
                  position: "insideLeft",
                  style: { fontSize: 10, fill: "#cbd5f5" },
                }}
              />
              <Tooltip
                labelFormatter={(value) => formatTsMs(value as number)}
                contentStyle={{
                  backgroundColor: "#020617",
                  borderColor: "#1e293b",
                  borderRadius: 8,
                  padding: 8,
                  color: "#e5e7eb",
                }}
                labelStyle={{
                  color: "#cbd5f5",
                  fontSize: 11,
                  marginBottom: 4,
                }}
                itemStyle={{ fontSize: 11 }}
                itemSorter={(item) =>
                  LOAD_TOOLTIP_ORDER.indexOf(
                    (item?.dataKey as string) ?? "zzz"
                  )
                }
              />
              {nowMs !== null && (
                <ReferenceLine
                  x={nowMs}
                  stroke="#fbbf24"
                  strokeDasharray="4 4"
                />
              )}
              {hasLoadData && (
                <>
                  {hasLoadCompare && (
                    <>
                      <Line
                        type="linear"
                        dataKey="q90_compare"
                        name={
                          compareBackHours
                            ? `Forecast q90 (Stand vor ${compareBackHours}h)`
                            : "Forecast q90 (History)"
                        }
                        dot={false}
                        stroke={COLOR_PINK}
                        strokeWidth={1}
                        strokeDasharray="3 2"
                        connectNulls={false}
                      />
                      <Line
                        type="linear"
                        dataKey="q50_compare"
                        name={
                          compareBackHours
                            ? `Forecast q50 (Stand vor ${compareBackHours}h)`
                            : "Forecast q50 (History)"
                        }
                        dot={false}
                        stroke={COLOR_LIGHT_BLUE}
                        strokeWidth={1}
                        strokeDasharray="3 2"
                        connectNulls={false}
                      />
                      <Line
                        type="linear"
                        dataKey="q10_compare"
                        name={
                          compareBackHours
                            ? `Forecast q10 (Stand vor ${compareBackHours}h)`
                            : "Forecast q10 (History)"
                        }
                        dot={false}
                        stroke={COLOR_LIGHT_GREEN}
                        strokeWidth={1}
                        strokeDasharray="3 2"
                        connectNulls={false}
                      />
                    </>
                  )}
                  <Line
                    type="linear"
                    dataKey="q90"
                    name="Forecast q90"
                    dot={{ r: 1, stroke: COLOR_RED, fill: COLOR_RED }}
                    activeDot={{ r: 5 }}
                    stroke={COLOR_RED}
                    strokeWidth={1.4}
                    connectNulls={false}
                  />
                  <Line
                    type="linear"
                    dataKey="q50"
                    name="Forecast q50"
                    dot={{ r: 1, stroke: COLOR_BLUE, fill: COLOR_BLUE }}
                    activeDot={{ r: 5 }}
                    stroke={COLOR_BLUE}
                    strokeWidth={1.4}
                    connectNulls={false}
                  />
                  <Line
                    type="linear"
                    dataKey="q10"
                    name="Forecast q10"
                    dot={{ r: 1, stroke: COLOR_GREEN, fill: COLOR_GREEN }}
                    activeDot={{ r: 5 }}
                    stroke={COLOR_GREEN}
                    strokeWidth={1.4}
                    connectNulls={false}
                  />
                  <Line
                    type="linear"
                    dataKey="actual"
                    name="Ist"
                    stroke={COLOR_BLUE}
                    strokeWidth={1.8}
                    dot={{ r: 1, stroke: COLOR_BLUE, fill: COLOR_BLUE }}
                    activeDot={{ r: 5 }}
                    connectNulls={false}
                  />
                </>
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 1b) Kosten */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
        <h2 className="mb-2 text-sm font-semibold text-slate-200">
          Kostenrate (Last × Preis)
        </h2>
        <p className="mb-2 text-xs text-slate-400">
          Last (kW) × Strompreis (ct/kWh) ≈ Kostenrate in ct/h. Im Forecast:
          q10/q50/q90 entsprechend der Last-Verteilung.
        </p>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={costChartData} syncId="tirex-sync">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="t"
                type="number"
                domain={["auto", "auto"]}
                tickFormatter={(value) => formatTsMs(value as number)}
                minTickGap={32}
                tick={{ fontSize: 10 }}
              />
              <YAxis
                tick={{ fontSize: 10 }}
                label={{
                  value: "ct/h",
                  angle: -90,
                  position: "insideLeft",
                  style: { fontSize: 10, fill: "#cbd5f5" },
                }}
              />
              <Tooltip
                labelFormatter={(value) => formatTsMs(value as number)}
                contentStyle={{
                  backgroundColor: "#020617",
                  borderColor: "#1e293b",
                  borderRadius: 8,
                  padding: 8,
                  color: "#e5e7eb",
                }}
                labelStyle={{
                  color: "#cbd5f5",
                  fontSize: 11,
                  marginBottom: 4,
                }}
                itemStyle={{ fontSize: 11 }}
                itemSorter={(item) =>
                  COST_TOOLTIP_ORDER.indexOf(
                    (item?.dataKey as string) ?? "zzz"
                  )
                }
              />
              {nowMs !== null && (
                <ReferenceLine
                  x={nowMs}
                  stroke="#fbbf24"
                  strokeDasharray="4 4"
                />
              )}
              {hasCostData && (
                <>
                  {hasCostCompare && (
                    <>
                      <Line
                        type="linear"
                        dataKey="cost_q90_compare"
                        name={
                          compareBackHours
                            ? `Kosten q90 (Stand vor ${compareBackHours}h)`
                            : "Kosten q90 (History)"
                        }
                        dot={false}
                        stroke={COLOR_PINK}
                        strokeWidth={1}
                        strokeDasharray="3 2"
                        connectNulls={false}
                      />
                      <Line
                        type="linear"
                        dataKey="cost_q50_compare"
                        name={
                          compareBackHours
                            ? `Kosten q50 (Stand vor ${compareBackHours}h)`
                            : "Kosten q50 (History)"
                        }
                        dot={false}
                        stroke={COLOR_LIGHT_BLUE}
                        strokeWidth={1}
                        strokeDasharray="3 2"
                        connectNulls={false}
                      />
                      <Line
                        type="linear"
                        dataKey="cost_q10_compare"
                        name={
                          compareBackHours
                            ? `Kosten q10 (Stand vor ${compareBackHours}h)`
                            : "Kosten q10 (History)"
                        }
                        dot={false}
                        stroke={COLOR_LIGHT_GREEN}
                        strokeWidth={1}
                        strokeDasharray="3 2"
                        connectNulls={false}
                      />
                    </>
                  )}
                  <Line
                    type="linear"
                    dataKey="cost_q90"
                    name="Kosten q90"
                    dot={{ r: 1, stroke: COLOR_RED, fill: COLOR_RED }}
                    activeDot={{ r: 5 }}
                    stroke={COLOR_RED}
                    strokeWidth={1.4}
                    connectNulls={false}
                  />
                  <Line
                    type="linear"
                    dataKey="cost_q50"
                    name="Kosten q50"
                    dot={{ r: 1, stroke: COLOR_BLUE, fill: COLOR_BLUE }}
                    activeDot={{ r: 5 }}
                    stroke={COLOR_BLUE}
                    strokeWidth={1.4}
                    connectNulls={false}
                  />
                  <Line
                    type="linear"
                    dataKey="cost_q10"
                    name="Kosten q10"
                    dot={{ r: 1, stroke: COLOR_GREEN, fill: COLOR_GREEN }}
                    activeDot={{ r: 5 }}
                    stroke={COLOR_GREEN}
                    strokeWidth={1.4}
                    connectNulls={false}
                  />
                  <Line
                    type="linear"
                    dataKey="cost_actual"
                    name="Kosten Ist"
                    stroke={COLOR_BLUE}
                    strokeWidth={1.8}
                    dot={{ r: 1, stroke: COLOR_BLUE, fill: COLOR_BLUE }}
                    activeDot={{ r: 5 }}
                    connectNulls={false}
                  />
                </>
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 2) Strompreis */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
        <h2 className="mb-2 text-sm font-semibold text-slate-200">
          Strompreis (Awattar)
        </h2>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={priceChartData} syncId="tirex-sync">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="t"
                type="number"
                domain={["auto", "auto"]}
                tickFormatter={(value) => formatTsMs(value as number)}
                minTickGap={32}
                tick={{ fontSize: 10 }}
              />
              <YAxis
                tick={{ fontSize: 10 }}
                label={{
                  value: "ct/kWh",
                  angle: -90,
                  position: "insideLeft",
                  style: { fontSize: 10, fill: "#cbd5f5" },
                }}
              />
              <Tooltip
                labelFormatter={(value) => formatTsMs(value as number)}
                contentStyle={{
                  backgroundColor: "#020617",
                  borderColor: "#1e293b",
                  borderRadius: 8,
                  padding: 8,
                  color: "#e5e7eb",
                }}
                labelStyle={{
                  color: "#cbd5f5",
                  fontSize: 11,
                  marginBottom: 4,
                }}
              />
              {nowMs !== null && (
                <ReferenceLine
                  x={nowMs}
                  stroke="#fbbf24"
                  strokeDasharray="4 4"
                />
              )}
              {hasAnyPrice && (
                <>
                  {hasPriceData && (
                    <Line
                      type="monotone"
                      dataKey="price"
                      name="Preis aktuell"
                      dot={false}
                      stroke={COLOR_BLUE}
                      strokeWidth={1.8}
                    />
                  )}
                  {hasPriceCompare && (
                    <Line
                      type="monotone"
                      dataKey="price_compare"
                      name={
                        compareBackHours
                          ? `Preis (Stand vor ${compareBackHours}h)`
                          : "Preis Vergleich"
                      }
                      dot={false}
                      stroke={COLOR_YELLOW}
                      strokeWidth={1.4}
                      strokeDasharray="4 2"
                    />
                  )}
                </>
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 3) Temperatur */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-200">
              Temperatur (°C)
            </h2>
            <p className="text-xs text-slate-400">
              Wetter für {WEATHER_LOCATION.name} ·{" "}
              {WEATHER_LOCATION.lat.toFixed(2)}°N,{" "}
              {WEATHER_LOCATION.lon.toFixed(2)}°E
            </p>
          </div>
        </div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={weatherChartData} syncId="tirex-sync">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="t"
                type="number"
                domain={["auto", "auto"]}
                tickFormatter={(value) => formatTsMs(value as number)}
                minTickGap={32}
                tick={{ fontSize: 10 }}
              />
              <YAxis
                tick={{ fontSize: 10 }}
                label={{
                  value: "°C",
                  angle: -90,
                  position: "insideLeft",
                  style: { fontSize: 10, fill: "#cbd5f5" },
                }}
              />
              <Tooltip
                labelFormatter={(value) => formatTsMs(value as number)}
                contentStyle={{
                  backgroundColor: "#020617",
                  borderColor: "#1e293b",
                  borderRadius: 8,
                  padding: 8,
                  color: "#e5e7eb",
                }}
                labelStyle={{
                  color: "#cbd5f5",
                  fontSize: 11,
                  marginBottom: 4,
                }}
              />
              {nowMs !== null && (
                <ReferenceLine
                  x={nowMs}
                  stroke="#fbbf24"
                  strokeDasharray="4 4"
                />
              )}
              {hasWeatherTemp && (
                <>
                  {hasWeatherTempCompare && (
                    <Line
                      type="monotone"
                      dataKey="temp_compare"
                      name={
                        compareBackHours
                          ? `Temperatur (Stand vor ${compareBackHours}h)`
                          : "Temperatur (History)"
                      }
                      dot={false}
                      stroke={COLOR_YELLOW}
                      strokeWidth={1.2}
                      strokeDasharray="4 2"
                    />
                  )}
                  <Line
                    type="monotone"
                    dataKey="temp"
                    name="Temperatur"
                    dot={false}
                    stroke={COLOR_BLUE}
                    strokeWidth={1.8}
                  />
                </>
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 4) Globalstrahlung */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
        <h2 className="mb-2 text-sm font-semibold text-slate-200">
          Globalstrahlung GHI (W/m²)
        </h2>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={weatherChartData} syncId="tirex-sync">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="t"
                type="number"
                domain={["auto", "auto"]}
                tickFormatter={(value) => formatTsMs(value as number)}
                minTickGap={32}
                tick={{ fontSize: 10 }}
              />
              <YAxis
                tick={{ fontSize: 10 }}
                label={{
                  value: "W/m²",
                  angle: -90,
                  position: "insideLeft",
                  style: { fontSize: 10, fill: "#cbd5f5" },
                }}
              />
              <Tooltip
                labelFormatter={(value) => formatTsMs(value as number)}
                contentStyle={{
                  backgroundColor: "#020617",
                  borderColor: "#1e293b",
                  borderRadius: 8,
                  padding: 8,
                  color: "#e5e7eb",
                }}
                labelStyle={{
                  color: "#cbd5f5",
                  fontSize: 11,
                  marginBottom: 4,
                }}
              />
              {nowMs !== null && (
                <ReferenceLine
                  x={nowMs}
                  stroke="#fbbf24"
                  strokeDasharray="4 4"
                />
              )}
              {hasWeatherGhi && (
                <>
                  {hasWeatherGhiCompare && (
                    <Line
                      type="monotone"
                      dataKey="ghi_compare"
                      name={
                        compareBackHours
                          ? `GHI (Stand vor ${compareBackHours}h)`
                          : "GHI (History)"
                      }
                      dot={false}
                      stroke={COLOR_YELLOW}
                      strokeWidth={1.2}
                      strokeDasharray="4 2"
                    />
                  )}
                  <Area
                    type="monotone"
                    dataKey="ghi"
                    name="GHI"
                    stroke={COLOR_GREEN}
                    fill="#22c55e33"
                  />
                </>
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {!hasAnyWeather && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-950/20 p-3 text-xs text-amber-200">
          Für das aktuelle Zeitfenster liegen keine Wetterdaten (Temp/GHI) vor.
        </div>
      )}

      {/* 5) Regen / Regenwahrscheinlichkeit / Wind */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
        <h2 className="mb-2 text-sm font-semibold text-slate-200">
          Regen / Regenwahrscheinlichkeit / Wind
        </h2>
        <p className="mb-2 text-xs text-slate-400">
          Anzeige nur, falls die Wetterdaten Regenmenge (mm), Regenwahrscheinlichkeit
          (%) und/oder Windgeschwindigkeit (km/h) liefern.
        </p>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rainChartData} syncId="tirex-sync">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="t"
                type="number"
                domain={["auto", "auto"]}
                tickFormatter={(value) => formatTsMs(value as number)}
                minTickGap={32}
                tick={{ fontSize: 10 }}
              />
              <YAxis
                tick={{ fontSize: 10 }}
                label={{
                  value: "Regen (mm) / Wkt. (%) / Wind (km/h)",
                  angle: -90,
                  position: "insideLeft",
                  style: { fontSize: 10, fill: "#cbd5f5" },
                }}
              />
              <Tooltip
                labelFormatter={(value) => formatTsMs(value as number)}
                contentStyle={{
                  backgroundColor: "#020617",
                  borderColor: "#1e293b",
                  borderRadius: 8,
                  padding: 8,
                  color: "#e5e7eb",
                }}
                labelStyle={{
                  color: "#cbd5f5",
                  fontSize: 11,
                  marginBottom: 4,
                }}
              />
              {nowMs !== null && (
                <ReferenceLine
                  x={nowMs}
                  stroke="#fbbf24"
                  strokeDasharray="4 4"
                />
              )}
              {hasAnyRainOrWind && (
                <>
                  {hasRainMmCompare && (
                    <Line
                      type="monotone"
                      dataKey="rain_mm_compare"
                      name={
                        compareBackHours
                          ? `Regen (mm, Stand vor ${compareBackHours}h)`
                          : "Regen (mm, History)"
                      }
                      dot={false}
                      stroke={COLOR_YELLOW}
                      strokeWidth={1.2}
                      strokeDasharray="4 2"
                    />
                  )}
                  {hasRainProbCompare && (
                    <Line
                      type="monotone"
                      dataKey="rain_prob_compare"
                      name={
                        compareBackHours
                          ? `Regen-Wkt. % (Stand vor ${compareBackHours}h)`
                          : "Regen-Wkt. % (History)"
                      }
                      dot={false}
                      stroke={COLOR_PINK}
                      strokeWidth={1.2}
                      strokeDasharray="4 2"
                    />
                  )}
                  {hasWindCompare && (
                    <Line
                      type="monotone"
                      dataKey="wind_kmh_compare"
                      name={
                        compareBackHours
                          ? `Wind 10 m (km/h, Stand vor ${compareBackHours}h)`
                          : "Wind 10 m (km/h, History)"
                      }
                      dot={false}
                      stroke={COLOR_LIGHT_BLUE}
                      strokeWidth={1.2}
                      strokeDasharray="4 2"
                    />
                  )}

                  {hasRainMm && (
                    <Line
                      type="monotone"
                      dataKey="rain_mm"
                      name="Regen (mm)"
                      dot={false}
                      stroke={COLOR_BLUE}
                      strokeWidth={1.8}
                    />
                  )}
                  {hasRainProb && (
                    <Line
                      type="monotone"
                      dataKey="rain_prob"
                      name="Regen-Wahrscheinlichkeit (%)"
                      dot={false}
                      stroke={COLOR_GREEN}
                      strokeWidth={1.8}
                    />
                  )}
                  {hasWind && (
                    <Line
                      type="monotone"
                      dataKey="wind_kmh"
                      name="Wind 10 m (km/h)"
                      dot={false}
                      stroke={COLOR_RED}
                      strokeWidth={1.8}
                    />
                  )}
                </>
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {!hasAnyRainOrWind && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-950/20 p-3 text-xs text-amber-200">
          Für das aktuelle Zeitfenster liegen keine Regen-/Wind-Daten (mm/%/km/h)
          vor.
        </div>
      )}
    </div>
  );
}

