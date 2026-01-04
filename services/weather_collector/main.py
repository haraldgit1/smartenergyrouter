#!/usr/bin/env python3
import os
import time
import logging
from typing import List

import requests
import psycopg2
from psycopg2.extras import execute_batch

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

PG_CONN_STR = os.getenv("PG_CONN_STR", "postgres://postgres:postgres@timescaledb:5432/energy")

WEATHER_LAT = float(os.getenv("WEATHER_LAT", "47.07"))
WEATHER_LON = float(os.getenv("WEATHER_LON", "15.44"))
WEATHER_TIMEZONE = os.getenv("WEATHER_TIMEZONE", "UTC")
WEATHER_HOURLY_VARS = os.getenv(
    "WEATHER_HOURLY_VARS",
    "temperature_2m,shortwave_radiation,cloud_cover",
)
WEATHER_API_URL = os.getenv(
    "WEATHER_API_URL",
    "https://api.open-meteo.com/v1/forecast",
)
INTERVAL_SECONDS = int(os.getenv("WEATHER_INTERVAL_SECONDS", "3600"))  # 1h

SERIES_MAP = {
    "temperature_2m": "weather:temp_c",
    "shortwave_radiation": "weather:shortwave_radiation_wm2",
    "cloud_cover": "weather:cloud_cover_pct",
}


def get_db_connection():
    return psycopg2.connect(PG_CONN_STR)


def fetch_weather():
    params = {
        "latitude": WEATHER_LAT,
        "longitude": WEATHER_LON,
        "hourly": WEATHER_HOURLY_VARS,
        "timezone": WEATHER_TIMEZONE,
    }
    logging.info("Requesting weather forecast from Open-Meteo")
    resp = requests.get(WEATHER_API_URL, params=params, timeout=10)
    resp.raise_for_status()
    return resp.json()


def build_measurements(payload: dict) -> List[tuple]:
    hourly = payload.get("hourly", {})
    times = hourly.get("time", [])
    if not times:
        logging.warning("No hourly time-series returned from Open-Meteo")
        return []

    rows = []

    for var, series_name in SERIES_MAP.items():
        values = hourly.get(var)
        if not values:
            logging.warning("Variable %s not in response", var)
            continue
        if len(values) != len(times):
            logging.warning("Length mismatch for %s: times=%d values=%d", var, len(times), len(values))
            continue

        for ts, v in zip(times, values):
            if v is None:
                continue
            # ts kommt als ISO-String (UTC oder lokale Zeit je nach WEATHER_TIMEZONE)
            rows.append((ts, series_name, float(v)))

    logging.info("Prepared %d measurement rows", len(rows))
    return rows


def upsert_measurements(conn, rows: List[tuple]):
    if not rows:
        return

    with conn.cursor() as cur:
        execute_batch(
            cur,
            """
            INSERT INTO measurements (ts, series, value)
            VALUES (%s, %s, %s)
            ON CONFLICT (ts, series)
            DO UPDATE SET value = EXCLUDED.value
            """,
            rows,
            page_size=1000,
        )
    conn.commit()


def main():
    logging.info("Starting weather_collector")
    conn = None
    while True:
        try:
            if conn is None or conn.closed:
                conn = get_db_connection()

            payload = fetch_weather()
            rows = build_measurements(payload)
            upsert_measurements(conn, rows)
            logging.info("Weather data upserted successfully")
        except Exception as e:
            logging.exception("Error in weather_collector loop: %s", e)
            # Bei DB-Fehlern Connection neu aufbauen
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass
                conn = None

        logging.info("Sleeping %s seconds", INTERVAL_SECONDS)
        time.sleep(INTERVAL_SECONDS)


if __name__ == "__main__":
    main()

