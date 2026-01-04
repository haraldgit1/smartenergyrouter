# services/predictor_tirex/main.py

from __future__ import annotations

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse
from datetime import datetime, timedelta, timezone
import os
import psycopg2
import logging

from features import fetch_feature_frame, build_tirex_input, invert_scaling
from model_tirex import load_tirex_model, call_tirex

logger = logging.getLogger(__name__)

app = FastAPI(title="Ella TiRex Predictor")

PG_CONN_STR = os.getenv("PG_CONN_STR", "postgres://postgres:postgres@timescaledb:5432/energy")
DEFAULT_HISTORY_HOURS = int(os.getenv("FORECAST_HISTORY_HOURS", "168"))
DEFAULT_HORIZON_HOURS = int(os.getenv("FORECAST_HORIZON_HOURS", "48"))
DEFAULT_STEP_MINUTES = int(os.getenv("FORECAST_RESOLUTION_MIN", "60"))
BACKEND_NAME = os.getenv("FORECAST_BACKEND", "tirex_v1")


def get_db_connection():
    return psycopg2.connect(PG_CONN_STR)


# Modell beim Startup laden (CPU + torch Backend)
try:
    MODEL = load_tirex_model()
    logger.info("TiRex-Modell erfolgreich geladen (CPU/torch)")
except Exception as e:
    # Wenn hier etwas schiefgeht, liefern wir später 500 im Endpoint
    logger.exception("Fehler beim Laden des TiRex-Modells: %s", e)
    MODEL = None


@app.get("/health")
def health():
    status = "ok" if MODEL is not None else "error"
    return {"status": status, "service": "predictor_tirex", "backend": BACKEND_NAME}


@app.get("/ki/forecast")
def get_forecast(
    series: str = Query(..., description="z.B. meter1:load_kw"),
    history_hours: int = Query(DEFAULT_HISTORY_HOURS, ge=1, le=24 * 60),
    horizon_hours: int = Query(DEFAULT_HORIZON_HOURS, ge=1, le=24 * 14),
    step_minutes: int = Query(DEFAULT_STEP_MINUTES, ge=15, le=240),
):
    if MODEL is None:
        raise HTTPException(status_code=500, detail="TiRex-Modell ist nicht verfügbar")

    # DB-Verbindung
    try:
        conn = get_db_connection()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB-Verbindungsfehler: {e}")

    # Daten holen & Feature-Frame bauen
    try:
        df = fetch_feature_frame(conn, series, history_hours, step_minutes)
    except ValueError as e:
        conn.close()
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=500, detail=f"Fehler beim Laden der Daten: {e}")
    finally:
        try:
            conn.close()
        except Exception:
            pass

    history_steps = int(history_hours * 60 / step_minutes)
    horizon_steps = int(horizon_hours * 60 / step_minutes)

    try:
        X, scaling_info, last_ts = build_tirex_input(df, history_steps)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # TiRex aufrufen (im normierten Raum)
    try:
        preds_norm = call_tirex(MODEL, X, horizon_steps=horizon_steps)
    except Exception as e:
        logger.exception("Fehler beim Aufruf von TiRex: %s", e)
        raise HTTPException(status_code=500, detail=f"Modell-Fehler (TiRex): {e}")

    # Skalen für load_kw zurückdrehen
    q10 = invert_scaling(preds_norm["q10"], scaling_info).tolist()
    q50 = invert_scaling(preds_norm["q50"], scaling_info).tolist()
    q90 = invert_scaling(preds_norm["q90"], scaling_info).tolist()

    # Timestamps für Horizon erzeugen (weiterhin relativ zu last_ts)
    points = []
    current_ts = last_ts
    delta = timedelta(minutes=step_minutes)
    for i in range(horizon_steps):
        current_ts = current_ts + delta
        ts_str = current_ts.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        points.append(
            {
                "ts": ts_str,
                "q10": q10[i],
                "q50": q50[i],
                "q90": q90[i],
            }
        )

    response = {
        "series": series,
        "backend": BACKEND_NAME,
        "resolution_minutes": step_minutes,
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "history_hours": history_hours,
        "horizon_hours": horizon_hours,
        "feature_config": {
            "features_used": [
                "load_kw",
                "temp_c",
                "radiation_wm2",
                "cloud_cover_pct",
                "price_eur_mwh",
                "hour_sin",
                "hour_cos",
                "dow_sin",
                "dow_cos",
            ],
            "weather_series": [
                "weather:temp_c",
                "weather:shortwave_radiation_wm2",
                "weather:cloud_cover_pct",
            ],
            "price_series": "price:awattar_eur_mwh",
        },
        "points": points,
    }

    return JSONResponse(content=response)

