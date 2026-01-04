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

  // NEU: Regen / Regenwahrscheinlichkeit / Wind (aktuell)
  weather_rain_mm?: (number | null)[];
  weather_rain_prob_pct?: (number | null)[];
  weather_wind_kmh?: (number | null)[];

  // NEU: Regen / Regenwahrscheinlichkeit / Wind (History)
  weather_rain_mm_compare?: (number | null)[];
  weather_rain_prob_pct_compare?: (number | null)[];
  weather_wind_kmh_compare?: (number | null)[];
};

// DB-Verbindung (Timescale/Postgres) – ident wie in src/lib/api.ts
const PG_CONN_STR =
  process.env.PG_CONN_STR ??
  "postgres://postgres:postgres@localhost:5432/energy";

const pool = new Pool({
  connectionString: PG_CONN_STR,
});

// (Preis-Only-Enrichment ist mittlerweile im Backend abgedeckt,
// diese Funktion lassen wir aber drin, falls du sie später wieder brauchst.)
async function enrichWithPrices(
  data: TiRexChartsResponse
): Promise<TiRexChartsResponse> {
  const axis = data.axis ?? [];
  if (!axis.length) {
    return data;
  }

  const axisDates = axis.map((ts) => new Date(ts));
  const validDates = axisDates.filter((d) => !isNaN(d.getTime()));
  if (!validDates.length) {
    return data;
  }

  const minTs = new Date(
    Math.min.apply(
      null as unknown as number[],
      validDates.map((d) => d.getTime())
    )
  );
  const maxTs = new Date(
    Math.max.apply(
      null as unknown as number[],
      validDates.map((d) => d.getTime())
    )
  );

  const client = await pool.connect();
  try {
    const res = await client.query<{
      ts: Date;
      price_ct_per_kwh: number;
    }>(
      `
      SELECT ts, price_ct_per_kwh
      FROM prices_awattar
      WHERE ts BETWEEN $1 AND $2
      ORDER BY ts
      `,
      [minTs, maxTs]
    );

    if (!res.rows.length) {
      return data;
    }

    const priceByHour: Record<string, number> = {};
    for (const row of res.rows) {
      const hourKey = row.ts.toISOString().slice(0, 13);
      priceByHour[hourKey] = row.price_ct_per_kwh;
    }

    const price_ct_per_kwh: (number | null)[] = axisDates.map((d) => {
      if (isNaN(d.getTime())) return null;
      const hourKey = d.toISOString().slice(0, 13);
      const p = priceByHour[hourKey];
      return typeof p === "number" ? p : null;
    });

    return {
      ...data,
      price_ct_per_kwh,
    };
  } catch (err) {
    console.error("enrichWithPrices failed:", err);
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
    const resolutionMinutes = Number(
      searchParams.get("resolution_minutes") ?? "60"
    );
    const referenceTs = searchParams.get("reference_ts") ?? undefined;

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

    // optional: Preise nochmal „glätten“
    const enriched = await enrichWithPrices(rawData);

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

