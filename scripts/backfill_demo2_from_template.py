#!/usr/bin/env python3
import os
import datetime
import psycopg2

# ------------------------------------------------------------
# DB-Verbindung
# ------------------------------------------------------------
PG_CONN_STR = os.environ.get("PG_CONN_STR")
if not PG_CONN_STR:
    PG_CONN_STR = "postgres://postgres:postgres@localhost:5432/energy"

# ------------------------------------------------------------
# PARAMETER – HIER ANPASSEN
# ------------------------------------------------------------

# Serienname für Demo 2
SERIES = "residential1:load_kw" #"demo2:load_kw"   # <-- ANPASSEN falls nötig

# Template-Tag (UTC)
TEMPLATE_DAY = datetime.date(2025, 12, 3)   # <-- Tag mit IST-Werten!

# Fehlender Zeitraum
START_FILL = datetime.datetime(2025, 12, 6, 0, 0, tzinfo=datetime.timezone.utc)
END_FILL   = datetime.datetime(2025, 12, 15, 0, 0, tzinfo=datetime.timezone.utc)

# ------------------------------------------------------------
# BACKFILL-LOGIK
# ------------------------------------------------------------

def main():
    conn = psycopg2.connect(PG_CONN_STR)
    cur = conn.cursor()

    print(f"Starte Backfill für Serie '{SERIES}'")
    print(f"Fehlender Zeitraum: {START_FILL} bis {END_FILL}")

    # Template-Fenster bauen
    template_start = datetime.datetime(
        TEMPLATE_DAY.year,
        TEMPLATE_DAY.month,
        TEMPLATE_DAY.day,
        0, 0, 0,
        tzinfo=datetime.timezone.utc,
    )
    template_end = template_start + datetime.timedelta(days=1)

    print(f"Verwende Referenz-Tag: {template_start} bis {template_end}")

    # Template-Daten laden
    cur.execute(
        """
        SELECT ts, value
        FROM measurements
        WHERE series = %s
          AND ts >= %s
          AND ts <  %s
        ORDER BY ts
        """,
        (SERIES, template_start, template_end),
    )
    template_rows = cur.fetchall()

    if not template_rows:
        print("FEHLER: Keine Referenzdaten für diesen Tag gefunden.")
        print("Bitte TEMPLATE_DAY korrekt setzen!")
        return

    print(f"Template-Zeilen gefunden: {len(template_rows)}")

    total_days = (END_FILL - START_FILL).days
    if total_days <= 0:
        print("Nichts zu füllen (END_FILL <= START_FILL)")
        return

    inserted = 0

    # --------------------------------------------------------
    # Hauptschleife: jeden fehlenden Tag befüllen
    # --------------------------------------------------------
    for day_offset in range(total_days):
        current_day = START_FILL.date() + datetime.timedelta(days=day_offset)

        target_start = datetime.datetime(
            current_day.year,
            current_day.month,
            current_day.day,
            0, 0, 0,
            tzinfo=datetime.timezone.utc,
        )

        print(f"Fülle Tag: {current_day}")

        for ts, value in template_rows:
            delta = ts - template_start
            new_ts = target_start + delta

            if not (START_FILL <= new_ts < END_FILL):
                continue

            cur.execute(
                """
                INSERT INTO measurements (ts, series, value)
                VALUES (%s, %s, %s)
                ON CONFLICT (ts, series) DO NOTHING
                """,
                (new_ts, SERIES, value),
            )
            inserted += cur.rowcount

        conn.commit()

    print(f"Backfill abgeschlossen. Eingefügt: {inserted} Zeilen")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()

