#!/usr/bin/env python3
import os
import sys
import json
import datetime as dt
from typing import List, Tuple, Optional

import psycopg2
import requests

PG_CONN_STR = os.environ.get(
    "PG_CONN_STR",
    "postgres://postgres:postgres@localhost:5432/energy",
)

TIREX_URL = os.environ.get(
    "TIREX_URL",
    "http://localhost:8100/ki/forecast",
)

FORECAST_SERIES = os.environ.get(
    "FORECAST_SERIES",
    "meter1:load_kw",
)

HISTORY_HOURS = int(os.environ.get("FORECAST_HISTORY_HOURS", "48"))
HORIZON_HOURS = int(os.environ.get("FORECAST_HORIZON_HOURS", "48"))
RES_MINUTES = int(os.environ.get("FORECAST_RES_MINUTES", "60"))

BACKEND_NAME = os.environ.get("FORECAST_BACKEND_NAME", "tirex")


def iso_utc(dt_obj: dt.datetime) -> str:
    if dt_obj.tzinfo is None:
        dt_obj = dt_obj.replace(tzinfo=dt.timezone.utc)
    return dt_obj.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def parse_list_of_points(
    obj,
) -> List[Tuple[dt.datetime, Optional[float], Optional[float], Optional[float]]]:
    if isinstance(obj, dict):
        items = (
            obj.get("forecast")
            or obj.get("forecasts")
            or obj.get("points")
            or obj.get("data")
            or obj.get("values")
            or []
        )
    elif isinstance(obj, list):
        items = obj
    else:
        return []

    if not isinstance(items, list):
        return []

    rows: List[Tuple[dt.datetime, Optional[float], Optional[float], Optional[float]]] = []

    for item in items:
        if not isinstance(item, dict):
            continue

        ts_str = (
            item.get("target_ts")
            or item.get("ts")
            or item.get("time")
            or item.get("target_time")
        )
        if not ts_str:
            continue

        try:
            target_ts = dt.datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        except Exception:
            continue

        q10 = item.get("q10")
        q50 = item.get("q50")
        if q50 is None:
            q50 = item.get("value")
        if q50 is None:
            q50 = item.get("mean")

        q90 = item.get("q90")

        rows.append((target_ts, q10, q50, q90))

    return rows


def parse_axis_format(
    obj, reference_ts: dt.datetime
) -> List[Tuple[dt.datetime, Optional[float], Optional[float], Optional[float]]]:
    if not isinstance(obj, dict):
        return []

    axis = obj.get("axis")
    load_q10 = obj.get("load_q10")
    load_q50 = obj.get("load_q50") or obj.get("q50")
    load_q90 = obj.get("load_q90")

    if not isinstance(axis, list):
        return []
    n = len(axis)
    if n == 0:
        return []

    def safe_list(lst, name):
        if lst is None:
            return [None] * n
        if not isinstance(lst, list):
            return [None] * n
        if len(lst) < n:
            return lst + [None] * (n - len(lst))
        if len(lst) > n:
            return lst[:n]
        return lst

    load_q10 = safe_list(load_q10, "load_q10")
    load_q50 = safe_list(load_q50, "load_q50")
    load_q90 = safe_list(load_q90, "load_q90")

    now_index = obj.get("now_index")
    start_index = 0
    if isinstance(now_index, int) and 0 <= now_index < n:
        start_index = now_index + 1

    rows: List[Tuple[dt.datetime, Optional[float], Optional[float], Optional[float]]] = []

    ref_utc = reference_ts.astimezone(dt.timezone.utc)

    for i in range(start_index, n):
        ts_str = axis[i]
        if not isinstance(ts_str, str):
            continue
        try:
            target_ts = dt.datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        except Exception:
            continue

        if target_ts < ref_utc:
            continue

        q10 = load_q10[i]
        q50 = load_q50[i]
        q90 = load_q90[i]

        if q10 is None and q50 is None and q90 is None:
            continue

        rows.append((target_ts, q10, q50, q90))

    return rows


def fetch_forecast(series: str, reference_ts: dt.datetime):
    params = {
        "series": series,
        "history_hours": HISTORY_HOURS,
        "horizon_hours": HORIZON_HOURS,
        "resolution_minutes": RES_MINUTES,
        "reference_ts": iso_utc(reference_ts),
    }

    print(f"[TiRex] Hole Forecast für {series} mit params={params}", file=sys.stderr)
    resp = requests.get(TIREX_URL, params=params, timeout=30)
    resp.raise_for_status()
    text = resp.text

    try:
        obj = resp.json()
    except Exception as e:
        print(
            f"[TiRex] Konnte JSON nicht parsen für {series}: {e}. Rohtext: {text[:500]}",
            file=sys.stderr,
        )
        raise

    rows = parse_list_of_points(obj)
    if rows:
        print(
            f"[TiRex] {series}: {len(rows)} Forecast-Punkte (List-of-points)",
            file=sys.stderr,
        )
        return rows

    rows = parse_axis_format(obj, reference_ts)
    if rows:
        print(
            f"[TiRex] {series}: {len(rows)} Forecast-Punkte (axis/array)",
            file=sys.stderr,
        )
        return rows

    print(
        f"[TiRex] {series}: 0 Forecast-Punkte gefunden. Response (gekürzt): {text[:500]}",
        file=sys.stderr,
    )
    return []


def upsert_forecasts(
    conn,
    series: str,
    generation_ts: dt.datetime,
    rows: List[Tuple[dt.datetime, Optional[float], Optional[float], Optional[float]]],
):
    if not rows:
        print(f"[TiRex] {series}: Keine Forecast-Zeilen zu speichern", file=sys.stderr)
        return

    sql = """
        INSERT INTO forecasts (
            ts,
            target_ts,
            series,
            q10,
            q50,
            q90,
            backend,
            meta
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (series, target_ts, ts) DO UPDATE
        SET q10     = EXCLUDED.q10,
            q50     = EXCLUDED.q50,
            q90     = EXCLUDED.q90,
            backend = EXCLUDED.backend,
            meta    = EXCLUDED.meta;
    """

    histo_sql = """
        INSERT INTO forecasts_histo (
            ts,
            target_ts,
            series,
            q10,
            q50,
            q90,
            backend,
            meta,
            generated_ts
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s);
    """

    gen_ts = generation_ts.astimezone(dt.timezone.utc)

    # Debug: min/max target_ts in diesem Lauf aus den rows herauslesen
    all_ts = [r[0] for r in rows if isinstance(r[0], dt.datetime)]
    min_target_ts = min(all_ts).astimezone(dt.timezone.utc) if all_ts else None
    max_target_ts = max(all_ts).astimezone(dt.timezone.utc) if all_ts else None

    with conn.cursor() as cur:
        for target_ts, q10, q50, q90 in rows:
            # 1) Aktuelle Forecast-Tabelle pflegen (bestehende Logik)
            cur.execute(
                sql,
                (
                    gen_ts,
                    target_ts,
                    series,
                    q10,
                    q50,
                    q90,
                    BACKEND_NAME,
                    None,
                ),
            )

            # 2) History-Eintrag schreiben (append-only)
            cur.execute(
                histo_sql,
                (
                    gen_ts,        # ts
                    target_ts,
                    series,
                    q10,
                    q50,
                    q90,
                    BACKEND_NAME,
                    None,
                    gen_ts,        # generated_ts
                ),
            )

    print(
        f"[TiRex] {series}: {len(rows)} Forecast-Zeilen upserted "
        f"(target_ts von {min_target_ts} bis {max_target_ts}) "
        f"und in forecasts_histo protokolliert.",
        file=sys.stderr,
    )


def main():
    series_list = [s.strip() for s in FORECAST_SERIES.split(",") if s.strip()]
    if not series_list:
        print("[TiRex] FORECAST_SERIES ist leer, nichts zu tun.", file=sys.stderr)
        return

    now_utc = dt.datetime.now(dt.timezone.utc)
    print(
        f"[TiRex] Starte Forecast-Lauf um {now_utc.isoformat()} für Serien: {series_list}",
        file=sys.stderr,
    )

    conn = psycopg2.connect(PG_CONN_STR)
    conn.autocommit = False
    try:
        for series in series_list:
            try:
                rows = fetch_forecast(series, now_utc)
                upsert_forecasts(conn, series, now_utc, rows)
                conn.commit()
            except Exception as e:
                conn.rollback()
                print(
                    f"[TiRex] Fehler beim Forecast für {series}: {e}",
                    file=sys.stderr,
                )
        print("[TiRex] Forecast-Lauf abgeschlossen.", file=sys.stderr)
    finally:
        conn.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"[TiRex] insertForecast.py failed: {e}", file=sys.stderr)
        sys.exit(1)

