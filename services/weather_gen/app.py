# services/weather_gen/app.py
#
# Lädt Wetter + Forecast von https://api.open-meteo.com und schreibt in measurements:
#   weather:temp_c
#   weather:shortwave_radiation_wm2
#   weather:cloud_cover_pct
#   weather:rain_mm
#   weather:rain_prob_pct
#   weather:wind_kmh
#
# ENV:
#   PG_CONN_STR=postgres://postgres:postgres@timescaledb:5432/energy
#   INTERVAL_SECONDS=900
#   STEP_MINUTES=15
#   LAT=47.0707
#   LON=15.4395
#   TIMEZONE=Europe/Vienna
#   PAST_DAYS=2
#   FORECAST_DAYS=5

from __future__ import annotations

import os
import time
import json
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

import requests
import psycopg2

PG_CONN_STR = os.getenv(
    "PG_CONN_STR",
    "postgres://postgres:postgres@timescaledb:5432/energy",
)

INTERVAL_SECONDS = int(os.getenv("INTERVAL_SECONDS", "900"))
STEP_MINUTES = int(os.getenv("STEP_MINUTES", "15"))

LAT = float(os.getenv("LAT", "47.0707"))
LON = float(os.getenv("LON", "15.4395"))
TZ_NAME = os.getenv("TIMEZONE", "Europe/Vienna")
PAST_DAYS = int(os.getenv("PAST_DAYS", "2"))
FORECAST_DAYS = int(os.getenv("FORECAST_DAYS", "5"))

TZ = ZoneInfo(TZ_NAME)

SER_TEMP = "weather:temp_c"
SER_GHI = "weather:shortwave_radiation_wm2"
SER_CLOUD = "weather:cloud_cover_pct"
SER_RAIN = "weather:rain_mm"
SER_RPRO = "weather:rain_prob_pct"
SER_WIND = "weather:wind_kmh"

OPEN_METEO_URL = (
    "https://api.open-meteo.com/v1/forecast"
    f"?latitude={LAT}&longitude={LON}"
    "&hourly=temperature_2m,shortwave_radiation,cloud_cover,"
    "precipitation,precipitation_probability,windspeed_10m"
    f"&timezone={TZ_NAME}"
    f"&past_days={PAST_DAYS}&forecast_days={FORECAST_DAYS}"
)

SQL_UPSERT = """
INSERT INTO measurements (ts, series, value, source, quality, meta)
VALUES (%(ts)s, %(series)s, %(value)s, %(source)s, %(quality)s, %(meta)s::jsonb)
ON CONFLICT (ts, series)
DO UPDATE SET
  value = EXCLUDED.value,
  source = EXCLUDED.source,
  quality = EXCLUDED.quality,
  meta = EXCLUDED.meta;
"""


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def parse_local_iso(ts_str: str) -> datetime:
    """
    Open-Meteo liefert hourly['time'] in der gewünschten Zeitzone ohne Offset,
    z.B. "2026-01-06T13:00". Wir interpretieren das in TZ_NAME und wandeln zu UTC.
    """
    dt_local = datetime.fromisoformat(ts_str)
    if dt_local.tzinfo is None:
        dt_local = dt_local.replace(tzinfo=TZ)
    return dt_local.astimezone(timezone.utc)


def floor_to_hour(dt_utc: datetime) -> datetime:
    d = dt_utc.astimezone(timezone.utc)
    return d.replace(minute=0, second=0, microsecond=0)


def expand_to_step(hour_utc: datetime, step_minutes: int) -> list[datetime]:
    """
    Expandiert einen Stunden-Zeitpunkt auf STEP-Minuten.
    Beispiel STEP=15 -> 00,15,30,45.
    """
    if step_minutes >= 60:
        return [hour_utc]
    points: list[datetime] = []
    m = 0
    while m < 60:
        points.append(hour_utc + timedelta(minutes=m))
        m += step_minutes
    return points


def fetch_open_meteo() -> dict:
    r = requests.get(OPEN_METEO_URL, timeout=30)
    r.raise_for_status()
    return r.json()


def upsert_points(conn, points: list[dict]) -> int:
    n = 0
    with conn.cursor() as cur:
        for p in points:
            cur.execute(SQL_UPSERT, p)
            n += 1
    conn.commit()
    return n


def build_points(payload: dict) -> list[dict]:
    hourly = payload.get("hourly") or {}
    times = hourly.get("time") or []

    temps = hourly.get("temperature_2m") or []
    ghi = hourly.get("shortwave_radiation") or []
    cloud = hourly.get("cloud_cover") or []

    precip = hourly.get("precipitation") or []
    precip_prob = hourly.get("precipitation_probability") or []
    wind = hourly.get("windspeed_10m") or []

    generated_ts = now_utc().isoformat()
    points: list[dict] = []

    def val(arr, idx):
        return arr[idx] if idx < len(arr) else None

    for i, ts_str in enumerate(times):
        try:
            ts_utc = parse_local_iso(ts_str)
        except Exception:
            continue

        hour_utc = floor_to_hour(ts_utc)
        expanded_ts = expand_to_step(hour_utc, STEP_MINUTES)

        temp_c = val(temps, i)
        ghi_wm2 = val(ghi, i)
        cloud_pct = val(cloud, i)
        rain_mm = val(precip, i)
        rain_prob = val(precip_prob, i)
        wind_kmh = val(wind, i)

        q = "forecast" if hour_utc > now_utc() else "observed"

        entries = []
        if temp_c is not None:
            entries.append((SER_TEMP, float(temp_c), "C"))
        if ghi_wm2 is not None:
            entries.append((SER_GHI, float(ghi_wm2), "W/m2"))
        if cloud_pct is not None:
            entries.append((SER_CLOUD, float(cloud_pct), "pct"))
        if rain_mm is not None:
            entries.append((SER_RAIN, float(rain_mm), "mm"))
        if rain_prob is not None:
            entries.append((SER_RPRO, float(rain_prob), "pct"))
        if wind_kmh is not None:
            entries.append((SER_WIND, float(wind_kmh), "km/h"))

        if not entries:
            continue

        for ts_point in expanded_ts:
            meta_obj = {
                "provider": "open-meteo",
                "generated_ts": generated_ts,
                "timezone": TZ_NAME,
                "lat": LAT,
                "lon": LON,
                "step_minutes": STEP_MINUTES,
            }

            for series, value, unit in entries:
                meta_obj_unit = dict(meta_obj)
                meta_obj_unit["unit"] = unit

                points.append(
                    {
                        "ts": ts_point.isoformat(),
                        "series": series,
                        "value": value,
                        "source": "open-meteo",
                        "quality": q,
                        # psycopg2 kann dict nicht direkt -> JSON-String
                        "meta": json.dumps(meta_obj_unit),
                    }
                )

    return points


def main():
    print(f"[weather_gen] PG_CONN_STR={PG_CONN_STR}")
    print(
        f"[weather_gen] open-meteo lat={LAT} lon={LON} tz={TZ_NAME} past_days={PAST_DAYS} forecast_days={FORECAST_DAYS}"
    )
    print(f"[weather_gen] STEP_MINUTES={STEP_MINUTES} INTERVAL_SECONDS={INTERVAL_SECONDS}")

    while True:
        try:
            payload = fetch_open_meteo()
            points = build_points(payload)

            conn = psycopg2.connect(PG_CONN_STR)
            try:
                n = upsert_points(conn, points)
            finally:
                conn.close()

            print(f"[weather_gen] ok @ {now_utc().isoformat()} | upserts={n}")
        except Exception as e:
            print(f"[weather_gen][WARN] {e}")

        time.sleep(INTERVAL_SECONDS)


if __name__ == "__main__":
    main()

