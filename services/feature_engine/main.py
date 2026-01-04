from fastapi import FastAPI
import os, json, threading
import pika, psycopg

AMQP_URL = os.getenv("AMQP_URL", "amqp://admin:admin@rabbitmq:5672")
PG_CONN = os.getenv("PG_CONN", "postgres://postgres:postgres@timescaledb:5432/energy")

app = FastAPI(title="feature_engine")
stop_flag = False

def _pg():
    return psycopg.connect(PG_CONN, autocommit=True)

def _amqp():
    params = pika.URLParameters(AMQP_URL)
    conn = pika.BlockingConnection(params)
    ch = conn.channel()
    ch.exchange_declare(exchange="amq.topic", exchange_type="topic", durable=True)
    q = ch.queue_declare(queue="", exclusive=True).method.queue
    ch.queue_bind(queue=q, exchange="amq.topic", routing_key="telemetry.in")
    return conn, ch, q

def worker():
    conn, ch, q = _amqp()
    with _pg() as pg:
        cur = pg.cursor()
        for method, props, body in ch.consume(q, inactivity_timeout=2):
            if stop_flag: break
            if body is None: continue
            msg = json.loads(body.decode("utf-8"))
            # 1) Rohdaten speichern
            cur.execute("""
                INSERT INTO telemetry_raw(ts,source,key,value)
                VALUES (%s,%s,%s,%s)
                ON CONFLICT DO NOTHING
            """, (msg["ts"], msg["source"], msg["key"], msg.get("value")))
            # 2) Dummy-Features bilden
            feats = {"v": msg.get("value"), "hour": int(msg["ts"][11:13])}
            cur.execute("""
                INSERT INTO features(ts,series,feats)
                VALUES (%s,%s,%s)
                ON CONFLICT DO NOTHING
            """, (msg["ts"], f'{msg["source"]}:{msg["key"]}', json.dumps(feats)))
            # 3) Weiterleiten
            out = {"ts": msg["ts"], "series": f'{msg["source"]}:{msg["key"]}', "feats": feats}
            ch.basic_publish(exchange="amq.topic", routing_key="features.out",
                             body=json.dumps(out).encode("utf-8"),
                             properties=pika.BasicProperties(content_type="application/json"))
            ch.basic_ack(method.delivery_tag)
    try: conn.close()
    except: pass

@app.on_event("startup")
def on_start():
    global stop_flag
    stop_flag = False
    threading.Thread(target=worker, daemon=True).start()

@app.on_event("shutdown")
def on_stop():
    global stop_flag
    stop_flag = True

@app.get("/health")
def health():
    return {"status":"ok","service":"feature_engine"}
