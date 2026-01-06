// src/lib/api.ts

import { Pool } from "pg";

// --------------------
// DB-Verbindung (Timescale/Postgres)
// --------------------

const PG_CONN_STR =
  process.env.PG_CONN_STR ??
  "postgres://postgres:postgres@localhost:5432/energy";

const pool = new Pool({
  connectionString: PG_CONN_STR,
});

// kleine Helper-Funktion für SQL-Queries
export async function query<T = any>(
  sql: string,
  params: any[] = []
): Promise<T[]> {
  const client = await pool.connect();
  try {
    const res = await client.query(sql, params);
    return res.rows as T[];
  } finally {
    client.release();
  }
}

// --------------------
// Allgemeine Typen
// --------------------

export interface Device {
  device_id: string;
  name: string;
  type: string | null;
  location: string | null;
  rated_power_kw: number | null;
  backend_type: string | null;
  backend_ref: string | null;
  mode: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  [key: string]: any;
}

export interface Usecase {
  id: string;
  name: string;
  description?: string | null;
  [key: string]: any;
}

export interface Flow {
  flow_id?: string;
  plan_id?: string;
  device: string;
  usecase: string;
  power_kw: number;
  window?: [string, string][];
  ts?: string;
  status?: string;
  raw_payload?: any;
  [key: string]: any;
}

// Detail-Struktur für Device-Detailseite
export interface DeviceDetail {
  device: {
    device_id: string;
    device_name: string;
    device_type?: string | null;
    device_location?: string | null;
    device_mode?: string | null;
    device_enabled: boolean;
    [key: string]: any;
  };
  usecases: Array<{
    usecase_id: number | string;
    usecase_name: string;
    usecase_key?: string;
    usecase_category?: string | null;
    mapping_enabled?: boolean;
    effective_config?: any;
    [key: string]: any;
  }>;
  events: Array<{
    event_id: string;
    ts: string;
    event_type: string;
    message?: string | null;
    service_name?: string | null;
    entity_type?: string | null;
    entity_id?: string | null;
    severity?: string | null;
    flow_id?: string | null;
    [key: string]: any;
  }>;
}

// --------------------
// TiRex Charts – Typen
// --------------------

export interface TiRexChartsResponse {
  reference_ts: string; // gerundetes "jetzt" (ISO)
  start_ts: string;
  end_ts: string;
  resolution_minutes: number;

  axis: string[]; // gemeinsame Zeitachse

  load_actual: (number | null)[];
  load_q50: (number | null)[];
  load_q10: (number | null)[];
  load_q90: (number | null)[];

  price_ct_per_kwh: (number | null)[];
  weather_temp_c: (number | null)[];
  weather_ghi_w_m2: (number | null)[];

  now_index: number; // Index in axis[]

  // Meta-Felder zur Datenreichweite
  forecast_data_start_ts: string | null;
  forecast_data_end_ts: string | null;
  price_data_start_ts: string | null;
  price_data_end_ts: string | null;

  // Preis-History
  price_ct_per_kwh_compare?: (number | null)[];
  price_compare_generated_ts?: string | null;

  // Last-History (TiRex-Forecast von früher)
  load_q10_compare?: (number | null)[];
  load_q50_compare?: (number | null)[];
  load_q90_compare?: (number | null)[];
  load_compare_generated_ts?: string | null;

  // Wetter-History (Open-Meteo-Stand von früher)
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
}

interface TiRexRow {
  ts: Date;
  load_actual: number | null;
  load_q10: number | null;
  load_q50: number | null;
  load_q90: number | null;
  price_ct_per_kwh: number | null;
  weather_temp_c: number | null;
  weather_ghi_w_m2: number | null;
  weather_rain_mm: number | null;
  weather_rain_prob_pct: number | null;
  weather_wind_kmh: number | null;
}

// --------------------
// Basis-URLs
// --------------------

// Router-Agent (FastAPI) – für /info/schedules etc.
export const ROUTER_AGENT_BASE_URL =
  process.env.NEXT_PUBLIC_ROUTER_AGENT_BASE_URL ?? "http://localhost:8000";

// console_api – für Flows, Device-Details, Reports etc.
export const CONSOLE_API_BASE_URL =
  process.env.NEXT_PUBLIC_CONSOLE_API_BASE_URL ?? "http://localhost:8100";

// --------------------
// Zeit-Helfer für TiRex
// --------------------

function truncateToResolution(date: Date, resolutionMinutes: number): Date {
  const ms = date.getTime();
  const bucketMs = resolutionMinutes * 60_000;
  const truncated = Math.floor(ms / bucketMs) * bucketMs;
  return new Date(truncated);
}

function buildTimeWindow(
  referenceTs: Date,
  historyHours: number,
  horizonHours: number
): { startTs: Date; endTs: Date } {
  const startMs = referenceTs.getTime() - historyHours * 3600_000;
  const endMs = referenceTs.getTime() + horizonHours * 3600_000;
  return {
    startTs: new Date(startMs),
    endTs: new Date(endMs),
  };
}

// --------------------
// Devices – direkt aus devices (Liste)
// --------------------

export async function getDevices(): Promise<Device[]> {
  const rows = await query<Device>(
    `
    SELECT
      device_id,
      name,
      type,
      location,
      rated_power_kw,
      backend_type,
      backend_ref,
      mode,
      enabled,
      created_at,
      updated_at
    FROM devices
    ORDER BY device_id
    `
  );

  return rows;
}

// Device-Detail – über console_api /api/devices/{device_id}
export async function getDeviceDetail(deviceId: string): Promise<DeviceDetail> {
  const url = new URL(
    `/api/devices/${encodeURIComponent(deviceId)}`,
    CONSOLE_API_BASE_URL
  );

  const res = await fetch(url.toString(), {
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(
      `Failed to fetch device detail from console_api /api/devices/${deviceId}: ${res.status} ${res.statusText}`
    );
  }

  return (await res.json()) as DeviceDetail;
}

// --------------------
// Usecases – direkt aus usecases
// --------------------

export async function getUsecases(): Promise<Usecase[]> {
  const rows = await query<any>(
    `
    SELECT *
    FROM usecases
    ORDER BY usecase_id
    `
  );

  return rows.map((r) => {
    const id = r.usecase_id ?? r.id;
    const name = r.name ?? null;
    const category = r.category ?? null;
    const description = r.description ?? null;

    return {
      id,
      name,
      category,
      description,
      ...r,
    } as Usecase;
  });
}

// --------------------
// Flows – über console_api (/api/flows)
// --------------------

export interface FlowSummary {
  flow_id: string;
  started_at: string;
  ended_at: string;
  duration_seconds: number | null;
  event_count: number;
  primary_device_id: string | null;
  device_count: number;
  services_involved: string[];
  [key: string]: any;
}

export interface FlowDetail {
  summary: FlowSummary;
  events: Array<{
    event_id: string;
    ts: string;
    event_type: string;
    message?: string | null;
    service_name?: string | null;
    entity_type?: string | null;
    entity_id?: string | null;
    severity?: string | null;
    flow_id?: string | null;
    [key: string]: any;
  }>;
}

// Liste der Flows von console_api holen
export async function getFlows(hours: number): Promise<FlowSummary[]> {
  const url = new URL("/api/flows", CONSOLE_API_BASE_URL);
  url.searchParams.set("hours", String(hours));

  const res = await fetch(url.toString(), {
    cache: "no-store",
  });

  if (!res.ok) {
    if (res.status === 404) {
      return [];
    }
    throw new Error(
      `Failed to fetch flows from console_api /api/flows: ${res.status} ${res.statusText}`
    );
  }

  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

// Detail eines Flows von console_api holen
export async function getFlowDetail(flowId: string): Promise<FlowDetail> {
  const url = new URL(
    `/api/flows/${encodeURIComponent(flowId)}`,
    CONSOLE_API_BASE_URL
  );

  const res = await fetch(url.toString(), {
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(
      `Failed to fetch flow detail from console_api /api/flows/${flowId}: ${res.status} ${res.statusText}`
    );
  }

  return (await res.json()) as FlowDetail;
}

// --------------------
// MDM-Menü
// --------------------

export interface MenuItem {
  menu_key: string;
  label: string;
  description?: string | null;
  route_path: string;
  icon_name?: string | null;
  section: string;
  sort_order: number;
}

/**
 * Holt alle Menüeinträge aus mdm_menu_items.
 * Aktuell ohne Rollenfilter – d.h. ALLE Einträge.
 */
export async function getMenu(): Promise<MenuItem[]> {
  const rows = await query<MenuItem>(
    `
    SELECT
      menu_key,
      label,
      description,
      route_path,
      icon_name,
      section,
      sort_order
    FROM mdm_menu_items
    ORDER BY section, sort_order, menu_key
    `
  );

  return rows;
}

// --------------------
// TiRex Charts – synchrone Zeitreihen
// --------------------

export async function getTiRexCharts(options: {
  series: string;
  historyHours: number;
  horizonHours: number;
  resolutionMinutes: number;
  referenceTs?: string; // optional ISO
  compareBackHours?: number; // NEU: History in Stunden
}): Promise<TiRexChartsResponse> {
  const {
    series,
    historyHours,
    horizonHours,
    resolutionMinutes,
    referenceTs,
    compareBackHours,
  } = options;

  // 1) Referenzzeit bestimmen und auf Raster runden
  const refDateRaw = referenceTs ? new Date(referenceTs) : new Date();
  const refDate = truncateToResolution(refDateRaw, resolutionMinutes);

  // 2) Zeitfenster
  const { startTs, endTs } = buildTimeWindow(
    refDate,
    historyHours,
    horizonHours
  );

  const startIso = startTs.toISOString();
  const endIso = endTs.toISOString();

  // 3) Axis + Werte aus DB holen
  //
  // - axis: generate_series
  // - load_actual: measurements.series = $4
  // - forecast: jüngster Lauf pro target_ts (DISTINCT ON + ORDER BY ts DESC)
  // - prices: prices_awattar
  // - weather: measurements weather:temp_c, weather:shortwave_radiation_wm2
  //           sowie NEU: rain_mm, rain_prob_pct, wind_kmh

  const sql = `
    WITH axis AS (
      SELECT generate_series(
        $1::timestamptz,
        $2::timestamptz,
        ($3::int || ' minutes')::interval
      ) AS ts
    ),
    latest_forecasts AS (
      SELECT DISTINCT ON (series, target_ts)
        series,
        target_ts,
        q10,
        q50,
        q90
      FROM forecasts
      WHERE series = $4
        AND target_ts BETWEEN $1::timestamptz AND $2::timestamptz
      ORDER BY series, target_ts, ts DESC
    ),
    prices AS (
      SELECT ts, price_ct_per_kwh
      FROM prices_awattar
      WHERE ts BETWEEN $1::timestamptz AND $2::timestamptz
    ),
    weather_temp AS (
      SELECT ts, value AS temp_c
      FROM measurements
      WHERE series = 'weather:temp_c'
        AND ts BETWEEN $1::timestamptz AND $2::timestamptz
    ),
    weather_ghi AS (
      SELECT ts, value AS ghi_w_m2
      FROM measurements
      WHERE series = 'weather:shortwave_radiation_wm2'
        AND ts BETWEEN $1::timestamptz AND $2::timestamptz
    ),
    weather_rain AS (
      SELECT ts, value AS rain_mm
      FROM measurements
      WHERE series = 'weather:rain_mm'
        AND ts BETWEEN $1::timestamptz AND $2::timestamptz
    ),
    weather_rain_prob AS (
      SELECT ts, value AS rain_prob_pct
      FROM measurements
      WHERE series = 'weather:rain_prob_pct'
        AND ts BETWEEN $1::timestamptz AND $2::timestamptz
    ),
    weather_wind AS (
      SELECT ts, value AS wind_kmh
      FROM measurements
      WHERE series = 'weather:wind_kmh'
        AND ts BETWEEN $1::timestamptz AND $2::timestamptz
    )
    SELECT
      a.ts,
      m.value            AS load_actual,
      f.q10              AS load_q10,
      f.q50              AS load_q50,
      f.q90              AS load_q90,
      p.price_ct_per_kwh,
      wt.temp_c          AS weather_temp_c,
      wg.ghi_w_m2        AS weather_ghi_w_m2,
      wr.rain_mm         AS weather_rain_mm,
      wrp.rain_prob_pct  AS weather_rain_prob_pct,
      ww.wind_kmh        AS weather_wind_kmh
    FROM axis a
    LEFT JOIN LATERAL (
      SELECT value
      FROM measurements
      WHERE series = $4
        AND ts >= a.ts
        AND ts <  a.ts + ($3::int || ' minutes')::interval
      ORDER BY ts DESC
      LIMIT 1
    ) m ON TRUE
    LEFT JOIN latest_forecasts f
      ON f.series    = $4
     AND f.target_ts = a.ts
    LEFT JOIN prices p
      ON p.ts = a.ts
    LEFT JOIN weather_temp wt
      ON wt.ts = a.ts
    LEFT JOIN weather_ghi wg
      ON wg.ts = a.ts
    LEFT JOIN weather_rain wr
      ON wr.ts = a.ts
    LEFT JOIN weather_rain_prob wrp
      ON wrp.ts = a.ts
    LEFT JOIN weather_wind ww
      ON ww.ts = a.ts
    ORDER BY a.ts;
  `;

  const rows = await query<TiRexRow>(sql, [
    startIso,
    endIso,
    resolutionMinutes,
    series,
  ]);

  // 4) Forecast- und Preis-Meta: Datenreichweite (unverändert)
  const forecastMeta = await query<{
    min_ts: string | null;
    max_ts: string | null;
  }>(
    `
      SELECT
        MIN(target_ts) AS min_ts,
        MAX(target_ts) AS max_ts
      FROM forecasts
      WHERE series = $1
    `,
    [series]
  );

  const priceMeta = await query<{
    min_ts: string | null;
    max_ts: string | null;
  }>(
    `
      SELECT
        MIN(ts) AS min_ts,
        MAX(ts) AS max_ts
      FROM prices_awattar
    `,
    []
  );

  const forecast_data_start_ts = forecastMeta[0]?.min_ts ?? null;
  const forecast_data_end_ts = forecastMeta[0]?.max_ts ?? null;
  const price_data_start_ts = priceMeta[0]?.min_ts ?? null;
  const price_data_end_ts = priceMeta[0]?.max_ts ?? null;

  // 5) Axis + Basis-Arrays aufbauen
  const axis: string[] = [];
  const load_actual: (number | null)[] = [];
  const load_q10: (number | null)[] = [];
  const load_q50: (number | null)[] = [];
  const load_q90: (number | null)[] = [];
  const price_ct_per_kwh: (number | null)[] = [];
  const weather_temp_c: (number | null)[] = [];
  const weather_ghi_w_m2: (number | null)[] = [];
  const weather_rain_mm: (number | null)[] = [];
  const weather_rain_prob_pct: (number | null)[] = [];
  const weather_wind_kmh: (number | null)[] = [];

  for (const r of rows) {
    const tsIso = r.ts.toISOString();
    axis.push(tsIso);
    load_actual.push(r.load_actual ?? null);
    load_q10.push(r.load_q10 ?? null);
    load_q50.push(r.load_q50 ?? null);
    load_q90.push(r.load_q90 ?? null);
    price_ct_per_kwh.push(r.price_ct_per_kwh ?? null);
    weather_temp_c.push(r.weather_temp_c ?? null);
    weather_ghi_w_m2.push(r.weather_ghi_w_m2 ?? null);
    weather_rain_mm.push(r.weather_rain_mm ?? null);
    weather_rain_prob_pct.push(r.weather_rain_prob_pct ?? null);
    weather_wind_kmh.push(r.weather_wind_kmh ?? null);
  }

  // 6) now_index bestimmen (Index des Referenzzeitpunkts)
  const refIso = refDate.toISOString();
  const now_index = axis.findIndex((ts) => ts === refIso);

  // 7) History-Daten (Preis, Last, Wetter) optional aus *_histo
  let price_ct_per_kwh_compare: (number | null)[] | undefined;
  let price_compare_generated_ts: string | null = null;

  let load_q10_compare: (number | null)[] | undefined;
  let load_q50_compare: (number | null)[] | undefined;
  let load_q90_compare: (number | null)[] | undefined;
  let load_compare_generated_ts: string | null = null;

  let weather_temp_c_compare: (number | null)[] | undefined;
  let weather_ghi_w_m2_compare: (number | null)[] | undefined;
  let weather_rain_mm_compare: (number | null)[] | undefined;
  let weather_rain_prob_pct_compare: (number | null)[] | undefined;
  let weather_wind_kmh_compare: (number | null)[] | undefined;
  let weather_compare_generated_ts: string | null = null;

  if (axis.length && compareBackHours && compareBackHours > 0) {
    // 7.1 Vergleichs-Generation (auf ganze Stunde gerundet)
    const cmpRows = await query<{ cmp_generated: string }>(
      `
      SELECT date_trunc(
               'hour',
               now() - ($1::int || ' hours')::interval
             ) AS cmp_generated
      `,
      [compareBackHours]
    );

    const cmpGenerated = cmpRows[0]?.cmp_generated ?? null;

    if (cmpGenerated) {
      // -------- Preis-History aus prices_awattar_histo --------
      const priceHistRows = await query<{
        ts: string;
        price_ct_per_kwh_4h: number;
      }>(
        `
        WITH params AS (
          SELECT $1::timestamptz AS cmp_generated
        )
        SELECT
          h.ts,
          h.price_ct_per_kwh AS price_ct_per_kwh_4h
        FROM prices_awattar_histo h
        JOIN params p
          ON h.generated_ts >= p.cmp_generated
         AND h.generated_ts <  p.cmp_generated + interval '1 hour'
        WHERE h.ts BETWEEN $2::timestamptz AND $3::timestamptz
        ORDER BY h.ts;
        `,
        [cmpGenerated, startIso, endIso]
      );

      if (priceHistRows.length > 0) {
        const priceHistByTs: Record<string, number> = {};
        for (const r of priceHistRows) {
          const key = new Date(r.ts).toISOString();
          priceHistByTs[key] = r.price_ct_per_kwh_4h;
        }
        price_ct_per_kwh_compare = axis.map((ts) => {
          const p = priceHistByTs[ts];
          return typeof p === "number" ? p : null;
        });
        price_compare_generated_ts = cmpGenerated;
      }

      // -------- Last-History aus forecasts_histo --------
      const loadHistRows = await query<{
        target_ts: string;
        q10: number | null;
        q50: number | null;
        q90: number | null;
      }>(
        `
        WITH params AS (
          SELECT $1::timestamptz AS cmp_generated
        )
        SELECT
          f.target_ts,
          MAX(f.value) FILTER (WHERE f.quantile = 0.10) AS q10,
          MAX(f.value) FILTER (WHERE f.quantile = 0.50) AS q50,
          MAX(f.value) FILTER (WHERE f.quantile = 0.90) AS q90
        FROM forecasts_histo f
        JOIN params p
          ON f.ts >= p.cmp_generated
         AND f.ts <  p.cmp_generated + interval '1 hour'
        WHERE f.series = $2
          AND f.target_ts BETWEEN $3::timestamptz AND $4::timestamptz
          AND f.quantile IN (0.10, 0.50, 0.90)
        GROUP BY f.target_ts
        ORDER BY f.target_ts;
        `,
        [cmpGenerated, series, startIso, endIso]
      );

      if (loadHistRows.length > 0) {
        const histByTs: Record<
          string,
          { q10: number | null; q50: number | null; q90: number | null }
        > = {};
        for (const r of loadHistRows) {
          const key = new Date(r.target_ts).toISOString();
          histByTs[key] = {
            q10: r.q10 ?? null,
            q50: r.q50 ?? null,
            q90: r.q90 ?? null,
          };
        }

        load_q10_compare = [];
        load_q50_compare = [];
        load_q90_compare = [];

        for (const ts of axis) {
          const h = histByTs[ts];
          load_q10_compare.push(h ? h.q10 : null);
          load_q50_compare.push(h ? h.q50 : null);
          load_q90_compare.push(h ? h.q90 : null);
        }

        load_compare_generated_ts = cmpGenerated;
      }

      // -------- Wetter-History aus measurements_histo --------
      const weatherTempRows = await query<{
        ts: string;
        temp_c: number;
      }>(
        `
        WITH params AS (
          SELECT $1::timestamptz AS cmp_generated
        )
        SELECT
          m.ts,
          m.value AS temp_c
        FROM measurements_histo m
        JOIN params p
          ON m.generated_ts >= p.cmp_generated
         AND m.generated_ts <  p.cmp_generated + interval '1 hour'
        WHERE m.series = 'weather:temp_c'
          AND m.ts BETWEEN $2::timestamptz AND $3::timestamptz
        ORDER BY m.ts;
        `,
        [cmpGenerated, startIso, endIso]
      );

      const weatherGhiRows = await query<{
        ts: string;
        ghi_w_m2: number;
      }>(
        `
        WITH params AS (
          SELECT $1::timestamptz AS cmp_generated
        )
        SELECT
          m.ts,
          AVG(m.value) AS ghi_w_m2
        FROM measurements_histo m
        JOIN params p
          ON m.generated_ts >= p.cmp_generated
         AND m.generated_ts <  p.cmp_generated + interval '1 hour'
        WHERE m.series IN (
          'weather:ghi_w_m2',
          'weather:shortwave_radiation_wm2'
        )
          AND m.ts BETWEEN $2::timestamptz AND $3::timestamptz
        GROUP BY m.ts
        ORDER BY m.ts;
        `,
        [cmpGenerated, startIso, endIso]
      );


      const weatherRainRows = await query<{
        ts: string;
        rain_mm: number;
      }>(
        `
        WITH params AS (
          SELECT $1::timestamptz AS cmp_generated
        )
        SELECT
          m.ts,
          m.value AS rain_mm
        FROM measurements_histo m
        JOIN params p
          ON m.generated_ts >= p.cmp_generated
         AND m.generated_ts <  p.cmp_generated + interval '1 hour'
        WHERE m.series = 'weather:rain_mm'
          AND m.ts BETWEEN $2::timestamptz AND $3::timestamptz
        ORDER BY m.ts;
        `,
        [cmpGenerated, startIso, endIso]
      );

      const weatherRainProbRows = await query<{
        ts: string;
        rain_prob_pct: number;
      }>(
        `
        WITH params AS (
          SELECT $1::timestamptz AS cmp_generated
        )
        SELECT
          m.ts,
          m.value AS rain_prob_pct
        FROM measurements_histo m
        JOIN params p
          ON m.generated_ts >= p.cmp_generated
         AND m.generated_ts <  p.cmp_generated + interval '1 hour'
        WHERE m.series = 'weather:rain_prob_pct'
          AND m.ts BETWEEN $2::timestamptz AND $3::timestamptz
        ORDER BY m.ts;
        `,
        [cmpGenerated, startIso, endIso]
      );

      const weatherWindRows = await query<{
        ts: string;
        wind_kmh: number;
      }>(
        `
        WITH params AS (
          SELECT $1::timestamptz AS cmp_generated
        )
        SELECT
          m.ts,
          m.value AS wind_kmh
        FROM measurements_histo m
        JOIN params p
          ON m.generated_ts >= p.cmp_generated
         AND m.generated_ts <  p.cmp_generated + interval '1 hour'
        WHERE m.series = 'weather:wind_kmh'
          AND m.ts BETWEEN $2::timestamptz AND $3::timestamptz
        ORDER BY m.ts;
        `,
        [cmpGenerated, startIso, endIso]
      );

      if (
        weatherTempRows.length > 0 ||
        weatherGhiRows.length > 0 ||
        weatherRainRows.length > 0 ||
        weatherRainProbRows.length > 0 ||
        weatherWindRows.length > 0
      ) {
        const tempByTs: Record<string, number> = {};
        const ghiByTs: Record<string, number> = {};
        const rainByTs: Record<string, number> = {};
        const rainProbByTs: Record<string, number> = {};
        const windByTs: Record<string, number> = {};

        for (const r of weatherTempRows) {
          const key = new Date(r.ts).toISOString();
          tempByTs[key] = r.temp_c;
        }
        for (const r of weatherGhiRows) {
          const key = new Date(r.ts).toISOString();
          ghiByTs[key] = r.ghi_w_m2;
        }
        for (const r of weatherRainRows) {
          const key = new Date(r.ts).toISOString();
          rainByTs[key] = r.rain_mm;
        }
        for (const r of weatherRainProbRows) {
          const key = new Date(r.ts).toISOString();
          rainProbByTs[key] = r.rain_prob_pct;
        }
        for (const r of weatherWindRows) {
          const key = new Date(r.ts).toISOString();
          windByTs[key] = r.wind_kmh;
        }

        weather_temp_c_compare = axis.map((ts) => {
          const v = tempByTs[ts];
          return typeof v === "number" ? v : null;
        });
        weather_ghi_w_m2_compare = axis.map((ts) => {
          const v = ghiByTs[ts];
          return typeof v === "number" ? v : null;
        });
        weather_rain_mm_compare = axis.map((ts) => {
          const v = rainByTs[ts];
          return typeof v === "number" ? v : null;
        });
        weather_rain_prob_pct_compare = axis.map((ts) => {
          const v = rainProbByTs[ts];
          return typeof v === "number" ? v : null;
        });
        weather_wind_kmh_compare = axis.map((ts) => {
          const v = windByTs[ts];
          return typeof v === "number" ? v : null;
        });

        weather_compare_generated_ts = cmpGenerated;
      }
    }
  }

  return {
    reference_ts: refIso,
    start_ts: startIso,
    end_ts: endIso,
    resolution_minutes: resolutionMinutes,
    axis,
    load_actual,
    load_q10,
    load_q50,
    load_q90,
    price_ct_per_kwh,
    weather_temp_c,
    weather_ghi_w_m2,
    weather_rain_mm,
    weather_rain_prob_pct,
    weather_wind_kmh,
    now_index,
    forecast_data_start_ts,
    forecast_data_end_ts,
    price_data_start_ts,
    price_data_end_ts,
    price_ct_per_kwh_compare,
    price_compare_generated_ts,
    load_q10_compare,
    load_q50_compare,
    load_q90_compare,
    load_compare_generated_ts,
    weather_temp_c_compare,
    weather_ghi_w_m2_compare,
    weather_rain_mm_compare,
    weather_rain_prob_pct_compare,
    weather_wind_kmh_compare,
    weather_compare_generated_ts,
  };
}

