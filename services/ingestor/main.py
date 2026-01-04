from fastapi import FastAPI
from pydantic import BaseModel
import os, json
import pika
from datetime import datetime, timezone

AMQP_URL = os.getenv("AMQP_URL", "amqp://admin:admin@rabbitmq:5672")
app = FastAPI(title="ingestor")

def _channel():
    params = pika.URLParameters(AMQP_URL)
    conn = pika.BlockingConnection(params)
    ch = conn.channel()
    ch.exchange_declare(exchange="amq.topic", exchange_type="topic", durable=True)
    return conn, ch

@app.get("/health")
def health():
    return {"status":"ok","service":"ingestor"}

class Demo(BaseModel):
    source: str = "meter1"
    key: str = "load_kw"
    value: float = 1.23

@app.post("/inject/demo")
def inject_demo(d: Demo):
    payload = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "source": d.source, "key": d.key, "value": d.value
    }
    conn, ch = _channel()
    try:
        ch.basic_publish(exchange="amq.topic", routing_key="telemetry.in",
                         body=json.dumps(payload).encode("utf-8"),
                         properties=pika.BasicProperties(content_type="application/json"))
        return {"ok": True, "sent": payload}
    finally:
        conn.close()
