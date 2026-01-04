#!/usr/bin/env python3
import os
import sys
import datetime as dt

import psycopg2
import requests

PG_CONN_STR = os.environ.get(
    "PG_CONN_STR",
    "postgres://postgres:postgres@localhost:5432/energy",
)

# Awattar-Endpoint für AT-Strompreise
AWATTAR_URL = os.environ.get(
    "AWATTAR_URL",
    "https://api.awattar.at/v1/marketdata",
)


def get_time_range():
    """Hole Zeitraum: gestern 00:00 bis übermorgen 23:59, als Unix-Millis."""
    now = dt.datetime.now(dt.timezone.utc)
    start = (now - dt.timedelta(days=1)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    end = (now + dt.timedelta(days=2)).replace(
        hour=23, minute=59, second=59, microsecond=0
    )
    start_ms = int(start.timestamp() * 1000)
    end_ms = int(end.timestamp() * 1000)
    return start, end, start_ms, end_ms


def fetch_awattar_prices():
    start_dt, end_dt, start_ms, end_ms = get_time_range()
    params = {
        "start": start_ms,
        "end": end_ms,
    }

    resp = requests.get(AWATTAR_URL, params=params, timeout=10)
    resp.raise_for_status()
    obj = resp.json()

    # Awattar kann entweder direkt eine Liste zurückgeben (Standard-API),
    # oder in seltenen Fällen ein Objekt mit data=[...].
    if isinstance(obj, list):
        items = obj
    elif isinstance(obj, dict):
        items = obj.get("data", [])
    else:
        raise RuntimeError(f"Unerwartetes Awattar-Format: {type(obj)}")

    if not isinstance(items, list):
        raise RuntimeError(f"Unerwarteter Typ für items: {type(items)}")

    prices = []
    for item in items:
        if not isinstance(item, dict):
            continue

        start_ts_ms = item.get("start_timestamp")
        market_price_eur_mwh = item.get("marketprice")
        if start_ts_ms is None or market_price_eur_mwh is None:
            continue

        ts = dt.datetime.fromtimestamp(
            start_ts_ms / 1000.0, tz=dt.timezone.utc
        )

        # EUR/MWh -> ct/kWh: EUR/MWh / 10 = ct/kWh
        price_ct_per_kwh = market_price_eur_mwh / 10.0

        prices.append((ts, price_ct_per_kwh))

    print(
        f"Fetched {len(prices)} price points from Awattar "
        f"({start_dt.isoformat()} – {end_dt.isoformat()})",
        file=sys.stderr,
    )
    return prices


def upsert_prices(prices):
    if not prices:
        print("No prices to upsert", file=sys.stderr)
        return

    conn = psycopg2.connect(PG_CONN_STR)
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            for ts, price in prices:
                cur.execute(
                    """
                    INSERT INTO prices_awattar (ts, price_ct_per_kwh, source)
                    VALUES (%s, %s, 'awattar')
                    ON CONFLICT (ts) DO UPDATE
                    SET price_ct_per_kwh = EXCLUDED.price_ct_per_kwh,
                        source = EXCLUDED.source,
                        created_at = now();
                    """,
                    (ts, price),
                )
        conn.commit()
        print(f"Upserted {len(prices)} rows into prices_awattar", file=sys.stderr)
    except Exception as e:
        conn.rollback()
        print("Error upserting prices:", e, file=sys.stderr)
        raise
    finally:
        conn.close()


def main():
    try:
        prices = fetch_awattar_prices()
        upsert_prices(prices)
    except Exception as e:
        print("awattar_loader failed:", e, file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

