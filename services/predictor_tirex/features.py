#!/usr/bin/env python3
"""
Feature-Pipeline für den Ella TiRex Predictor.

- Holt Last + Wetter + Preise aus der measurements-Tabelle (TimescaleDB)
- Aggregiert auf ein gewünschtes Zeitraster (step_minutes)
- Füllt Lücken und erzeugt Zeit-Features
- Normalisiert die Features auf Basis der History
- Gibt ein NumPy-Array X und Scaling-Infos zurück
"""

import logging
from typing import Tuple, Dict, Any

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def fetch_feature_frame(
    conn: Any,
    load_series: str,
    history_hours: int,
    step_minutes: int,
) -> pd.DataFrame:
    """
    Holt ein DataFrame mit Last + Wetter + Preis,
    aggregiert auf step_minutes und die letzten history_hours
    RELATIV zum letzten verfügbaren Last-Timestamp (last_ts).
    """

    step_interval = f"{step_minutes} minutes"
    history_interval_hours = history_hours

    # 1) Letzten Timestamp der Lastserie ermitteln
    with conn.cursor() as cur:
        cur.execute(
            "SELECT max(ts) FROM measurements WHERE series = %s;",
            (load_series,),
        )
        row = cur.fetchone()
        last_ts = row[0]

    if last_ts is None:
        raise ValueError(f"Keine Last-Daten für series='{load_series}' gefunden")

    # Startzeit = last_ts - history_hours
    start_ts = last_ts - pd.Timedelta(hours=history_interval_hours)

    logger.info(
        "Lade Feature-Historie aus measurements "
        "(series=%s, start_ts=%s, last_ts=%s, step=%s)",
        load_series,
        start_ts,
        last_ts,
        step_interval,
    )

    query = """
        WITH base AS (
            SELECT
                time_bucket(%(step_interval)s::interval, ts) AS bucket,
                series,
                AVG(value) AS value
            FROM measurements
            WHERE ts >= %(start_ts)s
              AND ts <= %(end_ts)s
              AND series IN (
                %(load_series)s,
                'weather:temp_c',
                'weather:shortwave_radiation_wm2',
                'weather:cloud_cover_pct',
                'price:awattar_eur_mwh'
              )
            GROUP BY bucket, series
        )
        SELECT
            bucket AS ts,
            MAX(CASE WHEN series = %(load_series)s THEN value END) AS load_kw,
            MAX(CASE WHEN series = 'weather:temp_c' THEN value END) AS temp_c,
            MAX(CASE WHEN series = 'weather:shortwave_radiation_wm2' THEN value END) AS radiation_wm2,
            MAX(CASE WHEN series = 'weather:cloud_cover_pct' THEN value END) AS cloud_cover_pct,
            MAX(CASE WHEN series = 'price:awattar_eur_mwh' THEN value END) AS price_eur_mwh
        FROM base
        GROUP BY bucket
        ORDER BY bucket;
    """

    params = {
        "step_interval": step_interval,
        "start_ts": start_ts,
        "end_ts": last_ts,
        "load_series": load_series,
    }

    with conn.cursor() as cur:
        cur.execute(query, params)
        rows = cur.fetchall()
        cols = [desc[0] for desc in cur.description]

    df = pd.DataFrame(rows, columns=cols)

    if df.empty:
        raise ValueError(
            f"Keine historischen Daten im Fenster [{start_ts}, {last_ts}] für series='{load_series}'"
        )

    # Index setzen & sortieren
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    df = df.set_index("ts").sort_index()

    # Lückenlose Zeitachse von start_ts bis last_ts
    full_index = pd.date_range(
        start=df.index.min(),
        end=df.index.max(),
        freq=f"{step_minutes}min",
        tz="UTC",
    )
    df = df.reindex(full_index)

    # Fehlende Werte für exogene Variablen behandeln
    # Sicherstellen, dass alle exogenen Features numerisch sind
    for col in ["temp_c", "radiation_wm2", "cloud_cover_pct", "price_eur_mwh"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    # Temperatur: interpolieren und füllen
    df["temp_c"] = df["temp_c"].interpolate().ffill().bfill()

    # Strahlung: fehlende Werte als 0 (nachts etc.)
    df["radiation_wm2"] = df["radiation_wm2"].fillna(0.0)

    # Bewölkung: interpolieren, dann füllen
    df["cloud_cover_pct"] = df["cloud_cover_pct"].interpolate().ffill().bfill()

    # Preis: interpolieren/fill (aWATTar liefert meist vollständige Stundenwerte)
    df["price_eur_mwh"] = df["price_eur_mwh"].interpolate().ffill().bfill()


    # Last: Missing-Quote nur innerhalb dieses Fensters berechnen
    missing_ratio = df["load_kw"].isna().mean()
    if missing_ratio > 0.8:
        raise ValueError(
            f"Zu viele fehlende Last-Daten ({missing_ratio:.0%}) im Fenster "
            f"[{start_ts}, {last_ts}] für verlässliche Prognose"
        )

    df["load_kw"] = df["load_kw"].interpolate().ffill().bfill()

    return df


def add_time_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Ergänzt Zeit-Features basierend auf dem DatetimeIndex:

    - hour_sin, hour_cos
    - dow_sin, dow_cos
    """

    if not isinstance(df.index, pd.DatetimeIndex):
        raise ValueError("DataFrame-Index muss ein DatetimeIndex sein")

    idx = df.index

    # Stunde + Minuten als Bruchteil
    hour = idx.hour + idx.minute / 60.0
    dow = idx.dayofweek  # 0=Montag

    df = df.copy()
    df["hour_sin"] = np.sin(2 * np.pi * hour / 24.0)
    df["hour_cos"] = np.cos(2 * np.pi * hour / 24.0)
    df["dow_sin"] = np.sin(2 * np.pi * dow / 7.0)
    df["dow_cos"] = np.cos(2 * np.pi * dow / 7.0)

    return df


def build_tirex_input(
    df: pd.DataFrame,
    history_steps: int,
) -> Tuple[np.ndarray, Dict[str, Any], pd.Timestamp]:
    """
    Baut das Input-Array X für das Modell und liefert zusätzlich
    Scaling-Infos und den letzten Zeitschritt der Historie.

    Rückgabe:
      X: np.ndarray mit Shape (history_steps, num_features)
      scaling_info: Dict mit means/stds pro Feature
      last_ts: letzter Zeitstempel der Historie
    """

    if df.empty:
        raise ValueError("Feature-DataFrame ist leer")

    df = add_time_features(df)

    feature_cols = [
        "load_kw",
        "temp_c",
        "radiation_wm2",
        "cloud_cover_pct",
        "price_eur_mwh",
        "hour_sin",
        "hour_cos",
        "dow_sin",
        "dow_cos",
    ]

    missing_cols = [c for c in feature_cols if c not in df.columns]
    if missing_cols:
        raise ValueError(f"Fehlende Feature-Spalten im DataFrame: {missing_cols}")

    df_feat = df[feature_cols].copy()

    if len(df_feat) < history_steps:
        raise ValueError(
            f"Zu wenig Historie für history_steps={history_steps} (verfügbar={len(df_feat)})"
        )

    # Nur die letzten history_steps als Kontext verwenden
    df_hist = df_feat.iloc[-history_steps:]

    # Z-Score-Normalisierung auf Basis der History
    df_hist_float = df_hist.astype("float64")

    means = df_hist_float.mean()
    stds = df_hist_float.std()
    means = means.astype("float64")
    stds = stds.astype("float64")

    # Schutz gegen std=0
    stds = stds.replace(0.0, 1.0)


    df_norm = (df_hist - means) / stds

    X = df_norm.to_numpy(dtype="float32")  # (history_steps, num_features)

    scaling_info = {
        "feature_cols": feature_cols,
        "means": means.to_dict(),
        "stds": stds.to_dict(),
    }

    last_ts = df_hist.index[-1]

    return X, scaling_info, last_ts


def invert_scaling(
    y_norm: np.ndarray,
    scaling_info: Dict[str, Any],
    target_feature: str = "load_kw",
) -> np.ndarray:
    """
    Skaliert eine normierte Prognose für target_feature zurück
    auf die Originaleinheit (hier: load_kw).
    """

    means = scaling_info.get("means", {})
    stds = scaling_info.get("stds", {})

    if target_feature not in means or target_feature not in stds:
        raise ValueError(f"Keine Scaling-Infos für Feature '{target_feature}' gefunden")

    mean = float(means[target_feature])
    std = float(stds[target_feature])

    return y_norm * std + mean

