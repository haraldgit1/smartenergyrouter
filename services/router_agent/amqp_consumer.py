import json, os, time
import pika, requests

AMQP_URL = os.getenv("AMQP_URL", "amqp://admin:admin@rabbitmq:5672/%2f")
QUEUE    = os.getenv("AMQP_QUEUE", "setpoints.out")
ROUTER   = os.getenv("ROUTER_BASE", "http://localhost:8000")

def connect():
    print(f"[amqp] connect {AMQP_URL}", flush=True)
    return pika.BlockingConnection(pika.URLParameters(AMQP_URL)).channel()

def handle_setpoint(msg):
    sp = json.loads(msg)
    device = sp.get("device")
    mode   = sp.get("mode")
    power  = sp.get("power_kw")
    until  = sp.get("until_ts")
    print(f"[setpoint] -> device={device} mode={mode} power={power} until={until}", flush=True)
    r = requests.post(f"{ROUTER}/actuator/{device}",
                      json={"mode": mode, "power_kw": power, "until_ts": until},
                      timeout=5)
    print(f"[router] POST {r.request.url} {r.status_code}", flush=True)
    r.raise_for_status()

def main():
    while True:
        try:
            ch = connect()
            ch.queue_declare(queue=QUEUE, durable=True)
            print(f"[amqp] consuming queue={QUEUE}", flush=True)
            for method, props, body in ch.consume(QUEUE, inactivity_timeout=5, auto_ack=False):
                if not method:
                    continue
                try:
                    handle_setpoint(body.decode())
                    ch.basic_ack(method.delivery_tag)
                except Exception as e:
                    print("[error] handling setpoint:", e, flush=True)
                    ch.basic_nack(method.delivery_tag, requeue=False)
        except Exception as e:
            print("[amqp] reconnect in 3s:", e, flush=True)
            time.sleep(3)

if __name__ == "__main__":
    print(f"[boot] ROUTER_BASE={ROUTER} QUEUE={QUEUE}", flush=True)
    # Warmup: Health-Check (optional)
    try:
        hr = requests.get(f"{ROUTER}/health", timeout=2)
        print(f"[health] {hr.status_code} {hr.text[:120]}", flush=True)
    except Exception as e:
        print("[health] failed:", e, flush=True)
    main()
