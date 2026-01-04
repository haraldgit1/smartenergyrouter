# services/console_api/app/ki_forecast.py

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from typing import List, Dict, Any
import os
import psycopg2
from psycopg2.extras import RealDictCursor
import requests
from datetime import datetime, timezone, timedelta


# -------------------------------------------------------------------
# DB + Predictor Konfiguration
# -------------------------------------------------------------------

PG_CONN_STR = os.getenv(
    "PG_CONN_STR",
    "postgres://postgres:postgres@timescaledb:5432/energy",
)

PREDICTOR_URL = os.getenv(
    "PREDICTOR_URL",
    "http://predictor_tirex:8000",
)


def get_db_connection():
    return psycopg2.connect(PG_CONN_STR)


router = APIRouter(prefix="/ki", tags=["ki"])


# -------------------------------------------------------------------
# /ki/forecast – Aggregierter Forecast inkl. Preis-Serie
# -------------------------------------------------------------------

@router.get("/forecast")
def ki_forecast(
    series: str = Query(..., description="z.B. meter1:load_kw"),
    history_hours: int = Query(48, ge=1, le=24 * 60),
    horizon_hours: int = Query(24, ge=1, le=24 * 14),
    step_minutes: int = Query(60, ge=5, le=240),
    backend: str = Query("tirex_v1", description="tirex_v1 oder baseline_v1"),
):
    """
    Aggregierter KI-Forecast für das Console-UI:

    Antwortformat:
        {
          "series": "...",
          "meta": {...},
          "history": [{ts, value}],
          "forecast": [{target_ts, q10, q50, q90, backend}],
          "price": [{ts, value}]
        }

    Datenquellen:
      - History: TimescaleDB (measurements)
      - Forecast: predictor_tirex (/ki/forecast)
      - Price: measurements (price:awattar_eur_mwh)
    """

    # -------------------------------------------------------------------
    # 1) DB: History + Price-Serie holen
    # -------------------------------------------------------------------
    try:
        conn = get_db_connection()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB-Verbindungsfehler: {e}")

    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:

            # --- Letzten Timestamp der Serie bestimmen ---
            cur.execute(
                "SELECT max(ts) AS last_ts FROM measurements WHERE series = %s;",
                (series,),
            )
            row = cur.fetchone()
            last_ts = row["last_ts"]

            if last_ts is None:
                raise HTTPException(
                    status_code=400,
                    detail=f"Keine Messwerte für series='{series}' gefunden",
                )

            start_ts = last_ts - timedelta(hours=history_hours)
            price_end_ts = last_ts + timedelta(hours=horizon_hours)
            step_interval = f"{step_minutes} minutes"

            # ----------------------------------------------------------
            # (1) History holen
            # ----------------------------------------------------------
            cur.execute(
                """
                SELECT
                  time_bucket(%s::interval, ts) AS bucket,
                  AVG(value) AS value
                FROM measurements
                WHERE series = %s
                  AND ts >= %s
                  AND ts <= %s
                GROUP BY bucket
                ORDER BY bucket;
                """,
                (step_interval, series, start_ts, last_ts),
            )
            rows = cur.fetchall()

            history: List[Dict[str, Any]] = []
            for r in rows:
                ts: datetime = r["bucket"]
                history.append(
                    {
                        "ts": ts.astimezone(timezone.utc)
                        .isoformat()
                        .replace("+00:00", "Z"),
                        "value": float(r["value"]) if r["value"] is not None else None,
                    }
                )

            # ----------------------------------------------------------
            # (2) Preis-Zeitreihe holen (Awattar / EPEX)
            # ----------------------------------------------------------
            price_series = "price:awattar_eur_mwh"

            cur.execute(
                """
                SELECT
                  time_bucket(%s::interval, ts) AS bucket,
                  AVG(value) AS value
                FROM measurements
                WHERE series = %s
                  AND ts >= %s
                  AND ts <= %s
                GROUP BY bucket
                ORDER BY bucket;
                """,
                (step_interval, price_series, start_ts, price_end_ts),
            )
            price_rows = cur.fetchall()

            price: List[Dict[str, Any]] = []
            for r in price_rows:
                ts: datetime = r["bucket"]
                price.append(
                    {
                        "ts": ts.astimezone(timezone.utc)
                        .isoformat()
                        .replace("+00:00", "Z"),
                        "value": float(r["value"]) if r["value"] is not None else None,
                    }
                )

    finally:
        try:
            conn.close()
        except Exception:
            pass

    if not history:
        raise HTTPException(
            status_code=400,
            detail=f"Keine History im Fenster für series='{series}' gefunden",
        )

    # -------------------------------------------------------------------
    # 2) Predictor-Service aufrufen (TiRex / Baseline)
    # -------------------------------------------------------------------
    try:
        params = {
            "series": series,
            "history_hours": history_hours,
            "horizon_hours": horizon_hours,
            "step_minutes": step_minutes,
            "backend": backend,
        }
        resp = requests.get(
            f"{PREDICTOR_URL}/ki/forecast",
            params=params,
            timeout=15,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Fehler beim Aufruf des Predictor-Services: {e}",
        )

    if not resp.ok:
        raise HTTPException(
            status_code=resp.status_code,
            detail=f"Predictor-Service-Fehler: {resp.text}",
        )

    pred = resp.json()

    points = pred.get("points", [])
    backend_used = pred.get("backend", backend)

    forecast: List[Dict[str, Any]] = []
    for p in points:
        forecast.append(
            {
                "target_ts": p["ts"],
                "q10": p.get("q10"),
                "q50": p.get("q50"),
                "q90": p.get("q90"),
                "backend": backend_used,
            }
        )

    if not forecast:
        raise HTTPException(
            status_code=400,
            detail=f"Predictor hat keine Forecast-Punkte geliefert (series='{series}')",
        )

    # -------------------------------------------------------------------
    # 3) Meta-Daten
    # -------------------------------------------------------------------
    history_from = history[0]["ts"]
    forecast_to = forecast[-1]["target_ts"]

    meta = {
        "history_points": len(history),
        "forecast_points": len(forecast),
        "history_from": history_from,
        "forecast_to": forecast_to,
    }

    # -------------------------------------------------------------------
    # 4) Ergebnis zurückgeben (inkl. Price-Serie!)
    # -------------------------------------------------------------------
    result = {
        "series": series,
        "meta": meta,
        "history": history,
        "forecast": forecast,
        "price": price,       # <---- WICHTIG
    }

    return result

