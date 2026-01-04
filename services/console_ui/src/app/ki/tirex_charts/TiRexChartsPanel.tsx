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
};

interface Props {
  series: string;
  historyHours: number;
  horizonHours: number;
  resolutionMinutes: number;
}

export default function TiRexChartsPanel({
  series,
  historyHours,
  horizonHours,
  resolutionMinutes,
}: Props) {
  const [data, setData] = useState<TiRexChartsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const nowIso = new Date().toISOString(); // Browser-"jetzt"

    const params = new URLSearchParams({
      series,
      history_hours: String(historyHours),
      horizon_hours: String(horizonHours),
      resolution_minutes: String(resolutionMinutes),
      reference_ts: nowIso,
    });

    fetch(`/api/tirex_charts?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`${res.status} – ${text}`);
        }
        return res.json();
      })
      .then((json: TiRexChartsResponse) => {
        // Debug-Log, damit du im Browser siehst, was wirklich ankommt
        console.log("TiRexChartsResponse", json);
        setData(json);
        setError(null);
      })
      .catch((err) => {
        console.error("TiRexChartsPanel error:", err);
        setError(err.message ?? String(err));
      });
  }, [series, historyHours, horizonHours, resolutionMinutes]);

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/40 bg-red-950/20 p-3 text-sm text-red-200">
        Fehler beim Laden der TiRex-Charts: {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-sm text-slate-300">
        Lade TiRex-Daten …
      </div>
    );
  }

  const { axis, now_index } = data;
  const nowTs = axis[now_index] ?? null;

  // Gemeinsame Chart-Datasets auf Basis der gemeinsamen axis
  const loadChartData = axis.map((ts, i) => ({
    ts,
    actual: data.load_actual[i],
    q50: data.load_q50[i],
    q10: data.load_q10[i],
    q90: data.load_q90[i],
  }));

  const priceChartData = axis.map((ts, i) => ({
    ts,
    price: data.price_ct_per_kwh[i],
  }));

  // Tooltip-Formatter für Zeit (kannst du noch schön formatieren)
  const formatTs = (ts: string) =>
    new Date(ts).toLocaleString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
    });

  return (
    <div className="space-y-6">
      {/* Info-Bar */}
      <div className="flex flex-wrap items-baseline justify-between gap-3 text-xs text-slate-400">
        <span>
          Series: <span className="font-mono text-slate-200">{series}</span>
        </span>
        <span>
          Range: {formatTs(data.start_ts)} – {formatTs(data.end_ts)} (
          {data.resolution_minutes} min Raster)
        </span>
        <span>
          Backend-Referenz:{" "}
          <span className="font-mono text-amber-200">
            {formatTs(data.reference_ts)}
          </span>
        </span>
        {nowTs && (
          <span>
            Jetzt-Linie (Axis):{" "}
            <span className="font-mono text-amber-200">
              {formatTs(nowTs)}
            </span>
          </span>
        )}
      </div>

      {/* 1) Oberes Chart – Last (Ist + Forecast) */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
        <h2 className="mb-2 text-sm font-semibold text-slate-200">
          Last (Ist + Forecast)
        </h2>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={loadChartData} syncId="tirex-sync">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="ts"
                tickFormatter={formatTs}
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
                labelFormatter={(label) => formatTs(label as string)}
              />
              {nowTs && (
                <ReferenceLine
                  x={nowTs}
                  stroke="#fbbf24"
                  strokeDasharray="4 4"
                  label={{
                    value: "Jetzt",
                    position: "top",
                    fill: "#fbbf24",
                    fontSize: 10,
                  }}
                />
              )}
              <Line
                type="monotone"
                dataKey="actual"
                name="Ist"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="q50"
                name="Forecast q50"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 2) Unteres Chart – Awattar-Preis */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
        <h2 className="mb-2 text-sm font-semibold text-slate-200">
          Strompreis (Awattar)
        </h2>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={priceChartData} syncId="tirex-sync">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="ts"
                tickFormatter={formatTs}
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
                labelFormatter={(label) => formatTs(label as string)}
              />
              {nowTs && (
                <ReferenceLine
                  x={nowTs}
                  stroke="#fbbf24"
                  strokeDasharray="4 4"
                  label={{
                    value: "Jetzt",
                    position: "top",
                    fill: "#fbbf24",
                    fontSize: 10,
                  }}
                />
              )}
              <Line
                type="monotone"
                dataKey="price"
                name="Preis"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

