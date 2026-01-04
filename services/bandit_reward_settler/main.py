#!/usr/bin/env python3
import json
import os
import time
from typing import Dict, Any, Optional

import psycopg2
import psycopg2.extras
import pika

PG_CONN_STR = os.environ.get(
    "PG_CONN_STR",
    "postgres://postgres:postgres@timescaledb:5432/energy",
)
AMQP_URL = os.environ.get(
    "AMQP_URL",
    "amqp://admin:admin@rabbitmq:5672/%2f",
)

REWARD_QUEUE = os.environ.get("REWARD_QUEUE", "rewards.in")
POLL_SECONDS = int(os.environ.get("POLL_SECONDS", "30"))

# Wait this long after a decision before settling reward (simulate observation window)
SETTLE_DELAY_SECONDS = int(os.environ.get("SETTLE_DELAY_SECONDS", "300"))

# Fixed action power model (MVP)
CHARGE_KW = float(os.environ.get("CHARGE_KW", "2.0"))
DISCHARGE_KW = float(os.environ.get("DISCHARGE_KW", "2.0"))
STEP_HOURS = float(os.environ.get("STEP_HOURS", "0.0833333"))  # 5 min = 1/12 h

def publish_reward(ch, decision_id: str, domain: str, energy_cost_eur: float, metadata: Dict[str, Any]):
    payload = {
        "decision_id": decision_id,
        "domain": domain,
        "energy_cost_eur": float(energy_cost_eur),
        "metadata": metadata,
    }
    body = json.dumps(payload).encode("utf-8")
    ch.basic_publish(
        exchange="",
        routing_key=REWARD_QUEUE,
        body=body,
        properties=pika.BasicProperties(delivery_mode=2, content_type="application/json"),
    )

def main():
    print(f"[settler] PG_CONN_STR={PG_CONN_STR}")
    print(f"[settler] AMQP_URL={AMQP_URL}")
    print(f"[settler] reward_queue={REWARD_QUEUE} poll={POLL_SECONDS}s delay={SETTLE_DELAY_SECONDS}s")
    print(f"[settler] model: CHARGE={CHARGE_KW}kW DISCHARGE={DISCHARGE_KW}kW step_hours={STEP_HOURS}")

    conn = psycopg2.connect(PG_CONN_STR)
    conn.autocommit = True

    amqp = pika.BlockingConnection(pika.URLParameters(AMQP_URL))
    ch = amqp.channel()
    ch.queue_declare(queue=REWARD_QUEUE, durable=True)

    while True:
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT d.ts, d.decision_id, d.domain, d.action, d.context
                    FROM bandit_decisions d
                    LEFT JOIN bandit_rewards r ON r.decision_id = d.decision_id
                    WHERE r.decision_id IS NULL
                    ORDER BY d.ts ASC
                    LIMIT 20
                    """
                )
                rows = cur.fetchall()

            now = time.time()

            for r in rows:
                decision_ts = r["ts"].timestamp()
                if (now - decision_ts) < SETTLE_DELAY_SECONDS:
                    continue

                decision_id = str(r["decision_id"])
                domain = r["domain"]
                action = r["action"]
                ctx = r["context"] or {}
                price = ctx.get("price_eur_kwh")

                try:
                    price = float(price) if price is not None else 0.19
                except Exception:
                    price = 0.19

                # energy cost for the step (very rough MVP)
                if action == "CHARGE":
                    energy_cost = price * CHARGE_KW * STEP_HOURS
                elif action == "DISCHARGE":
                    # treat discharge as "negative cost" (earning/avoided cost) for MVP
                    energy_cost = -price * DISCHARGE_KW * STEP_HOURS
                else:
                    energy_cost = 0.0

                publish_reward(
                    ch,
                    decision_id=decision_id,
                    domain=domain,
                    energy_cost_eur=energy_cost,
                    metadata={
                        "source": "bandit_reward_settler",
                        "price_eur_kwh": price,
                        "action": action,
                        "assumed_step_hours": STEP_HOURS,
                        "assumed_charge_kw": CHARGE_KW,
                        "assumed_discharge_kw": DISCHARGE_KW,
                    },
                )
                print(f"[settler] reward sent decision_id={decision_id} action={action} cost_eur={energy_cost:.5f} price={price}")

        except Exception as e:
            print("[settler] ERROR:", repr(e))

        time.sleep(POLL_SECONDS)

if __name__ == "__main__":
    main()

