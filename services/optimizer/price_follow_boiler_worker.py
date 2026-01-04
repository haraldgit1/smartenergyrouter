import json, os, time
from datetime import datetime, timezone, timedelta
import pika

AMQP_URL = os.getenv("AMQP_URL", "amqp://admin:admin@rabbitmq:5672/%2f")
Q_CONS   = "constraints.in"
Q_TAR    = "tariffs.in"
Q_SCH    = "schedules.out"
Q_SET    = "setpoints.out"

# In-Memory-State
state = {
    "tariffs": {},   # ts_iso -> price
    "devices": {},   # device_id -> config
}

def jnow():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def parse_ts(ts_str: str) -> datetime:
    # erwartet ISO-8601 mit 'Z'
    return datetime.fromisoformat(ts_str.replace("Z", "+00:00"))

def format_ts(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def connect_channel():
    print(f"[pfb] connect {AMQP_URL}", flush=True)
    return pika.BlockingConnection(pika.URLParameters(AMQP_URL)).channel()

def publish_schedule(ch, device_id, start_dt, end_dt, power_kw):
    sched = {
        "ts": jnow(),
        "device": device_id,
        "window": [[format_ts(start_dt), format_ts(end_dt)]],
        "power_kw": round(power_kw, 3),
        "usecase": "price_follow_boiler",
        "plan_id": f"pfb-{int(time.time())}",
    }
    print(f"[pfb] SCHEDULE {sched}", flush=True)
    ch.basic_publish(
        exchange="",
        routing_key=Q_SCH,
        body=json.dumps(sched).encode(),
        properties=pika.BasicProperties(delivery_mode=2),
    )

def publish_setpoint_if_now(ch, device_id, start_dt, end_dt, power_kw):
    now = datetime.now(timezone.utc)
    if not (start_dt <= now <= end_dt):
        print("[pfb] now not in schedule window -> no immediate setpoint", flush=True)
        return
    sp = {
        "ts": jnow(),
        "device": device_id,
        "mode": "heat",
        "power_kw": round(power_kw, 3),
        "until_ts": format_ts(end_dt),
        "usecase": "price_follow_boiler",
        "plan_id": f"pfb-{int(time.time())}",
    }
    print(f"[pfb] SETPOINT {sp}", flush=True)
    ch.basic_publish(
        exchange="",
        routing_key=Q_SET,
        body=json.dumps(sp).encode(),
        properties=pika.BasicProperties(delivery_mode=2),
    )

def recompute_schedules(ch):
    """Einfacher Heuristik-Scheduler: wählt die billigsten Stunden."""
    if not state["devices"] or not state["tariffs"]:
        print("[pfb] missing devices or tariffs -> skip recompute", flush=True)
        return

    # Für dieses MVP: nur einen Boiler (boiler1) betrachten
    for device_id, cfg in state["devices"].items():
        duration_min = float(cfg.get("duration_min", 0))
        if duration_min <= 0:
            continue
        earliest_start = parse_ts(cfg["earliest_start"])
        latest_end     = parse_ts(cfg["latest_end"])
        power_kw       = float(cfg.get("power_kw", 0))
        if power_kw <= 0:
            continue

        slot_minutes = 60  # Annahme: Tarif-Slots = 60 Minuten
        slots_needed = int(duration_min / slot_minutes)
        if slots_needed <= 0:
            print(f"[pfb] duration_min too small for {device_id}", flush=True)
            continue

        # Alle verfügbaren Tarif-Slots im Fenster sammeln
        slots = []
        for ts_str, price in state["tariffs"].items():
            ts = parse_ts(ts_str)
            # Slot beginnt innerhalb des Fensters, und der Endzeitpunkt darf latest_end nicht überschreiten
            slot_end = ts + timedelta(minutes=slot_minutes)
            if ts >= earliest_start and slot_end <= latest_end:
                slots.append((ts, float(price)))
        if len(slots) < slots_needed:
            print(f"[pfb] not enough tariff slots in window for {device_id}", flush=True)
            continue

        # Slots nach Zeit sortieren
        slots.sort(key=lambda x: x[0])

        # Sliding-Window über Slots, um billigsten Block zu finden
        best_cost = None
        best_start = None
        for i in range(0, len(slots) - slots_needed + 1):
            window_slots = slots[i:i+slots_needed]
            # prüfen, ob Slots zusammenhängend sind (jeweils 60 min auseinander)
            contiguous = True
            for (t1,_), (t2,_) in zip(window_slots, window_slots[1:]):
                if (t2 - t1) != timedelta(minutes=slot_minutes):
                    contiguous = False
                    break
            if not contiguous:
                continue
            cost = sum(p for _, p in window_slots)
            if best_cost is None or cost < best_cost:
                best_cost = cost
                best_start = window_slots[0][0]

        if best_start is None:
            print(f"[pfb] no contiguous slot window for {device_id}", flush=True)
            continue

        start_dt = best_start
        end_dt   = best_start + timedelta(minutes=duration_min)
        print(f"[pfb] best window for {device_id}: {format_ts(start_dt)} - {format_ts(end_dt)} cost={best_cost}", flush=True)

        publish_schedule(ch, device_id, start_dt, end_dt, power_kw)
        publish_setpoint_if_now(ch, device_id, start_dt, end_dt, power_kw)

def handle_constraints(body: bytes, ch):
    obj = json.loads(body.decode())
    devices = obj.get("devices") or []
    changed = False
    for dev in devices:
        device_id = dev.get("id")
        if not device_id:
            continue
        if dev.get("shiftable") and dev.get("type") == "heater":
            # erwarten: duration_min, earliest_start, latest_end, power_kw
            state["devices"][device_id] = {
                "duration_min": dev.get("duration_min"),
                "earliest_start": dev.get("earliest_start"),
                "latest_end": dev.get("latest_end"),
                "power_kw": dev.get("power_kw"),
            }
            changed = True
            print(f"[pfb] device config updated: {device_id} -> {state['devices'][device_id]}", flush=True)
    if changed:
        recompute_schedules(ch)

def handle_tariff(body: bytes, ch):
    obj = json.loads(body.decode())
    ts = obj.get("target_ts")
    price = obj.get("value")
    if ts is None or price is None:
        return
    state["tariffs"][ts] = float(price)
    # optional: nicht unendlich anwachsen lassen
    if len(state["tariffs"]) > 1000:
        # simple trim: älteste raus
        for key in sorted(state["tariffs"].keys())[:-500]:
            state["tariffs"].pop(key, None)
    # nach jedem neuen Tarif kann sich die beste Lösung ändern
    print(f"[pfb] tariff updated: {ts} -> {price}", flush=True)
    recompute_schedules(ch)

def run():
    while True:
        try:
            ch = connect_channel()
            for q in [Q_CONS, Q_TAR, Q_SCH, Q_SET]:
                ch.queue_declare(queue=q, durable=True)
            ch.basic_qos(prefetch_count=16)

            def on_constraints(ch_, method, props, body):
                try:
                    handle_constraints(body, ch_)
                    ch_.basic_ack(method.delivery_tag)
                except Exception as e:
                    print("[pfb] error constraints:", e, flush=True)
                    ch_.basic_nack(method.delivery_tag, requeue=False)

            def on_tariffs(ch_, method, props, body):
                try:
                    handle_tariff(body, ch_)
                    ch_.basic_ack(method.delivery_tag)
                except Exception as e:
                    print("[pfb] error tariffs:", e, flush=True)
                    ch_.basic_nack(method.delivery_tag, requeue=False)

            ch.basic_consume(queue=Q_CONS, on_message_callback=on_constraints, auto_ack=False)
            ch.basic_consume(queue=Q_TAR,  on_message_callback=on_tariffs,    auto_ack=False)

            print("[pfb] worker started (consuming)", flush=True)
            ch.start_consuming()
        except Exception as e:
            print("[pfb] reconnect in 3s:", e, flush=True)
            time.sleep(3)

if __name__ == "__main__":
    run()
