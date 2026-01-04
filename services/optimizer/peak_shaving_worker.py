import json, os, time
import pika
from datetime import datetime, timezone

AMQP_URL = os.getenv("AMQP_URL", "amqp://admin:admin@rabbitmq:5672/%2f")
Q_CONS   = "constraints.in"
Q_MEAS   = "measures.in"
Q_FC     = "forecasts.out"
Q_SET    = "setpoints.out"

state = {
    "p_grid_max": None,
    "battery": {
        "p_chg_max_kw": 0.0,
        "p_dchg_max_kw": 0.0,
        "soc_min_pct": 0.0,
        "soc_max_pct": 100.0,
        "eff_rt": 1.0,
    },
    "soc_pct": None,
}

def jnow():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def pub_setpoint(ch, power_kw, until_ts):
    sp = {
        "ts": jnow(),
        "device": "battery1",
        "mode": "discharge",
        "power_kw": round(power_kw, 3),
        "until_ts": until_ts,
        "usecase": "peak_shaving",
        "plan_id": f"ps-{int(time.time())}",
    }
    print(f"[ps] SETPOINT {sp}", flush=True)
    ch.basic_publish(
        exchange="",
        routing_key=Q_SET,
        body=json.dumps(sp).encode(),
        properties=pika.BasicProperties(delivery_mode=2),
    )

def handle_constraints(body: bytes):
    payload = body.decode()
    obj = json.loads(payload)
    lim = obj.get("limits") or {}
    bat = obj.get("battery") or {}
    if "p_grid_max_kw" in lim:
        state["p_grid_max"] = float(lim["p_grid_max_kw"])
        print(f"[ps] p_grid_max = {state['p_grid_max']}", flush=True)
    state["battery"].update({
        "p_chg_max_kw": float(bat.get("p_chg_max_kw", state["battery"]["p_chg_max_kw"])),
        "p_dchg_max_kw": float(bat.get("p_dchg_max_kw", state["battery"]["p_dchg_max_kw"])),
        "soc_min_pct": float(bat.get("soc_min_pct", state["battery"]["soc_min_pct"])),
        "soc_max_pct": float(bat.get("soc_max_pct", state["battery"]["soc_max_pct"])),
        "eff_rt": float(bat.get("eff_rt", state["battery"]["eff_rt"])),
    })

def handle_measures(body: bytes):
    payload = body.decode()
    obj = json.loads(payload)
    if obj.get("series") == "battery1:soc_pct":
        state["soc_pct"] = float(obj["value"])
        print(f"[ps] soc = {state['soc_pct']}%", flush=True)

def handle_forecast(ch, body: bytes):
    payload = body.decode()
    obj = json.loads(payload)
    if obj.get("series") != "meter1:load_kw":
        # andere Forecasts (PV etc.) ignorieren
        return
    q50 = float(obj.get("q50", 0))
    tgt = obj.get("target_ts")
    pmax = state["p_grid_max"]
    soc  = state["soc_pct"]
    b    = state["battery"]

    print(f"[ps] forecast load={q50}kW target={tgt}", flush=True)

    if pmax is None or soc is None:
        print("[ps] missing p_grid_max or soc -> skip", flush=True)
        return
    if q50 <= pmax:
        print("[ps] no peak (<= p_grid_max) -> skip", flush=True)
        return

    gap = q50 - pmax
    soc_headroom = max(0.0, soc - b["soc_min_pct"]) / 100.0 * b["p_dchg_max_kw"]
    power = min(gap, b["p_dchg_max_kw"], soc_headroom)

    if power > 0.05:
        pub_setpoint(ch, power, tgt)
    else:
        print("[ps] power too small -> skip", flush=True)

def connect_channel():
    print(f"[ps] connect {AMQP_URL}", flush=True)
    return pika.BlockingConnection(pika.URLParameters(AMQP_URL)).channel()

def run():
    while True:
        try:
            ch = connect_channel()
            for q in [Q_CONS, Q_MEAS, Q_FC, Q_SET]:
                ch.queue_declare(queue=q, durable=True)
            ch.basic_qos(prefetch_count=16)

            def on_constraints(ch_, method, props, body):
                try:
                    handle_constraints(body)
                    ch_.basic_ack(method.delivery_tag)
                except Exception as e:
                    print("[ps] error constraints:", e, flush=True)
                    ch_.basic_nack(method.delivery_tag, requeue=False)

            def on_measures(ch_, method, props, body):
                try:
                    handle_measures(body)
                    ch_.basic_ack(method.delivery_tag)
                except Exception as e:
                    print("[ps] error measures:", e, flush=True)
                    ch_.basic_nack(method.delivery_tag, requeue=False)

            def on_forecasts(ch_, method, props, body):
                try:
                    handle_forecast(ch_, body)
                    ch_.basic_ack(method.delivery_tag)
                except Exception as e:
                    print("[ps] error forecast:", e, flush=True)
                    ch_.basic_nack(method.delivery_tag, requeue=False)

            ch.basic_consume(queue=Q_CONS, on_message_callback=on_constraints, auto_ack=False)
            ch.basic_consume(queue=Q_MEAS, on_message_callback=on_measures, auto_ack=False)
            ch.basic_consume(queue=Q_FC,   on_message_callback=on_forecasts, auto_ack=False)

            print("[ps] worker started (consuming)", flush=True)
            ch.start_consuming()
        except Exception as e:
            print("[ps] reconnect in 3s:", e, flush=True)
            time.sleep(3)

if __name__ == "__main__":
    run()
