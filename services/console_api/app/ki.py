# app/ki.py
from typing import List, Optional
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

# DB-Helper wie bei mdm_usecases / mdm_reports
from app.mdm_devices import db_fetch_all, db_fetch_one

router = APIRouter(prefix="/ki", tags=["ki"])


# -------------------------------------------------------
# Pydantic-Modelle
# -------------------------------------------------------

class HistoryPoint(BaseModel):
    ts: datetime
    value: float


class ForecastPoint(BaseModel):
    target_ts: datetime
    q50: float
    backend: str


class ForecastResponse(BaseModel):
    series: str
    history: List[HistoryPoint]
    forecast: List[ForecastPoint]
    meta: dict


# -------------------------------------------------------
# GET /ki/forecast – Historie + Forecast für eine Zeitreihe
# -------------------------------------------------------

@router.get("/forecast", response_model=ForecastResponse)
async def get_forecast(
    series: str = Query(..., description="Zeitreihe, z.B. 'meter1:load_kw'"),
    history_hours: int = Query(
        24,
        ge=1,
        le=240,
        description="Anzahl Stunden Historie vor 'jetzt'"
    ),
    horizon_hours: int = Query(
        24,
        ge=1,
        le=240,
        description="Anzahl Stunden Forecast nach 'jetzt'"
    ),
):
    """
    Liefert Historie + Forecast für eine bestimmte Zeitreihe.

    - history: Messwerte aus 'measurements' der letzten `history_hours`
    - forecast: Vorhersage aus 'forecasts' für die nächsten `horizon_hours`
    """

    now = datetime.now(timezone.utc)
    history_from = now - timedelta(hours=history_hours)
    forecast_to = now + timedelta(hours=horizon_hours)

    # 1) Historie laden
    sql_history = """
        SELECT ts, value
        FROM measurements
        WHERE series = $1
          AND ts >= $2
          AND ts <= $3
        ORDER BY ts
    """
    history_rows = await db_fetch_all(sql_history, series, history_from, now)

    # 2) Forecast laden
    sql_forecast = """
        SELECT target_ts, q50, backend
        FROM forecasts
        WHERE series = $1
          AND target_ts > $2
          AND target_ts <= $3
        ORDER BY target_ts
    """
    forecast_rows = await db_fetch_all(sql_forecast, series, now, forecast_to)

    if not history_rows and not forecast_rows:
        raise HTTPException(
            status_code=404,
            detail=f"Keine Daten für series='{series}' im gewünschten Zeitraum gefunden.",
        )

    history = [
        HistoryPoint(
            ts=row["ts"],
            value=row["value"],
        )
        for row in history_rows
    ]

    forecast = [
        ForecastPoint(
            target_ts=row["target_ts"],
            q50=row["q50"],
            backend=row["backend"],
        )
        for row in forecast_rows
    ]

    meta = {
        "now": now.isoformat(),
        "history_from": history_from.isoformat(),
        "forecast_to": forecast_to.isoformat(),
        "history_points": len(history),
        "forecast_points": len(forecast),
    }

    return ForecastResponse(
        series=series,
        history=history,
        forecast=forecast,
        meta=meta,
    )

