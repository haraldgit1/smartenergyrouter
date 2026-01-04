// src/components/ki/weather-forecast-charts.tsx
"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { useMemo } from "react";
import type { TiRexChartsResponse } from "@/lib/api";

type Props = {
  data: TiRexChartsResponse;
};

type Row = {
  tsIso: string;
  time: number; // epoch ms
  temp: number | null;
  ghi: number | null;
};

export function WeatherForecastCharts({ data }: Props) {
  const { rows, stats, timeDomain, nowTime } = useMemo(() => {
    const rows: Row[] = [];

    const axis = data.axis ?? [];
    const temps = data.weather_temp_c ?? [];
    const ghis = data.weather_ghi_w_m2 ?? [];

    const len = Math.min(axis.length, temps.length, ghis.length);

    let tempMin = Number.POSITIVE_INFINITY;
    let tempMax = Number.NEGATIVE_INFINITY;
    let ghiMin = Number.POSITIVE_INFINITY;
    let ghiMax = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < len; i++) {
      const tsIso = axis[i];
      const time = new Date(tsIso).getTime();
      const temp = temps[i] ?? null;
      const ghi = ghis[i] ?? null;

      rows.push({ tsIso, time, temp, ghi });

      if (temp != null) {
        tempMin = Math.min(tempMin, temp);
        tempMax = Math.max(tempMax, temp);
      }
      if (ghi != null) {
        ghiMin = Math.min(ghiMin, ghi);
        ghiMax = Math.max(ghiMax, ghi);
      }
    }

    if (!Number.isFinite(tempMin)) tempMin = 0;
    if (!Number.isFinite(tempMax)) tempMax = 0;
    if (!Number.isFinite(ghiMin)) ghiMin = 0;
    if (!Number.isFinite(ghiMax)) ghiMax = 0;

    const timeDomain: [number, number] =
      rows.length > 0
        ? [rows[0].time, rows[rows.length - 1].time]
        : [0, 0];

    const nowTime = new Date(data.reference_ts).getTime();

    return {
      rows,
      stats: { tempMin, tempMax, ghiMin, ghiMax },
      timeDomain,
      nowTime,
    };
  }, [data]);

  if (!rows.length) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-400">
        Keine Wetterdaten für das angeforderte Zeitfenster gefunden.
      </div>
    );
  }

  const formatTime = (value: number) =>
    new Date(value).toLocaleString(undefined, {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  const formatTooltipLabel = (value: any) =>
    typeof value === "number" ? formatTime(value) : String(value);

  return (
    <div className="space-y-6">
      {/* Temperatur */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">
              Temperatur (°C)
            </h2>
            <p className="text-xs text-slate-400">
              Historische Messwerte und Forecast-Zeitraum im TiRex-Fenster.
            </p>
          </div>
          <div className="text-xs text-slate-400 text-right">
            Range: {stats.tempMin.toFixed(1)} – {stats.tempMax.toFixed(1)} °C
          </div>
        </div>

        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis
                dataKey="time"
                type="number"
                domain={timeDomain}
                tickFormatter={formatTime}
                tick={{ fontSize: 10, fill: "#94a3b8" }}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                width={40}
                tickFormatter={(v) => `${v.toFixed(0)}`}
              />
              <Tooltip
                labelFormatter={formatTooltipLabel}
                contentStyle={{
                  backgroundColor: "#020617",
                  borderColor: "#1e293b",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <ReferenceLine
                x={nowTime}
                stroke="#eab308"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
              <Line
                type="monotone"
                dataKey="temp"
                stroke="#38bdf8"
                dot={false}
                strokeWidth={2}
                name="Temperatur"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Globalstrahlung / GHI */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">
              Globalstrahlung GHI (W/m²)
            </h2>
            <p className="text-xs text-slate-400">
              Solarstrahlung als Basis für PV-Ertragsprognosen.
            </p>
          </div>
          <div className="text-xs text-slate-400 text-right">
            Range: {stats.ghiMin.toFixed(0)} – {stats.ghiMax.toFixed(0)} W/m²
          </div>
        </div>

        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis
                dataKey="time"
                type="number"
                domain={timeDomain}
                tickFormatter={formatTime}
                tick={{ fontSize: 10, fill: "#94a3b8" }}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                width={50}
                tickFormatter={(v) => `${v.toFixed(0)}`}
              />
              <Tooltip
                labelFormatter={formatTooltipLabel}
                contentStyle={{
                  backgroundColor: "#020617",
                  borderColor: "#1e293b",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <ReferenceLine
                x={nowTime}
                stroke="#eab308"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
              <Area
                type="monotone"
                dataKey="ghi"
                stroke="#22c55e"
                fill="#22c55e33"
                name="GHI"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

