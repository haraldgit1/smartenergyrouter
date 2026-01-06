// src/app/api/tirex_charts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getTiRexCharts } from "@/lib/api";
import { Pool } from "pg";

export const dynamic = "force-dynamic";

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

  price_ct_per_kwh_compare?: (number | null)[];
  price_compare_generated_ts?: string | null;
  load_q10_compare?: (number | null)[];
  load_q50_compare?: (number | null)[];
  load_q90_compare?: (number | null)[];
  load_compare_generated_ts?: string | null;
  weather_temp_c_compare?: (number | null)[];
  weather_ghi_w_m2_compare?: (number | null)[];
  weather_compare_generated_ts?: string | null;

  // Regen / Regenwahrscheinlichkeit / Wind (aktuell)
  weather_rain_mm?: (number | null)[];
  weather_rain_prob_pct?: (number | null)[];
  weather_wind_kmh?: (number | null)[];

  // Regen / Regenwahrscheinlichkeit / Wind (History)
  weather_rain_mm_compare?: (number | null)[];
  weather_rain_prob_pct_compare?: (number | null)[];
  weather_wind_kmh_compare?: (number | null)[];
};

// DB-Verbindung (Timescale/Postgres)
const PG_CONN_STR =
  process.env.PG_CONN_STR ?? "postgres://postgres:postgres@localhost:5432/energy";

const pool = new Pool({
  connectionString: PG_CONN_STR,
});

// -----------------------------
// Helpers
// -----------------------------

function normalizeReferenceTs(raw: string | undefined): string | undefined {
  if (!raw) return undefined;

  // '+' kann als Space ankommen
  const fixed = raw.replace(/ /g, "+");

  const d = new Date(fixed);
  if (!Number.isFinite(d.getTime())) return undefined;
  return fixed;
}

function forwardFill(arr?: (number | null)[]): (number | null)[] | undefined {
  if (!arr || arr.length === 0) return arr;
  const out = [...arr];
  let last: number | null = null;
  for (let i = 0; i < out.length; i++) {
    const v = out[i];
    if (typeof v === "number" && Number.isFinite(v)) {
      last = v;
    } else {
      out[i] = last;
    }
  }
  return out;
}

// 1 EUR/MWh = 0.1 ct/kWh  (weil 1 EUR = 100 ct und 1 MWh = 1000 kWh)
function eurMwhToCtKwh(eurPerMwh: number): number {
  return eurPerMwh / 10.0;
}

function hourKeyUtc(d: Date): string {
  // YYYY-MM-DDTHH (UTC)
  return d.toISOString().slice(0, 13);
}

/**
 * Enrich price_ct_per_kwh from measurements (series price:awattar_eur_mwh)
 * Mapping: hourly prices -> fill all axis points in that hour with same price.
 */
async function enrichWithPricesFromMeasurements(
  data: TiRexChartsResponse
): Promise<TiRexChartsResponse> {
  const axis = data.axis ?? [];
  if (!axis.length) return data;

  const axisDates = axis.map((ts) => new Date(ts));
  const validDates = axisDates.filter((d) => Number.isFinite(d.getTime()));
  if (!validDates.length) return data;

  const minTs = new Date(Math.min(...validDates.map((d) => d.getTime())));
  const maxTs = new Date(Math.max(...validDates.map((d) => d.getTime())));

  // optional: ein bisschen Puffer, falls axis z.B. exakt auf Grenze liegt
  const minTsIso = new Date(minTs.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const maxTsIso = new Date(maxTs.getTime() + 2 * 60 * 60 * 1000).toISOString();

  const client = await pool.connect();
  try {
    const res = await client.query<{
      ts: Date;
      value: number;
    }>(
      `
      SELECT ts, value
      FROM measurements
      WHERE series = 'price:awattar_eur_mwh'
        AND ts >= $1::timestamptz
        AND ts <= $2::timestamptz
      ORDER BY ts ASC
      `,
      [minTsIso, maxTsIso]
    );

    if (!res.rows.length) return data;

    // build map by hour key
    const priceByHour: Record<string, number> = {};
    for (const row of res.rows) {
      const k = hourKeyUtc(row.ts);
      const v = eurMwhToCtKwh(Number(row.value));
      if (Number.isFinite(v)) priceByHour[k] = v;
    }

    const price_ct_per_kwh: (number | null)[] = axisDates.map((d) => {
      if (!Number.isFinite(d.getTime())) return null;
      const k = hourKeyUtc(d);
      const p = priceByHour[k];
      return typeof p === "number" ? p : null;
    });

    return { ...data, price_ct_per_kwh };
  } catch (err) {
    console.error("enrichWithPricesFromMeasurements failed:", err);
    return data;
  } finally {
    client.release();
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const series = searchParams.get("series") ?? "meter1:load_kw";
    const historyHours = Number(searchParams.get("history_hours") ?? "24");
    const horizonHours = Number(searchParams.get("horizon_hours") ?? "24");
    const resolutionMinutes = Number(searchParams.get("resolution_minutes") ?? "60");

    const referenceTsRaw = searchParams.get("reference_ts") ?? undefined;
    const referenceTs = normalizeReferenceTs(referenceTsRaw);

    const compareBackParam = searchParams.get("compare_back_hours");
    const compareBackHours =
      compareBackParam && compareBackParam !== ""
        ? Number(compareBackParam)
        : undefined;

    const rawData = (await getTiRexCharts({
      series,
      historyHours,
      horizonHours,
      resolutionMinutes,
      referenceTs,
      compareBackHours,
    })) as TiRexChartsResponse;

    // Preise aus measurements holen (statt prices_awattar)
    let enriched = await enrichWithPricesFromMeasurements(rawData);

    // Bei 5-Minuten-Axis: Preis/Wetter sind oft stündlich -> forward-fill
    // WICHTIG: Das ist ok, solange die Stunde selbst Werte hat.
    if (resolutionMinutes < 60) {
      enriched = {
        ...enriched,
        price_ct_per_kwh: forwardFill(enriched.price_ct_per_kwh) ?? enriched.price_ct_per_kwh,
        price_ct_per_kwh_compare: forwardFill(enriched.price_ct_per_kwh_compare),

        weather_temp_c: forwardFill(enriched.weather_temp_c) ?? enriched.weather_temp_c,
        weather_ghi_w_m2: forwardFill(enriched.weather_ghi_w_m2) ?? enriched.weather_ghi_w_m2,
        weather_temp_c_compare: forwardFill(enriched.weather_temp_c_compare),
        weather_ghi_w_m2_compare: forwardFill(enriched.weather_ghi_w_m2_compare),

        weather_rain_mm: forwardFill(enriched.weather_rain_mm),
        weather_rain_prob_pct: forwardFill(enriched.weather_rain_prob_pct),
        weather_wind_kmh: forwardFill(enriched.weather_wind_kmh),

        weather_rain_mm_compare: forwardFill(enriched.weather_rain_mm_compare),
        weather_rain_prob_pct_compare: forwardFill(enriched.weather_rain_prob_pct_compare),
        weather_wind_kmh_compare: forwardFill(enriched.weather_wind_kmh_compare),
      };
    }

    return NextResponse.json(enriched);
  } catch (err: any) {
    console.error("GET /api/tirex_charts failed:", err);
    return new NextResponse(
      JSON.stringify({
        error: "failed_to_fetch_tirex_charts",
        message: err?.message ?? String(err),
      }),
      { status: 500 }
    );
  }
}

