#!/usr/bin/env python3
import json
import os
import time
from typing import Optional, Tuple

import psycopg2
import psycopg2.extras
import pika

PG_CONN_STR = os.environ.get(
    "PG_CONN_STR",
    "postgres://postgres:postgres@timescaledb:5432/energy",
)
AMQP_URL = os.environ.get(
    "AMQP_URL",
    "amqp://admin:admin@rabbitmq:5672/%2f",
)

EMIT_INTERVAL_SECONDS = int(os.environ.get("EMIT_INTERVAL_SECONDS", "300"))

FORECASTS_EXCHANGE = os.environ.get("FORECASTS_EXCHANGE", "forecasts.x")
FORECASTS_ROUTING_KEY = os.environ.get("FORECASTS_ROUTING_KEY", "forecasts.out")

SERIES_LOAD = os.environ.get("SERIES_LOAD", "meter1:load_kw")

# Weather series used as PV proxy (GHI is easiest)
SERIES_GHI = os.environ.get("SERIES_GHI", "weather:ghi_w_m2")

# Simple conversion: PV_kW ~= ghi_w_m2 * PV_AREA_M2 * PV_EFF / 1000
PV_AREA_M2 = float(os.environ.get("PV_AREA_M2", "25"))   # ~ 4-5 kWp rough
PV_EFF = float(os.environ.get("PV_EFF", "0.18"))

# Price fetch strategy (MVP):
# If you already store prices in DB, wire it here later.
DUMMY_PRICE_EUR_KWH = float(os.environ.get("DUMMY_PRICE_EUR_KWH", "0.19"))

# SoC: stateful dummy for MVP (later replace with real battery series)
SOC_INIT = float(os.environ.get("SOC_INIT", "0.62"))
SOC_MIN = float(os.environ.get("SOC_MIN", "0.10"))
SOC_MAX = float(os.environ.get("SOC_MAX", "0.95"))

# Optional: include an estimated PV forecast q50 (we just use current ghi->pv as q50)
# Optional: include "q50 load" (we use last measured load as proxy)
def iso_utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def db_fetch_latest_value(conn, series: str) -> Optional[Tuple[str, float]]:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT ts, value
            FROM measurements_histo
            WHERE series=%s
            ORDER BY ts DESC
            LIMIT 1
            """,
            (series,),
        )
        row = cur.fetchone()
        if not row:
            return None
        ts = row["ts"].isoformat()
        return ts, float(row["value"])


def estimate_pv_kw_from_ghi(ghi_w_m2: float) -> float:
    pv_kw = (ghi_w_m2 * PV_AREA_M2 * PV_EFF) / 1000.0
    # clamp to >=0
    if pv_kw < 0:
        pv_kw = 0.0
    return pv_kw


def publish_json(ch, exchange: str, routing_key: str, payload: dict):
    body = json.dumps(payload).encode("utf-8")
    ch.basic_publish(
        exchange=exchange,
        routing_key=routing_key,
        body=body,
        properties=pika.BasicProperties(
            delivery_mode=2,
            content_type="application/json",
        ),
    )


def main():
    print(f"[ctx] PG_CONN_STR={PG_CONN_STR}")
    print(f"[ctx] AMQP_URL={AMQP_URL}")
    print(f"[ctx] exchange={FORECASTS_EXCHANGE} rk={FORECASTS_ROUTING_KEY} every={EMIT_INTERVAL_SECONDS}s")
    print(f"[ctx] load={SERIES_LOAD} ghi={SERIES_GHI} pv_area={PV_AREA_M2} eff={PV_EFF} price(dummy)={DUMMY_PRICE_EUR_KWH}")

    conn = psycopg2.connect(PG_CONN_STR)
    soc = SOC_INIT

    amqp = pika.BlockingConnection(pika.URLParameters(AMQP_URL))
    ch = amqp.channel()

    # Ensure exchange exists (idempotent)
    ch.exchange_declare(exchange=FORECASTS_EXCHANGE, exchange_type="direct", durable=True)

    while True:
        try:
            now = iso_utc_now()

            load = db_fetch_latest_value(conn, SERIES_LOAD)
            ghi = db_fetch_latest_value(conn, SERIES_GHI)

            load_kw = float(load[1]) if load else None
            ghi_w_m2 = float(ghi[1]) if ghi else 0.0

            pv_kw = estimate_pv_kw_from_ghi(ghi_w_m2)

            # Keep SoC bounded (dummy)
            soc = max(SOC_MIN, min(SOC_MAX, soc))

            event = {
                "ts": now,
                "series": SERIES_LOAD,
                "q50": load_kw if load_kw is not None else 0.0,
                "extras": {
                    "price_eur_kwh": DUMMY_PRICE_EUR_KWH,
                    "pv_kw_q50": pv_kw,
                    "soc": soc,
                    "ghi_w_m2": ghi_w_m2,
                },
                "meta": {
                    "source": "bandit_context_emitter",
                    "notes": "MVP: price=constant, pv from ghi, soc dummy",
                },
            }

            publish_json(ch, FORECASTS_EXCHANGE, FORECASTS_ROUTING_KEY, event)
            print(f"[ctx] published ts={now} load_q50_kw={event['q50']} pv_kw_q50={pv_kw:.3f} soc={soc:.3f}")

        except Exception as e:
            print("[ctx] ERROR:", repr(e))

        time.sleep(EMIT_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()

