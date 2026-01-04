#!/usr/bin/env python3
import os
import math
import random
import datetime
import psycopg2

PG_CONN_STR = os.environ.get(
    "PG_CONN_STR",
    "postgres://postgres:postgres@localhost:5432/energy",
)

# Demo-Serien
SERIES = [
    "meter1:load_kw",        # Demo 1 – Idealized Sine Load
    "residential1:load_kw",  # Demo 2 – Residential PV Complex
]

# Wie viele Tage rückwirkend sollen initial befüllt werden,
# falls noch keine Daten vorhanden sind?
DEFAULT_BACKFILL_DAYS = int(os.environ.get("BACKFILL_DAYS", "14"))

def round_to_full_hour(dt: datetime.datetime) -> datetime.datetime:
    return dt.replace(minute=0, second=0, microsecond=0)

# -------------------------
# Generator 1: SinusLoad
# -------------------------

def gen_sinusload_kw(ts: datetime.datetime) -> float:
    """
    Idealisiertes Sinus-Signal:
    - Mittlere Last: 5 kW
    - Amplitude:    3 kW
    - Periodendauer: 24 Stunden
    """
    # Tagesanteil in [0, 1)
    tod = ts.hour + ts.minute / 60.0
    phase = 2 * math.pi * tod / 24.0
    base = 5.0
    amp = 3.0
    value = base + amp * math.sin(phase)

    # kleine zufällige Variation
    value += random.uniform(-0.2, 0.2)

    # keine negative Last
    return max(0.0, value)

# -------------------------
# Generator 2: Residential PV Complex
# -------------------------

def gen_residential_kw(ts: datetime.datetime) -> float:
    """
    Vereinfachtes Modell für eine kleine Wohnanlage mit PV, WP, Batterie, EV etc.
    Wir modellieren die NETTO-Netzlast in kW.
    """

    # Basisgrößen
    hour = ts.hour + ts.minute / 60.0
    weekday = ts.weekday()  # 0=Montag ... 6=Sonntag

    # Grundlast (Durchlaufpumpen, Server, Standby, Beleuchtung)
    base_load = 4.0  # kW

    # Wochenend-Faktor (tagsüber etwas mehr Last)
    weekend = weekday >= 5
    weekend_factor = 1.2 if weekend else 1.0

    # Morgenpeak (6–9 Uhr): Bewohner stehen auf, Boiler, Kaffee, Dusche etc.
    morning_peak = 0.0
    if 5 <= hour <= 10:
        # Glocke zentriert um 7.5 Uhr
        morning_peak = 8.0 * math.exp(-0.5 * ((hour - 7.5) / 1.2) ** 2)

    # Mittag (11–15 Uhr): mehr Aktivität + etwas Kochen
    midday_peak = 0.0
    if 11 <= hour <= 15:
        midday_peak = 3.0 * math.exp(-0.5 * ((hour - 13.0) / 1.5) ** 2)

    # Abendpeak (17–22 Uhr): Kochen, TV, EV-Laden, Boiler
    evening_peak = 0.0
    if 16 <= hour <= 23:
        evening_peak = 10.0 * math.exp(-0.5 * ((hour - 19.5) / 1.8) ** 2)

    # PV-Entlastung (11–15 Uhr): PV reduziert Netzlast (negativer Beitrag)
    pv_relief = 0.0
    if 10 <= hour <= 16:
        # Maximum Entlastung um 13:00 – bis zu 10 kW weniger Netzlast
        pv_relief = -10.0 * math.exp(-0.5 * ((hour - 13.0) / 1.8) ** 2)

    # EV-Laden: nicht jeden Tag gleich stark
    # Wir machen ein deterministisches Muster: je nach Tag des Monats und Stunde
    # (damit der Verlauf reproduzierbar, aber „zufällig“ wirkt)
    day_of_month = ts.day
    ev_peak = 0.0
    if 18 <= hour <= 23:
        # ca. jeder zweite Tag stärkerer EV-Anteil
        if (day_of_month % 2) == 0:
            ev_peak = 6.0 * math.exp(-0.5 * ((hour - 20.0) / 1.0) ** 2)
        else:
            ev_peak = 3.0 * math.exp(-0.5 * ((hour - 20.5) / 1.2) ** 2)

    # Summe aller Beiträge
    value = base_load * weekend_factor
    value += morning_peak
    value += midday_peak
    value += evening_peak
    value += ev_peak
    value += pv_relief  # Entlastung durch PV (negativ)

    # leichte Zufallsschwankung
    value += random.uniform(-0.5, 0.5)

    # Clip auf sinnvolle Grenzen: nie negativ, nicht völlig absurd hoch
    value = max(0.0, min(value, 40.0))
    return value

# Dispatcher: wähle je nach Seriennamen den passenden Generator
def generate_value(series: str, ts: datetime.datetime) -> float:
    if series == "meter1:load_kw":
        return gen_sinusload_kw(ts)
    elif series == "residential1:load_kw":
        return gen_residential_kw(ts)
    else:
        # Fallback: einfache Konstante, falls irgendwann eine neue Serie
        return 1.0

def main():
    now = datetime.datetime.now(datetime.timezone.utc)
    now = round_to_full_hour(now)

    conn = psycopg2.connect(PG_CONN_STR)
    cur = conn.cursor()

    # Letzten Timestamp je Serie bestimmen
    last_ts = {}

    for series in SERIES:
        cur.execute(
            "SELECT MAX(ts) FROM measurements WHERE series = %s",
            (series,),
        )
        row = cur.fetchone()
        if row and row[0]:
            # start ts = letzte Stunde + 1 Stunde
            last_ts[series] = row[0]
        else:
            # falls noch keine Daten: BACKFILL_DAYS zurück
            last_ts[series] = now - datetime.timedelta(days=DEFAULT_BACKFILL_DAYS)

    rows_inserted = 0

    for series in SERIES:
        ts = round_to_full_hour(last_ts[series])

        # wir wollen ab der nächsten vollen Stunde nach last_ts einsteigen
        if ts < now:
            ts = ts + datetime.timedelta(hours=1)

        while ts <= now:
            value = generate_value(series, ts)

            cur.execute(
                """
                INSERT INTO measurements (ts, series, value)
                VALUES (%s, %s, %s)
                ON CONFLICT DO NOTHING
                """,
                (ts, series, value),
            )

            rows_inserted += 1
            ts = ts + datetime.timedelta(hours=1)

    conn.commit()
    cur.close()
    conn.close()

    print(f"Inserted {rows_inserted} rows into measurements.")

if __name__ == "__main__":
    main()

