import os
import json
import asyncio
import contextlib
from typing import Any, Dict, List

import orjson
import aio_pika
import asyncpg
import requests
from fastapi import FastAPI
from pydantic import BaseModel

from fastapi.responses import HTMLResponse


# ------------
# info-Def
# ------------

class QueueInfo(BaseModel):
    name: str
    consumers: int
    messages_ready: int

class ScheduleInfo(BaseModel):
    device: str
    window: list
    power_kw: float
    usecase: str
    plan_id: str
    raw_payload: dict

class SetpointInfo(BaseModel):
    device: str
    mode: str
    power_kw: float
    until_ts: str
    usecase: str
    plan_id: str
    raw_payload: dict



RMQ_API_URL  = os.getenv("RMQ_API_URL", "http://rabbitmq:15672/api")
RMQ_USER     = os.getenv("RABBITMQ_USER", "admin")
RMQ_PASSWORD = os.getenv("RABBITMQ_PASS", "admin")



# ──────────────────────────────────────────────────────────────────────────────
# App / Config
# ──────────────────────────────────────────────────────────────────────────────
APP = "optimizer"
app = FastAPI(title=APP)

# RabbitMQ
RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://admin:admin@rabbitmq:5672/")
QUEUE_IN = os.getenv("QUEUE_IN", "forecasts.out")
QUEUE_OUT = os.getenv("QUEUE_OUT", "decisions.out")

# Postgres/TimescaleDB
PGHOST = os.getenv("PGHOST", "timescaledb")
PGPORT = int(os.getenv("PGPORT", "5432"))
PGUSER = os.getenv("PGUSER", "postgres")
PGPASSWORD = os.getenv("PGPASSWORD", "postgres")
PGDATABASE = os.getenv("PGDATABASE", "energy")


# ------------
# info-Endpoint
# ------------
@app.get("/info/queues", response_model=List[QueueInfo])
def info_queues():
    """Liest Queue-Infos aus RabbitMQ-HTTP-API."""
    url = f"{RMQ_API_URL}/queues/%2f"
    r = requests.get(url, auth=(RMQ_USER, RMQ_PASSWORD), timeout=5)
    r.raise_for_status()
    data = r.json()
    result = []
    for q in data:
        result.append(
            QueueInfo(
                name=q.get("name"),
                consumers=q.get("consumers", 0),
                messages_ready=q.get("messages_ready", 0),
            )
        )
    return result


@app.get("/info/schedules", response_model=List[ScheduleInfo])
def info_schedules(limit: int = 10):
    """Letzte Schedules aus schedules.out lesen (Debug)."""
    url = f"{RMQ_API_URL}/queues/%2f/schedules.out/get"
    body = {
        "count": limit,
        "ackmode": "ack_requeue_false",
        "encoding": "auto",
        "truncate": 50000,
    }
    r = requests.post(url, json=body, auth=(RMQ_USER, RMQ_PASSWORD), timeout=5)
    r.raise_for_status()
    msgs = r.json()
    result: List[ScheduleInfo] = []
    for msg in msgs:
        payload_raw = msg.get("payload")
        try:
            payload = (
                payload_raw
                if isinstance(payload_raw, dict)
                else json.loads(payload_raw)
            )
        except Exception:
            payload = {"_raw": payload_raw}
        result.append(
            ScheduleInfo(
                device=payload.get("device", ""),
                window=payload.get("window", []),
                power_kw=float(payload.get("power_kw", 0.0)),
                usecase=payload.get("usecase", ""),
                plan_id=payload.get("plan_id", ""),
                raw_payload=payload,
            )
        )
    return result

@app.get("/info/setpoints", response_model=List[SetpointInfo])
def info_setpoints(limit: int = 10):
    url = f"{RMQ_API_URL}/queues/%2f/setpoints.out/get"
    body = {
        "count": limit,
        "ackmode": "ack_requeue_false",
        "encoding": "auto",
        "truncate": 50000,
    }
    r = requests.post(url, json=body, auth=(RMQ_USER, RMQ_PASSWORD), timeout=5)
    r.raise_for_status()
    msgs = r.json()
    result: List[SetpointInfo] = []
    for msg in msgs:
        payload_raw = msg.get("payload")
        try:
            payload = (
                payload_raw
                if isinstance(payload_raw, dict)
                else json.loads(payload_raw)
            )
        except Exception:
            payload = {"_raw": payload_raw}
        result.append(
            SetpointInfo(
                device=payload.get("device", ""),
                mode=payload.get("mode", ""),
                power_kw=float(payload.get("power_kw", 0.0)),
                until_ts=payload.get("until_ts", ""),
                usecase=payload.get("usecase", ""),
                plan_id=payload.get("plan_id", ""),
                raw_payload=payload,
            )
        )
    return result

# ──────────────────────────────────────────────────────────────────────────────
# Health / Ready
# ──────────────────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "service": APP}

@app.get("/ready")
def ready():
    # optional: Checks an MQ/DB hängen
    ready_flags = {
        "mq": bool(getattr(app.state, "amqp_channel", None)),
        "db": bool(getattr(app.state, "pg", None)),
    }
    return {"status": "ready", "service": APP, **ready_flags}

# ──────────────────────────────────────────────────────────────────────────────
# DB Setup
# ──────────────────────────────────────────────────────────────────────────────
CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS optimizer_input (
  id           BIGSERIAL PRIMARY KEY,
  ts           TIMESTAMPTZ,
  target_ts    TIMESTAMPTZ,
  series       TEXT,
  q50          DOUBLE PRECISION,
  backend      TEXT,
  raw          JSONB
);
"""

# Optional: Hypertable in Timescale
CREATE_HYPERTABLE_SQL = """
SELECT create_hypertable('optimizer_input', 'target_ts', if_not_exists => TRUE);
"""

INSERT_SQL = """
INSERT INTO optimizer_input (ts, target_ts, series, q50, backend, raw)
VALUES (to_timestamp($1, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        to_timestamp($2, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        $3, $4, $5, $6::jsonb);
"""

async def init_db() -> asyncpg.Pool:
    dsn = f"postgres://{PGUSER}:{PGPASSWORD}@{PGHOST}:{PGPORT}/{PGDATABASE}"
    pool = await asyncpg.create_pool(dsn)
    async with pool.acquire() as conn:
        await conn.execute(CREATE_TABLE_SQL)
        # Hypertable nur auf TimescaleDB verfügbar – wird ignoriert, falls nicht installiert
        with contextlib.suppress(Exception):
            await conn.execute(CREATE_HYPERTABLE_SQL)
    print(f"[{APP}] DB ready @ {PGHOST}:{PGPORT}/{PGDATABASE}")
    return pool

# ──────────────────────────────────────────────────────────────────────────────
# MQ Setup / Publish
# ──────────────────────────────────────────────────────────────────────────────
async def init_amqp() -> aio_pika.RobustConnection:
    print(f"[{APP}] Connecting to RabbitMQ: {RABBITMQ_URL}")
    connection = await aio_pika.connect_robust(RABBITMQ_URL)
    channel = await connection.channel()
    await channel.set_qos(prefetch_count=16)

    # Eingangsqueue (idempotent)
    await channel.declare_queue(
        QUEUE_IN,
        durable=True,
    )
    # Ausgangsqueue für Entscheidungen (idempotent)
    await channel.declare_queue(
        QUEUE_OUT,
        durable=True,
    )

    app.state.amqp_conn = connection
    app.state.amqp_channel = channel
    print(f"[{APP}] AMQP ready. Consuming '{QUEUE_IN}', publishing to '{QUEUE_OUT}'")
    return connection

async def publish_decision(message: Dict[str, Any]) -> None:
    channel: aio_pika.Channel = app.state.amqp_channel
    body = orjson.dumps(message)
    msg = aio_pika.Message(
        body=body,
        delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
        content_type="application/json",
    )
    # default exchange → routing_key = queue name
    await channel.default_exchange.publish(msg, routing_key=QUEUE_OUT)
    print(f"[{APP}] Published decision → {QUEUE_OUT}: {message}")

# ──────────────────────────────────────────────────────────────────────────────
# Message Handling
# ──────────────────────────────────────────────────────────────────────────────
def _coerce_float(x):
    try:
        return float(x) if x is not None else None
    except Exception:
        return None

async def handle_message(msg: aio_pika.IncomingMessage):
    # WICHTIG: requeue=False → bei Fehler geht's via DLX zur DLQ
    async with msg.process(ignore_processed=True, requeue=False):
        try:
            payload = orjson.loads(msg.body)

            ts        = payload.get("ts")          # optional
            target_ts = payload.get("target_ts")   # MUSS vorhanden sein
            series    = payload.get("series")      # MUSS vorhanden sein
            q50       = _coerce_float(payload.get("q50"))  # MUSS parsbar sein
            backend   = payload.get("backend", "unknown")

            # --- HARTE VALIDIERUNG: Vor jedem DB/Business-Schritt ---
            missing = []
            if not target_ts:
                missing.append("target_ts")
            if not series:
                missing.append("series")
            if q50 is None:
                missing.append("q50")

            if missing:
                raise ValueError(f"invalid payload (missing/invalid: {', '.join(missing)}), payload={payload}")

            print(f"[{APP}] IN  series={series} target={target_ts} q50={q50} backend={backend}")

            # 1) Persistiere Rohdaten (Timescale) – jetzt sicher, weil validiert
            pg: asyncpg.Pool = app.state.pg
            async with pg.acquire() as conn:
                await conn.execute(
                    INSERT_SQL,
                    ts or target_ts,     # fallback nur noch, wenn ts fehlt (aber target_ts existiert)
                    target_ts,
                    series,
                    q50,
                    backend,
                    json.dumps(payload),
                )

            # 2) Entscheidung publishen
            decision = {
                "series": series,
                "target_ts": target_ts,
                "setpoint_kw": q50,
                "source": "optimizer",
                "policy": "pass_through",
            }
            await publish_decision(decision)

            # ACK: passiert automatisch (kein Fehler geworfen)

        except Exception as e:
            # Fehler → NICHT requeue’n, sondern in DLQ (via DLX-Policy)
            print(f"[{APP}] ERROR handling message: {e}")
            await msg.reject(requeue=False)


# ──────────────────────────────────────────────────────────────────────────────
# Consumer Loop
# ──────────────────────────────────────────────────────────────────────────────
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

# ──────────────────────────────────────────────────────────────────────────────
# Startup / Shutdown
# ──────────────────────────────────────────────────────────────────────────────
@app.on_event("startup")
async def on_startup():
    print(f"[{APP}] Startup – init DB & AMQP")
    app.state.pg = await init_db()
    await init_amqp()
    app.state.consumer_task = asyncio.create_task(amqp_consumer())

@app.on_event("shutdown")
async def on_shutdown():
    print(f"[{APP}] Shutdown – stopping tasks & closing resources")
    # Stop consumer
    task = getattr(app.state, "consumer_task", None)
    if task:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
    # Close AMQP
    conn = getattr(app.state, "amqp_conn", None)
    if conn:
        with contextlib.suppress(Exception):
            await conn.close()
    # Close DB
    pg = getattr(app.state, "pg", None)
    if pg:
        with contextlib.suppress(Exception):
            await pg.close()
    print(f"[{APP}] Shutdown complete.")

# ──────────────────────────────────────────────────────────────────────────────
# Local debug
# ──────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000)



# -----------------
# HTML
# -----------------


HTML_DASHBOARD = """
<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <title>Smart Energy Router – Optimizer Dashboard</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background-color: #0b1120;
      color: #e5e7eb;
    }
    body {
      margin: 0;
      padding: 1rem 1.5rem 2.5rem 1.5rem;
      background: radial-gradient(circle at top left, #1d2437 0, #020617 55%);
      min-height: 100vh;
    }
    h1 {
      font-size: 1.5rem;
      margin-bottom: 0.25rem;
    }
    h2 {
      font-size: 0.95rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #9ca3af;
      margin: 0.75rem 0 0.25rem 0;
    }
    .subtitle {
      color: #9ca3af;
      font-size: 0.9rem;
      margin-bottom: 1rem;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.15rem 0.6rem;
      border-radius: 999px;
      border: 1px solid #1f2937;
      background: rgba(15,23,42,0.9);
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: #e5e7eb;
    }
    .badge span.dot {
      width: 0.45rem;
      height: 0.45rem;
      border-radius: 999px;
      background: #22c55e;
      box-shadow: 0 0 12px rgba(34,197,94,0.9);
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 2.3fr) minmax(0, 1.2fr);
      gap: 1rem;
      margin-top: 0.75rem;
    }
    @media (max-width: 960px) {
      .layout {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    .card {
      border-radius: 0.9rem;
      border: 1px solid rgba(148,163,184,0.25);
      background: radial-gradient(circle at top, rgba(15,23,42,0.9), rgba(15,23,42,0.9));
      box-shadow: 0 18px 45px rgba(15,23,42,0.85);
      padding: 0.9rem 1rem;
      position: relative;
      overflow: hidden;
    }
    .card::before {
      content: "";
      position: absolute;
      inset: 0;
      background: radial-gradient(circle at top left, rgba(59,130,246,0.14), transparent 55%);
      pointer-events: none;
    }
    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
      position: relative;
      z-index: 1;
    }
    .card-title {
      font-size: 0.95rem;
      font-weight: 600;
    }
    .card-subtitle {
      font-size: 0.8rem;
      color: #9ca3af;
      margin-top: 0.1rem;
    }
    .pill {
      font-size: 0.7rem;
      padding: 0.15rem 0.55rem;
      border-radius: 999px;
      border: 1px solid rgba(148,163,184,0.4);
      color: #9ca3af;
      text-transform: uppercase;
      letter-spacing: 0.12em;
    }
    .content {
      position: relative;
      z-index: 1;
    }
    .json-view {
      margin-top: 0.4rem;
      border-radius: 0.6rem;
      background: rgba(15,23,42,0.95);
      border: 1px solid rgba(30,64,175,0.6);
      padding: 0.5rem 0.6rem;
      max-height: 320px;
      overflow: auto;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 0.75rem;
      line-height: 1.25;
      color: #e5e7eb;
    }
    .json-view.error {
      border-color: rgba(248,113,113,0.8);
      background: rgba(127,29,29,0.9);
    }
    .json-view .placeholder {
      color: #6b7280;
      font-style: italic;
    }
    .meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.4rem;
      margin-top: 0.3rem;
      font-size: 0.7rem;
      color: #9ca3af;
    }
    .meta span {
      white-space: nowrap;
    }
    .meta .status-ok {
      color: #4ade80;
    }
    .meta .status-bad {
      color: #f97373;
    }
    .controls {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      flex-wrap: wrap;
      margin-top: 0.6rem;
    }
    .btn {
      font-size: 0.75rem;
      padding: 0.35rem 0.7rem;
      border-radius: 999px;
      border: 1px solid rgba(148,163,184,0.4);
      background: rgba(15,23,42,0.85);
      color: #e5e7eb;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
    }
    .btn:hover {
      border-color: rgba(59,130,246,0.8);
      box-shadow: 0 0 14px rgba(37,99,235,0.6);
    }
    .btn:disabled {
      opacity: 0.5;
      cursor: default;
      box-shadow: none;
    }
    .toggle {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      font-size: 0.75rem;
      color: #9ca3af;
      cursor: pointer;
    }
    .toggle input {
      accent-color: #3b82f6;
    }
    .flow-list {
      font-size: 0.8rem;
      color: #e5e7eb;
      margin-top: 0.4rem;
      list-style: none;
      padding-left: 0.9rem;
    }
    .flow-list li {
      margin-bottom: 0.25rem;
      position: relative;
    }
    .flow-list li::before {
      content: "→";
      position: absolute;
      left: -0.9rem;
      color: #60a5fa;
    }
    .flow-label {
      font-size: 0.7rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #9ca3af;
      margin-bottom: 0.1rem;
    }
    .chip-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      margin-top: 0.3rem;
    }
    .chip {
      font-size: 0.7rem;
      padding: 0.15rem 0.55rem;
      border-radius: 999px;
      border: 1px solid rgba(148,163,184,0.3);
      background: rgba(15,23,42,0.9);
      color: #e5e7eb;
      white-space: nowrap;
    }
    .chip span.tag {
      text-transform: uppercase;
      color: #60a5fa;
      font-size: 0.65rem;
      margin-right: 0.18rem;
    }
    code {
      font-family: inherit;
      font-size: 0.78rem;
      background: rgba(15,23,42,0.85);
      padding: 0.1rem 0.35rem;
      border-radius: 0.35rem;
      border: 1px solid rgba(30,64,175,0.6);
    }
  </style>
</head>
<body>
  <header>
    <div class="badge">
      <span class="dot"></span>
      <span>Optimizer</span>
      <span>Smart Energy Router</span>
    </div>
    <h1>UseCases & Flows – Optimizer</h1>
    <p class="subtitle">
      Überblick über Health, Queues, Forecast → Optimize → Schedule → Router-Agent Flows.
    </p>
  </header>

  <section class="layout">
    <!-- Linke Seite: JSON-Infos / Live-Status -->
    <div class="stack">
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">Service & Queues</div>
            <div class="card-subtitle">Health-Check & RabbitMQ / Worker-Status aus dem Optimizer.</div>
          </div>
          <span class="pill">Core Status</span>
        </div>
        <div class="content">
          <div class="controls">
            <button class="btn" id="btn-refresh-core">
              &#x21bb;
              <span>Jetzt aktualisieren</span>
            </button>
            <label class="toggle">
              <input type="checkbox" id="toggle-autorefresh" checked />
              <span>Auto-Refresh (5 s)</span>
            </label>
            <span id="core-last-updated"></span>
          </div>
          <h2>Health</h2>
          <div id="view-health" class="json-view">
            <div class="placeholder">Lade <code>/health</code> …</div>
          </div>

          <h2>Queues</h2>
          <div id="view-queues" class="json-view">
            <div class="placeholder">Lade <code>/info/queues</code> …</div>
          </div>

          <div class="meta">
            <span>Endpunkte: <code>/health</code>, <code>/info/queues</code></span>
            <span id="core-status-text" class="status-ok">Status: unbekannt</span>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:0.9rem;">
        <div class="card-header">
          <div>
            <div class="card-title">Schedules & Setpoints (Optimizer-Sicht)</div>
            <div class="card-subtitle">
              Geplante Zeitfenster je Gerät & letzte Routing-Setpoints.
            </div>
          </div>
          <span class="pill">Planning Output</span>
        </div>
        <div class="content">
          <div class="controls">
            <button class="btn" id="btn-refresh-planning">
              &#x21bb;
              <span>Reload Planning</span>
            </button>
            <span id="planning-last-updated"></span>
          </div>

          <h2>Schedules</h2>
          <div id="view-schedules" class="json-view">
            <div class="placeholder">Lade <code>/info/schedules</code> …</div>
          </div>

          <h2>Setpoints</h2>
          <div id="view-setpoints" class="json-view">
            <div class="placeholder">Lade <code>/info/setpoints</code> …</div>
          </div>

          <div class="meta">
            <span>Endpunkte: <code>/info/schedules</code>, <code>/info/setpoints</code></span>
            <span id="planning-status-text" class="status-ok">Status: unbekannt</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Rechte Seite: UseCases & Flows -->
    <aside class="stack">
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">UseCase-Flow – Überblick</div>
            <div class="card-subtitle">
              Hohe Ebene der Data-&amp;Energy-Flows für den Optimizer.
            </div>
          </div>
          <span class="pill">Flow Map</span>
        </div>
        <div class="content">
          <div class="flow-label">Standard-Flow (Day-Ahead / Intraday)</div>
          <ul class="flow-list">
            <li><strong>Forecast</strong> wird vom Predictor generiert und in <code>forecasts.out</code> publiziert.</li>
            <li><strong>Optimizer</strong> konsumiert Forecast &amp; Gerätekonfiguration, erstellt Schedules.</li>
            <li><strong>Schedules</strong> werden an Router-Agent weitergegeben / persistiert.</li>
            <li><strong>Router-Agent</strong> setzt Setpoints auf Geräte / Backend durch.</li>
            <li><strong>Monitoring</strong> schreibt Messwerte in TimescaleDB / Logging.</li>
          </ul>

          <div class="flow-label" style="margin-top:0.65rem;">UseCases (Konfiguration)</div>
          <div class="chip-row" id="usecase-chips">
            <div class="chip"><span class="tag">PFB</span>Price-Follow Boiler</div>
            <div class="chip"><span class="tag">EV</span>Smart EV Charging</div>
            <div class="chip"><span class="tag">BAT</span>PV-Überschuss → Batterie</div>
          </div>

          <h2>UseCases (aus /info/usecases)</h2>
          <div id="view-usecases" class="json-view">
            <div class="placeholder">
              Optional: hier werden <code>/info/usecases</code>-Daten angezeigt, falls der Endpunkt existiert.
            </div>
          </div>

          <div class="meta">
            <span>Endpunkt: <code>/info/usecases</code> (optional)</span>
            <span id="usecases-status-text" class="status-ok">Status: unbekannt</span>
          </div>
        </div>
      </div>
    </aside>
  </section>

  <script>
    const panels = {
      health: {
        url: "/health",
        elementId: "view-health",
        statusId: "core-status-text",
        lastUpdatedId: "core-last-updated"
      },
      queues: {
        url: "/info/queues",
        elementId: "view-queues",
        statusId: "core-status-text"
      },
      schedules: {
        url: "/info/schedules",
        elementId: "view-schedules",
        statusId: "planning-status-text",
        lastUpdatedId: "planning-last-updated"
      },
      setpoints: {
        url: "/info/setpoints",
        elementId: "view-setpoints",
        statusId: "planning-status-text"
      },
      usecases: {
        url: "/info/usecases",
        elementId: "view-usecases",
        statusId: "usecases-status-text"
      }
    };

    function formatTimestamp(date) {
      const d = date instanceof Date ? date : new Date(date);
      return d.toLocaleTimeString("de-AT", { hour12: false });
    }

    async function fetchPanel(key) {
      const panel = panels[key];
      if (!panel) return;

      const view = document.getElementById(panel.elementId);
      const statusEl = panel.statusId ? document.getElementById(panel.statusId) : null;
      const lastUpdatedEl = panel.lastUpdatedId ? document.getElementById(panel.lastUpdatedId) : null;

      if (!view) return;

      try {
        const res = await fetch(panel.url, { cache: "no-store" });

        if (!res.ok) {
          throw new Error("HTTP " + res.status);
        }

        const contentType = res.headers.get("content-type") || "";
        let data;

        if (contentType.includes("application/json")) {
          data = await res.json();
        } else {
          data = await res.text();
        }

        view.classList.remove("error");

        const pretty = typeof data === "string"
          ? data
          : JSON.stringify(data, null, 2);

        view.innerHTML = "<pre>" + pretty.replace(/[&<>]/g, function (c) {
          return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c];
        }) + "</pre>";

        if (statusEl) {
          statusEl.textContent = "Status: ok (" + key + ")";
          statusEl.classList.remove("status-bad");
          statusEl.classList.add("status-ok");
        }
        if (lastUpdatedEl) {
          lastUpdatedEl.textContent = "Aktualisiert: " + formatTimestamp(new Date());
        }
      } catch (err) {
        view.classList.add("error");
        view.innerHTML = "<div>Fehler beim Laden von <code>" + panel.url +
          "</code><br/><small>" + String(err) + "</small></div>";
        if (statusEl) {
          statusEl.textContent = "Status: Fehler (" + key + ")";
          statusEl.classList.remove("status-ok");
          statusEl.classList.add("status-bad");
        }
      }
    }

    function refreshCore() {
      fetchPanel("health");
      fetchPanel("queues");
    }

    function refreshPlanning() {
      fetchPanel("schedules");
      fetchPanel("setpoints");
      fetchPanel("usecases");
    }

    let intervalId = null;
    function setupAutoRefresh() {
      const toggle = document.getElementById("toggle-autorefresh");
      if (!toggle) return;

      const updateInterval = () => {
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
        if (toggle.checked) {
          intervalId = setInterval(() => {
            refreshCore();
            refreshPlanning();
          }, 5000);
        }
      };

      toggle.addEventListener("change", updateInterval);
      updateInterval();
    }

    document.addEventListener("DOMContentLoaded", () => {
      const btnCore = document.getElementById("btn-refresh-core");
      const btnPlanning = document.getElementById("btn-refresh-planning");

      if (btnCore) {
        btnCore.addEventListener("click", () => {
          refreshCore();
        });
      }
      if (btnPlanning) {
        btnPlanning.addEventListener("click", () => {
          refreshPlanning();
        });
      }

      // initial load
      refreshCore();
      refreshPlanning();
      setupAutoRefresh();
    });
  </script>
</body>
</html>
"""

@app.get("/info/ui", response_class=HTMLResponse)
async def info_ui():
    return HTML_DASHBOARD


# Falls du bereits ein app-Objekt hast, einfach nur die Route + HTML_DASHBOARD
# an passender Stelle einfügen – nicht ein zweites FastAPI() erzeugen.



