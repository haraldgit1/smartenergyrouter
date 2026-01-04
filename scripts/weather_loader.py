#!/usr/bin/env python3
import requests
import psycopg2
import datetime as dt

# ---------------------------------------------------------
# Standort Graz
# ---------------------------------------------------------
LAT = 47.0707
LON = 15.4395

# ---------------------------------------------------------
# Open-Meteo API – Wetter + Regen + Wind + Forecast
# ---------------------------------------------------------
URL = (
    "https://api.open-meteo.com/v1/forecast"
    f"?latitude={LAT}&longitude={LON}"
    "&hourly=temperature_2m,shortwave_radiation,"
    "precipitation,precipitation_probability,windspeed_10m"
    "&timezone=Europe/Vienna"
    "&past_days=2&forecast_days=5"
)

# ---------------------------------------------------------
# DB-Verbindung
# ---------------------------------------------------------
conn = psycopg2.connect(
    "dbname=energy user=postgres password=postgres host=localhost"
)
cur = conn.cursor()

# ---------------------------------------------------------
# Daten holen
# ---------------------------------------------------------
r = requests.get(URL, timeout=20)
r.raise_for_status()
data = r.json()

hourly = data["hourly"]

times = hourly["time"]
temps = hourly["temperature_2m"]
ghi   = hourly["shortwave_radiation"]
precip = hourly.get("precipitation", [])
precip_prob = hourly.get("precipitation_probability", [])
wind_kmh = hourly.get("windspeed_10m", [])

# gemeinsamer Timestamp für diesen Loader-Durchlauf
generated_ts = dt.datetime.now(dt.timezone.utc)

# ---------------------------------------------------------
# LOOP – Pro Stunde: alle Werte schreiben
# ---------------------------------------------------------
for i, ts in enumerate(times):
    temp = temps[i]
    ghi_value = ghi[i]

    # optional Werte (falls Open-Meteo Lücken hat)
    rain_mm = precip[i] if i < len(precip) else None
    rain_prob = precip_prob[i] if i < len(precip_prob) else None
    wind = wind_kmh[i] if i < len(wind_kmh) else None

    # ---------------------------
    # Messungen (INSERT/UPDATE)
    # ---------------------------
    entries = [
        ("weather:temp_c", temp),
        ("weather:ghi_w_m2", ghi_value),
    ]

    if rain_mm is not None:
        entries.append(("weather:rain_mm", rain_mm))

    if rain_prob is not None:
        entries.append(("weather:rain_prob_pct", rain_prob))

    if wind is not None:
        entries.append(("weather:wind_kmh", wind))

    for series, value in entries:
        cur.execute(
            """
            INSERT INTO measurements (ts, series, value)
            VALUES (%s, %s, %s)
            ON CONFLICT (ts, series)
            DO UPDATE SET value = EXCLUDED.value;
            """,
            (ts, series, float(value)),
        )

        # History-Logging (append only)
        cur.execute(
            """
            INSERT INTO measurements_histo (ts, series, value, generated_ts)
            VALUES (%s, %s, %s, %s)
            """,
            (ts, series, float(value), generated_ts),
        )

# ---------------------------------------------------------
# Commit + Cleanup
# ---------------------------------------------------------
conn.commit()
cur.close()
conn.close()

print("Weather updated (Graz) – temp, GHI, rain, rain_prob, wind gespeichert.")

