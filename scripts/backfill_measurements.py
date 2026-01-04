#!/usr/bin/env python3
import os
import math
import datetime
import psycopg2

PG_CONN_STR = os.environ.get(
    "PG_CONN_STR",
    "postgres://postgres:postgres@localhost:5432/energy",
)

# Serien, die befüllt werden sollen
SERIES = ["meter1:load_kw", "boiler1:load_kw"]


def utc_now_floor_hour() -> datetime.datetime:
    """Aktuelle Zeit in UTC, auf volle Stunde gerundet."""
    return datetime.datetime.now(datetime.timezone.utc).replace(
        minute=0, second=0, microsecond=0
    )


def main():
    now = utc_now_floor_hour()

    conn = psycopg2.connect(PG_CONN_STR)
    cur = conn.cursor()

    # Frühesten Timestamp über alle Serien holen
    cur.execute(
        """
        SELECT MIN(ts) 
        FROM measurements 
        WHERE series = ANY(%s);
        """,
        (SERIES,),
    )
    row = cur.fetchone()
    global_min_ts = row[0]

    # Ziel-Ende: bis eine Stunde vor "jetzt"
    target_end = now - datetime.timedelta(hours=1)

    if global_min_ts is None:
        # Falls noch keine Daten da sind: 7 Tage vor target_end starten
        start_ts = target_end - datetime.timedelta(days=7)
        print(
            "Keine bestehenden Messwerte gefunden. "
            "Starte Backfill 7 Tage vor target_end."
        )
    else:
        # Ab frühestem bekannten Timestamp weiter auffüllen
        start_ts = global_min_ts

    # Auf volle Stunde runden (UTC)
    start_ts = start_ts.astimezone(datetime.timezone.utc).replace(
        minute=0, second=0, microsecond=0
    )

    print("Backfill Start:", start_ts.isoformat())
    print("Backfill Ende :", target_end.isoformat())

    ts = start_ts
    inserted_rows = 0

    while ts <= target_end:
        hour = ts.hour

        # Demo-Profile für die beiden Serien
        values_by_series = {}

        if "meter1:load_kw" in SERIES:
            meter_val = 3.0 + 1.5 * math.sin(hour / 24 * 2 * math.pi)
            values_by_series["meter1:load_kw"] = meter_val

        if "boiler1:load_kw" in SERIES:
            boiler_val = 1.0 + 0.5 * math.cos(hour / 24 * 2 * math.pi)
            values_by_series["boiler1:load_kw"] = boiler_val

        for series, value in values_by_series.items():
            cur.execute(
                """
                INSERT INTO measurements (ts, series, value)
                VALUES (%s, %s, %s)
                ON CONFLICT DO NOTHING;
                """,
                (ts, series, value),
            )
            inserted_rows += 1

        # Optional: alle 24 Stunden einen Fortschritts-Log
        if ts.hour == 0:
            print("  Fortschritt:", ts.isoformat())

        ts += datetime.timedelta(hours=1)

    conn.commit()
    cur.close()
    conn.close()

    print("Backfill fertig. Versuchte Inserts:", inserted_rows)


if __name__ == "__main__":
    main()

