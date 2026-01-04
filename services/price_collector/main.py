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
AWATTAR_API_URL = os.getenv("AWATTAR_API_URL", "https://api.awattar.at/v1/marketdata")
INTERVAL_SECONDS = int(os.getenv("PRICE_INTERVAL_SECONDS", "3600"))  # 1x pro Stunde

PRICE_SERIES = "price:awattar_eur_mwh"


def get_db_connection():
    return psycopg2.connect(PG_CONN_STR)


def fetch_prices():
    logging.info("Requesting price data from aWATTar")
    resp = requests.get(AWATTAR_API_URL, timeout=10)
    resp.raise_for_status()
    return resp.json()


def build_price_rows(payload: dict) -> List[tuple]:
    data = payload.get("data", [])
    rows = []
    for item in data:
        start_ts_ms = item.get("start_timestamp")
        price = item.get("marketprice")
        if start_ts_ms is None or price is None:
            continue

        # aWATTar liefert Unix-Time in ms, wir wandeln erst in Postgres
        # Wir speichern ts als timestamptz via to_timestamp() im Insert
        rows.append((start_ts_ms / 1000.0, PRICE_SERIES, float(price)))
    logging.info("Prepared %d price rows", len(rows))
    return rows


def upsert_prices(conn, rows: List[tuple]):
    if not rows:
        return

    with conn.cursor() as cur:
        execute_batch(
            cur,
            """
            INSERT INTO measurements (ts, series, value)
            VALUES (to_timestamp(%s), %s, %s)
            ON CONFLICT (ts, series)
            DO UPDATE SET value = EXCLUDED.value
            """,
            rows,
            page_size=500,
        )
    conn.commit()


def main():
    logging.info("Starting price_collector")
    conn = None
    while True:
        try:
            if conn is None or conn.closed:
                conn = get_db_connection()

            payload = fetch_prices()
            rows = build_price_rows(payload)
            upsert_prices(conn, rows)
            logging.info("Price data upserted successfully")
        except Exception as e:
            logging.exception("Error in price_collector loop: %s", e)
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

