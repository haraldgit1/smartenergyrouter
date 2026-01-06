# services/awattar_price_gen/app.py
#
# Schreibt synthetische "Awattar/EPEX"-Preise in measurements:
#   series = price:awattar_eur_mwh  (EUR/MWh)
#
# Idee:
# - Tagesprofil mit Morgen/Abend-Peak
# - Wochenend-Dämpfung
# - leichte hochfrequente Wellen
#
# ENV:
#   PG_CONN_STR=postgres://postgres:postgres@timescaledb:5432/energy
#   STEP_MINUTES=60
#   INTERVAL_SECONDS=60
#   BACKFILL_HOURS=168
#   FORECAST_HOURS=48
#   START_FROM=2026-01-01T00:00:00Z

from __future__ import annotations

import os
import time
from datetime import datetime, timezone, timedelta

import psycopg2

PG_CONN_STR = os.getenv(
    "PG_CONN_STR",
    "postgres://postgres:postgres@timescaledb:5432/energy",
)

SERIES_PRICE = "price:awattar_eur_mwh"

STEP_MINUTES = int(os.getenv("STEP_MINUTES", "60"))           # Preise typ. stündlich
INTERVAL_SECONDS = int(os.getenv("INTERVAL_SECONDS", "60"))   # loop sleep
BACKFILL_HOURS = int(os.getenv("BACKFILL_HOURS", "168"))      # 7 Tage
FORECAST_HOURS = int(os.getenv("FORECAST_HOURS", "48"))       # Preise in die Zukunft generieren
START_FROM_RAW = os.getenv("START_FROM")

SQL_PRICE = """
INSERT INTO measurements (ts, series, value, source, quality, meta)
SELECT
  ts,
  %(series)s AS series,
  (
    -- Base-Level (EUR/MWh)
    85

    -- Tagesprofil: Morgen + Abend
    + 22 * exp(-power((extract(hour from ts) + extract(minute from ts)/60.0 - 8.0) / 1.7, 2))
    + 35 * exp(-power((extract(hour from ts) + extract(minute from ts)/60.0 - 19.0) / 2.2, 2))

    -- Mittags etwas ruhiger
    - 10 * exp(-power((extract(hour from ts) + extract(minute from ts)/60.0 - 13.0) / 2.8, 2))

    -- Kleine Wellen / "Marktrauschen"
    + 6 * sin(extract(epoch from ts) / 7200.0)
    + 3 * sin(extract(epoch from ts) / 1800.0)

    -- Wochenend: etwas günstiger
    + CASE WHEN extract(dow from ts) IN (0,6) THEN -12 ELSE 0 END
  )::double precision AS value,
  'awattar_gen'::text AS source,
  'demo'::text AS quality,
  jsonb_build_object('generator','awattar_price_gen','unit','EUR/MWh') AS meta
FROM generate_series(
  %(start_ts)s::timestamptz,
  %(end_ts)s::timestamptz,
  (%(step_minutes)s::int || ' minutes')::interval
) ts
WHERE NOT EXISTS (
  SELECT 1 FROM measurements m
  WHERE m.series = %(series)s
    AND m.ts = ts
);
"""

def now_utc() -> datetime:
    return datetime.now(timezone.utc)

def parse_iso(ts: str) -> datetime:
    if ts.endswith("Z"):
        ts = ts[:-1] + "+00:00"
    return datetime.fromisoformat(ts).astimezone(timezone.utc)

def floor_to_step(ts: datetime, step_minutes: int) -> datetime:
    t = ts.astimezone(timezone.utc)
    minute = (t.minute // step_minutes) * step_minutes
    return t.replace(minute=minute, second=0, microsecond=0)

def get_last_ts(conn, series: str):
    with conn.cursor() as cur:
        cur.execute("SELECT max(ts) FROM measurements WHERE series=%(series)s;", {"series": series})
        row = cur.fetchone()
        return row[0] if row and row[0] is not None else None

def initial_start() -> datetime:
    if START_FROM_RAW:
        return parse_iso(START_FROM_RAW)
    return now_utc() - timedelta(hours=BACKFILL_HOURS)

def insert_range(conn, start_ts: datetime, end_ts: datetime) -> None:
    start_ts = floor_to_step(start_ts, STEP_MINUTES)
    end_ts = floor_to_step(end_ts, STEP_MINUTES)
    if end_ts <= start_ts:
        return
    with conn.cursor() as cur:
        cur.execute(
            SQL_PRICE,
            {
                "series": SERIES_PRICE,
                "start_ts": start_ts.isoformat(),
                "end_ts": end_ts.isoformat(),
                "step_minutes": STEP_MINUTES,
            },
        )
    conn.commit()

def main():
    print(f"[awattar_price_gen] PG_CONN_STR={PG_CONN_STR}")
    print(f"[awattar_price_gen] STEP_MINUTES={STEP_MINUTES} BACKFILL_HOURS={BACKFILL_HOURS} FORECAST_HOURS={FORECAST_HOURS} START_FROM={START_FROM_RAW}")

    while True:
        try:
            conn = psycopg2.connect(PG_CONN_STR)
            try:
                last = get_last_ts(conn, SERIES_PRICE)
                if last is None:
                    start = initial_start()
                else:
                    start = last + timedelta(minutes=STEP_MINUTES)

                # Wichtig: Preise in die Zukunft generieren
                end = now_utc() + timedelta(hours=FORECAST_HOURS)

                insert_range(conn, start, end)
                print(f"[awattar_price_gen] ok @ {now_utc().isoformat()} | last={last} | end={end.isoformat()}")
            finally:
                conn.close()
        except Exception as e:
            print(f"[awattar_price_gen][WARN] {e}")
        time.sleep(INTERVAL_SECONDS)

if __name__ == "__main__":
    main()

