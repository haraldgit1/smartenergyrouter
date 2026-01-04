import os
import json
import asyncio
import contextlib
from typing import Any, Dict
import orjson
import aio_pika
import asyncpg
from fastapi import FastAPI
from app.mdm_devices import router as mdm_devices_router

from pydantic import BaseModel
from datetime import datetime

APP = "router_agent"
app = FastAPI(title=APP)

@app.get("/mdm/test")
async def mdm_test():
    return {"status": "ok", "app": APP}

# mdm
# ---
app.include_router(mdm_devices_router)


class ActuatorCommand(BaseModel):
    mode: str | None = None
    power_kw: float | None = None
    until_ts: str | None = None

@app.post("/actuator/{device_id}")
def actuator(device_id: str, cmd: ActuatorCommand):
    # TODO: Hier später echte Ansteuerungslogik einbauen
    print(
        f"[router_agent] CMD device={device_id} "
        f"mode={cmd.mode} power_kw={cmd.power_kw} until={cmd.until_ts}",
        flush=True,
    )
    # Optional: Persistenz / Metrics
    return {
        "device": device_id,
        "accepted_at": datetime.utcnow().isoformat() + "Z",
        "mode": cmd.mode,
        "power_kw": cmd.power_kw,
        "until_ts": cmd.until_ts,
    } 

# MQ
RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://admin:admin@rabbitmq:5672/")
QUEUE_IN = os.getenv("QUEUE_IN", "decisions.out")

# DB
PGHOST = os.getenv("PGHOST", "timescaledb")
PGPORT = int(os.getenv("PGPORT", "5432"))
PGUSER = os.getenv("PGUSER", "postgres")
PGPASSWORD = os.getenv("PGPASSWORD", "postgres")
PGDATABASE = os.getenv("PGDATABASE", "energy")

@app.get("/health")
def health():
    return {"status": "ok", "service": APP}

@app.get("/ready")
def ready():
    return {
        "status": "ready",
        "service": APP,
        "mq": bool(getattr(app.state, "amqp_channel", None)),
        "db": bool(getattr(app.state, "pg", None)),
    }

CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS router_actions (
  id           BIGSERIAL PRIMARY KEY,
  received_at  TIMESTAMPTZ DEFAULT now(),
  target_ts    TIMESTAMPTZ,
  series       TEXT,
  setpoint_kw  DOUBLE PRECISION,
  policy       TEXT,
  source       TEXT,
  raw          JSONB
);
"""
CREATE_HYPERTABLE_SQL = """
SELECT create_hypertable('router_actions', 'target_ts', if_not_exists => TRUE);
"""

INSERT_SQL = """
INSERT INTO router_actions (target_ts, series, setpoint_kw, policy, source, raw)
VALUES (to_timestamp($1, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), $2, $3, $4, $5, $6::jsonb);
"""

async def init_db() -> asyncpg.Pool:
    dsn = f"postgres://{PGUSER}:{PGPASSWORD}@{PGHOST}:{PGPORT}/{PGDATABASE}"
    pool = await asyncpg.create_pool(dsn)
    async with pool.acquire() as conn:
        await conn.execute(CREATE_TABLE_SQL)
        with contextlib.suppress(Exception):
            await conn.execute(CREATE_HYPERTABLE_SQL)
    print(f"[{APP}] DB ready @ {PGHOST}:{PGPORT}/{PGDATABASE}")
    return pool

async def init_amqp():
    print(f"[{APP}] Connecting to RabbitMQ: {RABBITMQ_URL}")
    connection = await aio_pika.connect_robust(RABBITMQ_URL)
    channel = await connection.channel()
    await channel.set_qos(prefetch_count=32)
    await channel.declare_queue(QUEUE_IN, durable=True)

    app.state.amqp_conn = connection
    app.state.amqp_channel = channel
    print(f"[{APP}] AMQP ready. Consuming '{QUEUE_IN}'")
    return connection

def _f(x):
    try:
        return float(x) if x is not None else None
    except Exception:
        return None

async def handle_message(msg: aio_pika.IncomingMessage):
    async with msg.process(ignore_processed=True, requeue=True):
        try:
            payload = orjson.loads(msg.body)
            target_ts  = payload.get("target_ts")
            series     = payload.get("series")
            setpoint   = _f(payload.get("setpoint_kw"))
            policy     = payload.get("policy", "unknown")
            source     = payload.get("source", "unknown")

            print(f"[{APP}] IN  series={series} target={target_ts} setpoint={setpoint} policy={policy}")

            # (A) Hier würdest du echte Aktorik ansteuern (Modbus, REST, MQTT, …)
            # TODO: implement_actuator(series, setpoint)

            # (B) Logging/Persistenz
            pg: asyncpg.Pool = app.state.pg
            async with pg.acquire() as conn:
                await conn.execute(
                    INSERT_SQL,
                    target_ts,
                    series,
                    setpoint,
                    policy,
                    source,
                    json.dumps(payload),
                )

            # ACK via context manager
        except Exception as e:
            print(f"[{APP}] ERROR handling message: {e}")
            raise  # nack + requeue

async def amqp_consumer():
    channel: aio_pika.Channel = app.state.amqp_channel
    queue = await channel.declare_queue(QUEUE_IN, durable=True)
    await queue.consume(handle_message, no_ack=False)
    print(f"[{APP}] Started consuming from '{QUEUE_IN}'")
    try:
        while True:
            await asyncio.sleep(3600)
    finally:
        print(f"[{APP}] Consumer loop ending")

@app.on_event("startup")
async def on_startup():
    print(f"[{APP}] Startup – init DB & AMQP")
    app.state.pg = await init_db()
    await init_amqp()
    app.state.consumer_task = asyncio.create_task(amqp_consumer())

@app.on_event("shutdown")
async def on_shutdown():
    print(f"[{APP}] Shutdown – stopping tasks & closing resources")
    task = getattr(app.state, "consumer_task", None)
    if task:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
    conn = getattr(app.state, "amqp_conn", None)
    if conn:
        with contextlib.suppress(Exception):
            await conn.close()
    pg = getattr(app.state, "pg", None)
    if pg:
        with contextlib.suppress(Exception):
            await pg.close()
    print(f"[{APP}] Shutdown complete.")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000)

