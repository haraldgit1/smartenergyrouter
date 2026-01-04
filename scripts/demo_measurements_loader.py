#!/usr/bin/env python3
import os
import datetime
import math
import random  # für leichte Zufallsschwankungen
import psycopg2

PG_CONN_STR = os.environ.get(
    "PG_CONN_STR",
    "postgres://postgres:postgres@localhost:5432/energy",
)


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


def main():
    # "now" = aktueller Zeitpunkt mit Sekunden/Millis
    now = datetime.datetime.now(datetime.timezone.utc)

    # Messzeitpunkt: eine Stunde zurück, auf volle Stunde gerundet
    ts = now.replace(minute=0, second=0, microsecond=0) - datetime.timedelta(
        hours=1
    )

    # generated_ts = echter Laufzeitpunkt (nicht gerundet)
    generated_ts = now

    conn = psycopg2.connect(PG_CONN_STR)
    cur = conn.cursor()

    # simple Demo-Lastkurven für meter1 / boiler1
    base_meter = 3.0 + 1.5 * math.sin(ts.hour / 24 * 2 * math.pi)
    base_boiler = 1.0 + 0.5 * math.cos(ts.hour / 24 * 2 * math.pi)

    # realistischere Wohnanlagen-Last für residential1
    residential_load = gen_residential_kw(ts)

    for series, value in [
        ("meter1:load_kw", base_meter),
        ("boiler1:load_kw", base_boiler),
        ("residential1:load_kw", residential_load),
    ]:
        # 1) aktuelle Messungen (bestehende Logik)
        cur.execute(
            """
            INSERT INTO measurements (ts, series, value)
            VALUES (%s, %s, %s)
            ON CONFLICT DO NOTHING;
            """,
            (ts, series, value),
        )

        # 2) History-Logging (append-only, Konflikte werden ignoriert)
        cur.execute(
            """
            INSERT INTO measurements_histo (ts, series, value, generated_ts)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT DO NOTHING;
            """,
            (ts, series, value, generated_ts),
        )

    conn.commit()
    cur.close()
    conn.close()


if __name__ == "__main__":
    main()

