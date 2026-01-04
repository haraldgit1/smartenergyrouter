#!/usr/bin/env python3
import os
import requests
import psycopg2
from psycopg2.extras import Json
from datetime import datetime, timedelta, timezone

PG_CONN_STR = os.environ.get(
    "PG_CONN_STR",
    "postgres://postgres:postgres@localhost:5432/energy",
)

API_BASE = "https://api.awattar.at/v1/marketdata"

# Zeitbereich definieren (UTC): gestern 00:00 bis übermorgen 00:00
now = datetime.now(timezone.utc)
start = (now - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
end = (now + timedelta(days=2)).replace(hour=0, minute=0, second=0, microsecond=0)

start_ms = int(start.timestamp() * 1000)
end_ms = int(end.timestamp() * 1000)

params = {
    "start": start_ms,
    "end": end_ms,
}

print(f"Hole Awattar-Daten von {start} bis {end} ...")
resp = requests.get(API_BASE, params=params, timeout=30)
resp.raise_for_status()
payload = resp.json()

data = payload.get("data", [])

conn = psycopg2.connect(PG_CONN_STR)
cur = conn.cursor()

rows = 0
for entry in data:
    ts_start = datetime.fromtimestamp(entry["start_timestamp"] / 1000, tz=timezone.utc)
    marketprice = float(entry["marketprice"])  # EUR/MWh

    # EUR/MWh -> ct/kWh (1 MWh = 1000 kWh, EUR -> ct)
    price_ct_per_kwh = marketprice / 10.0

    cur.execute(
        """
        INSERT INTO awattar_prices (ts, price_ct_per_kwh, source, raw)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (ts)
        DO UPDATE SET
          price_ct_per_kwh = EXCLUDED.price_ct_per_kwh,
          source = EXCLUDED.source,
          raw = EXCLUDED.raw;
        """,
        (ts_start, price_ct_per_kwh, "awattar_api", Json(entry)),
    )
    rows += 1

conn.commit()
cur.close()
conn.close()

print(f"{rows} Awattar-Preispunkte aktualisiert.")

