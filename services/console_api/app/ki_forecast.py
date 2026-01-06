# services/console_api/app/ki_forecast.py

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from typing import List, Dict, Any, Optional
import os
import psycopg2
from psycopg2.extras import RealDictCursor, Json, execute_values
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


def _iso_z(ts: datetime) -> str:
    return ts.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _parse_iso(ts: str) -> datetime:
    # Robust gegen Z oder +00:00
    if ts.endswith("Z"):
        ts = ts[:-1] + "+00:00"
    return datetime.fromisoformat(ts)


def _floor_to_step(ts: datetime, step_minutes: int) -> datetime:
    """
    Rundet ts in UTC nach unten auf step_minutes.
    """
    t = ts.astimezone(timezone.utc)
    minute = (t.minute // step_minutes) * step_minutes
    return t.replace(minute=minute, second=0, microsecond=0)


def _build_upsampled_forecast(
    points: List[Dict[str, Any]],
    step_minutes_target: int,
    horizon_hours: int,
) -> List[Dict[str, Any]]:
    """
    Upsample Forecast-Punkte auf feineres Raster (z.B. 15 -> 5 Minuten),
    mittels step-hold (forward-fill innerhalb des 15-min Slots).

    Erwartet points als Liste mit:
      { "ts": "...", "q10": ..., "q50": ..., "q90": ... }

    Gibt Liste mit:
      { "target_ts": "...", "q10": ..., "q50": ..., "q90": ... }
    """
    if not points:
        return []

    orig = []
    for p in points:
        if "ts" not in p:
            continue
        try:
            d = _parse_iso(p["ts"])
        except Exception:
            continue
        orig.append((d, p))

    if not orig:
        return []

    orig.sort(key=lambda x: x[0])
    start = orig[0][0]
    end = start + timedelta(hours=horizon_hours)

    idx = 0
    last_p: Optional[Dict[str, Any]] = None

    out: List[Dict[str, Any]] = []
    cur = start
    step = timedelta(minutes=step_minutes_target)

    while cur <= end:
        while idx < len(orig) and orig[idx][0] <= cur:
            last_p = orig[idx][1]
            idx += 1

        if last_p is None:
            q10 = q50 = q90 = None
        else:
            q10 = last_p.get("q10")
            q50 = last_p.get("q50")
            q90 = last_p.get("q90")

        out.append(
            {
                "target_ts": _iso_z(cur),
                "q10": q10,
                "q50": q50,
                "q90": q90,
            }
        )
        cur += step

    return out


def _persist_forecast_points(
    series: str,
    backend_used: str,
    predictor_step_minutes: int,
    step_minutes_requested: int,
    history_hours: int,
    horizon_hours: int,
    forecast_points: List[Dict[str, Any]],
):
    """
    Persistiert Forecast in Tabelle forecasts.

    MVP-Strategie: Wir ersetzen den Zielzeitraum für (series, backend) für diesen Run:
      - delete rows im target_ts Fenster
      - insert neue rows mit ts=run_ts (UTC now)

    Umsetzung robust: bulk insert via execute_values (kein VALUES-Monster).
    """
    if not forecast_points:
        return

    # target_ts window ableiten
    try:
        t0 = _parse_iso(forecast_points[0]["target_ts"])
        t1 = _parse_iso(forecast_points[-1]["target_ts"])
    except Exception:
        return

    # defensiv: backend_used nie leer
    backend_used = (backend_used or "").strip() or "unknown"

    run_ts = datetime.now(timezone.utc)

    meta_obj = {
        "history_hours": history_hours,
        "horizon_hours": horizon_hours,
        "step_minutes_requested": step_minutes_requested,
        "predictor_step_minutes": predictor_step_minutes,
        "source": "console_api.ki_forecast",
    }

    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            # alten Bereich löschen (nur für dieses backend+series)
            cur.execute(
                """
                DELETE FROM forecasts
                WHERE series = %s
                  AND backend = %s
                  AND target_ts >= %s
                  AND target_ts <= %s
                """,
                (series, backend_used, t0, t1),
            )

            rows = []
            for p in forecast_points:
                target_ts = _parse_iso(p["target_ts"])
                q10 = p.get("q10")
                q50 = p.get("q50")
                q90 = p.get("q90")
                rows.append(
                    (
                        run_ts,
                        target_ts,
                        series,
                        q10,
                        q50,
                        q90,
                        backend_used,
                        Json(meta_obj),
                    )
                )

            sql = """
                INSERT INTO forecasts (ts, target_ts, series, q10, q50, q90, backend, meta)
                VALUES %s
            """
            execute_values(cur, sql, rows, page_size=1000)

        conn.commit()
    finally:
        try:
            conn.close()
        except Exception:
            pass


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

            # History
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
                        "ts": _iso_z(ts),
                        "value": float(r["value"]) if r["value"] is not None else None,
                    }
                )

            # Price
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
                        "ts": _iso_z(ts),
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
    # 2) Predictor-Service aufrufen
    # -------------------------------------------------------------------
    predictor_step = step_minutes if step_minutes >= 15 else 15

    try:
        params = {
            "series": series,
            "history_hours": history_hours,
            "horizon_hours": horizon_hours,
            "step_minutes": predictor_step,
            "backend": backend,
        }
        resp = requests.get(
            f"{PREDICTOR_URL}/ki/forecast",
            params=params,
            timeout=20,
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

    # -------------------------------------------------------------------
    # 2b) Forecast ggf. auf feineres Raster bringen
    # -------------------------------------------------------------------
    forecast: List[Dict[str, Any]] = []

    if step_minutes >= 15:
        for p in points:
            forecast.append(
                {
                    "target_ts": p.get("ts"),
                    "q10": p.get("q10"),
                    "q50": p.get("q50"),
                    "q90": p.get("q90"),
                    "backend": backend_used,
                }
            )
    else:
        up = _build_upsampled_forecast(
            points=points,
            step_minutes_target=step_minutes,
            horizon_hours=horizon_hours,
        )
        for p in up:
            forecast.append(
                {
                    "target_ts": p["target_ts"],
                    "q10": p.get("q10"),
                    "q50": p.get("q50"),
                    "q90": p.get("q90"),
                    "backend": backend_used,
                }
            )

    if not forecast:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Predictor hat keine Forecast-Punkte geliefert "
                f"(series='{series}', step_minutes={step_minutes}, predictor_step={predictor_step})"
            ),
        )

    # -------------------------------------------------------------------
    # ✅ 2c) Persistieren in forecasts (MVP)
    # -------------------------------------------------------------------
    try:
        _persist_forecast_points(
            series=series,
            backend_used=backend_used,
            predictor_step_minutes=predictor_step,
            step_minutes_requested=step_minutes,
            history_hours=history_hours,
            horizon_hours=horizon_hours,
            forecast_points=forecast,
        )
    except Exception as e:
        # Persist ist "best effort" – UI/Endpoint soll weiter funktionieren
        print(f"[WARN] persist forecasts failed: {e}")

    # -------------------------------------------------------------------
    # 3) Meta
    # -------------------------------------------------------------------
    history_from = history[0]["ts"]
    forecast_to = forecast[-1]["target_ts"]

    meta = {
        "history_points": len(history),
        "forecast_points": len(forecast),
        "history_from": history_from,
        "forecast_to": forecast_to,
        "step_minutes": step_minutes,
        "predictor_step_minutes": predictor_step,
        "backend": backend_used,
    }

    return {
        "series": series,
        "meta": meta,
        "history": history,
        "forecast": forecast,
        "price": price,
    }

