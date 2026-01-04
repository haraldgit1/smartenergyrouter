#!/usr/bin/env python3
"""
Bandit Agent v0.1 (Minimal-Bandit-MVP) for SmartEnergyRouter

- Consumes forecast/context events from a RabbitMQ *QUEUE* (default: forecasts.out)
- Emits decisions to a RabbitMQ *QUEUE* (default: decisions.out)
- Consumes rewards from a RabbitMQ *QUEUE* (default: rewards.in)
- Persists decisions, rewards, and learned Q-values in Postgres/TimescaleDB

Important design choice for MVP:
- We operate on QUEUES (not exchange bindings) to match the current stack style.
- Publishing uses the default exchange "" to route directly by queue-name.
"""

import json
import os
import time
import uuid
import random
from dataclasses import dataclass
from typing import Dict, Any, Optional, Tuple

import psycopg2
import psycopg2.extras
import pika


# -----------------------------
# Domain / Actions
# -----------------------------
DOMAIN = os.environ.get("BANDIT_DOMAIN", "battery_pv_price")
ACTIONS = ["IDLE", "CHARGE", "DISCHARGE"]  # 3-arm MVP


# -----------------------------
# Environment / Config
# -----------------------------
PG_CONN_STR = os.environ.get(
    "PG_CONN_STR",
    "postgres://postgres:postgres@timescaledb:5432/energy",
)

# Use vhost-encoded default "/" for robustness
RABBIT_URL = os.environ.get(
    "RABBIT_URL",
    "amqp://admin:admin@rabbitmq:5672/%2f",
)

# Queue-based MVP wiring (consumption expects QUEUE names)
QUEUE_IN = os.environ.get("BANDIT_QUEUE_IN", "forecasts.out")
QUEUE_OUT = os.environ.get("BANDIT_QUEUE_OUT", "decisions.out")
QUEUE_REW = os.environ.get("BANDIT_QUEUE_REW", "rewards.in")

# Bandit params
EPSILON = float(os.environ.get("BANDIT_EPSILON", "0.10"))
ALPHA = float(os.environ.get("BANDIT_ALPHA", "0.10"))

# Prevent decision spam: one decision per X seconds (MVP default 300s = 5 min)
MIN_DECISION_INTERVAL_SEC = int(os.environ.get("BANDIT_MIN_DECISION_INTERVAL_SEC", "300"))

# Simple action masking thresholds (optional; keeps battery safe without complicating bandit)
SOC_MIN = float(os.environ.get("BANDIT_SOC_MIN", "0.10"))
SOC_MAX = float(os.environ.get("BANDIT_SOC_MAX", "0.95"))


# -----------------------------
# Data layer
# -----------------------------
@dataclass
class QEntry:
    q: float
    n: int


class BanditStore:
    def __init__(self, pg_conn_str: str):
        self._conn = psycopg2.connect(pg_conn_str)
        self._conn.autocommit = True

    def close(self):
        try:
            self._conn.close()
        except Exception:
            pass

    def ensure_tables_exist(self):
        ddl = """
        CREATE TABLE IF NOT EXISTS bandit_decisions (
          ts           timestamptz NOT NULL DEFAULT now(),
          decision_id  uuid        NOT NULL,
          domain       text        NOT NULL,
          policy       text        NOT NULL,
          epsilon      double precision NOT NULL,
          action       text        NOT NULL,
          context      jsonb       NOT NULL,
          PRIMARY KEY (decision_id)
        );

        CREATE TABLE IF NOT EXISTS bandit_rewards (
          ts              timestamptz NOT NULL DEFAULT now(),
          decision_id     uuid        NOT NULL,
          domain          text        NOT NULL,
          reward          double precision NOT NULL,
          energy_cost_eur double precision,
          metadata        jsonb,
          PRIMARY KEY (decision_id),
          FOREIGN KEY (decision_id) REFERENCES bandit_decisions(decision_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS bandit_qvalues (
          domain      text NOT NULL,
          action      text NOT NULL,
          q           double precision NOT NULL DEFAULT 0.0,
          n           bigint NOT NULL DEFAULT 0,
          updated_ts  timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (domain, action)
        );

        CREATE INDEX IF NOT EXISTS idx_bandit_decisions_ts ON bandit_decisions (ts DESC);
        CREATE INDEX IF NOT EXISTS idx_bandit_rewards_ts   ON bandit_rewards (ts DESC);
        """
        with self._conn.cursor() as cur:
            cur.execute(ddl)

    def ensure_qvalues(self, domain: str, actions):
        with self._conn.cursor() as cur:
            for a in actions:
                cur.execute(
                    """
                    INSERT INTO bandit_qvalues(domain, action, q, n)
                    VALUES (%s, %s, 0.0, 0)
                    ON CONFLICT (domain, action) DO NOTHING
                    """,
                    (domain, a),
                )

    def load_qvalues(self, domain: str) -> Dict[str, QEntry]:
        with self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT action, q, n FROM bandit_qvalues WHERE domain=%s",
                (domain,),
            )
            rows = cur.fetchall()
        out: Dict[str, QEntry] = {}
        for r in rows:
            out[r["action"]] = QEntry(float(r["q"]), int(r["n"]))
        return out

    def upsert_qvalue(self, domain: str, action: str, q: float, n: int):
        with self._conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO bandit_qvalues(domain, action, q, n, updated_ts)
                VALUES (%s, %s, %s, %s, now())
                ON CONFLICT (domain, action)
                DO UPDATE SET q=EXCLUDED.q, n=EXCLUDED.n, updated_ts=now()
                """,
                (domain, action, q, n),
            )

    def insert_decision(
        self,
        decision_id: str,
        domain: str,
        policy: str,
        epsilon: float,
        action: str,
        context: Dict[str, Any],
    ):
        with self._conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO bandit_decisions(decision_id, domain, policy, epsilon, action, context)
                VALUES (%s, %s, %s, %s, %s, %s::jsonb)
                """,
                (decision_id, domain, policy, epsilon, action, json.dumps(context)),
            )

    def insert_reward(
        self,
        decision_id: str,
        domain: str,
        reward: float,
        energy_cost_eur: Optional[float],
        metadata: Optional[Dict[str, Any]],
    ):
        with self._conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO bandit_rewards(decision_id, domain, reward, energy_cost_eur, metadata)
                VALUES (%s, %s, %s, %s, %s::jsonb)
                ON CONFLICT (decision_id) DO NOTHING
                """,
                (decision_id, domain, reward, energy_cost_eur, json.dumps(metadata or {})),
            )

    def get_decision_action(self, decision_id: str) -> Optional[str]:
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT action FROM bandit_decisions WHERE decision_id=%s",
                (decision_id,),
            )
            row = cur.fetchone()
            return row[0] if row else None


# -----------------------------
# Bandit core (ε-greedy)
# -----------------------------
class EpsilonGreedyBandit:
    def __init__(self, store: BanditStore, domain: str, actions):
        self.store = store
        self.domain = domain
        self.actions = list(actions)

        self.store.ensure_qvalues(domain, self.actions)
        self.qvalues = self.store.load_qvalues(domain)
        for a in self.actions:
            self.qvalues.setdefault(a, QEntry(0.0, 0))

    def choose_action(self, allowed_actions) -> Tuple[str, str]:
        allowed = list(allowed_actions)
        if not allowed:
            return "IDLE", "fallback_no_allowed_actions"

        # explore
        if random.random() < EPSILON:
            return random.choice(allowed), "explore"

        # exploit: max Q among allowed
        max_q = max(self.qvalues[a].q for a in allowed)
        best = [a for a in allowed if self.qvalues[a].q == max_q]
        return random.choice(best), "exploit"

    def update(self, action: str, reward: float):
        entry = self.qvalues.get(action, QEntry(0.0, 0))
        new_q = entry.q + ALPHA * (reward - entry.q)
        new_n = entry.n + 1
        self.qvalues[action] = QEntry(new_q, new_n)
        self.store.upsert_qvalue(self.domain, action, new_q, new_n)


# -----------------------------
# Agent wiring (AMQP + DB)
# -----------------------------
class BanditAgent:
    def __init__(self):
        self.store = BanditStore(PG_CONN_STR)
        self.store.ensure_tables_exist()

        self.bandit = EpsilonGreedyBandit(self.store, DOMAIN, ACTIONS)

        self._last_decision_wallclock = 0.0
        self._latest_context: Optional[Dict[str, Any]] = None

        self._conn = pika.BlockingConnection(pika.URLParameters(RABBIT_URL))
        self._ch = self._conn.channel()

        # Ensure queues exist (durable). This matches your MVP style.
        self._ch.queue_declare(queue=QUEUE_IN, durable=True)
        self._ch.queue_declare(queue=QUEUE_OUT, durable=True)
        self._ch.queue_declare(queue=QUEUE_REW, durable=True)

        self._ch.basic_qos(prefetch_count=50)

    def close(self):
        try:
            self._conn.close()
        except Exception:
            pass
        self.store.close()

    def _iso_utc_now(self) -> str:
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    def _parse_hour_utc(self, ts: Optional[str]) -> Optional[int]:
        try:
            if isinstance(ts, str) and "T" in ts:
                return int(ts.split("T")[1].split(":")[0])
        except Exception:
            return None
        return None

    def _build_context_from_msg(self, msg: Dict[str, Any]) -> Dict[str, Any]:
        """
        Expected incoming shape (example):
        {
          "ts": "...Z",
          "series": "meter1:load_kw",
          "q50": 4.8,
          "extras": {
             "price_eur_kwh": 0.19,
             "pv_kw_q50": 2.1,
             "soc": 0.62
          }
        }
        """
        extras = msg.get("extras") or {}

        ts = msg.get("ts")
        ctx = {
            "ts": ts,
            "hour_utc": self._parse_hour_utc(ts),
            "series": msg.get("series"),
            "forecast_load_q50_kw": msg.get("q50"),
            "price_eur_kwh": extras.get("price_eur_kwh"),
            "pv_kw_q50": extras.get("pv_kw_q50"),
            "soc": extras.get("soc"),
        }

        # Cheap derived helper: PV surplus vs load (positive => PV covers load)
        try:
            load = ctx.get("forecast_load_q50_kw")
            pv = ctx.get("pv_kw_q50")
            if load is not None and pv is not None:
                ctx["pv_surplus_kw_q50"] = float(pv) - float(load)
        except Exception:
            pass

        return ctx

    def _allowed_actions(self, ctx: Dict[str, Any]) -> Tuple[str, ...]:
        """
        Minimal action masking:
        - If SoC too high, don't CHARGE
        - If SoC too low, don't DISCHARGE
        """
        allowed = set(ACTIONS)

        soc = ctx.get("soc")
        try:
            if soc is not None:
                soc_f = float(soc)
                if soc_f >= SOC_MAX:
                    allowed.discard("CHARGE")
                if soc_f <= SOC_MIN:
                    allowed.discard("DISCHARGE")
        except Exception:
            # if soc can't be parsed, do not mask
            pass

        # Always allow IDLE as a safe fallback
        allowed.add("IDLE")
        return tuple(sorted(allowed))

    def _should_decide(self) -> bool:
        return (time.time() - self._last_decision_wallclock) >= MIN_DECISION_INTERVAL_SEC

    def _publish_to_queue(self, queue_name: str, payload: Dict[str, Any]):
        """
        Publish directly to a queue by name using RabbitMQ default exchange "".
        This is the most robust MVP approach if you rely on queue names.
        """
        body = json.dumps(payload).encode("utf-8")
        self._ch.basic_publish(
            exchange="",
            routing_key=queue_name,
            body=body,
            properties=pika.BasicProperties(
                delivery_mode=2,
                content_type="application/json",
            ),
        )

    # ---------- Rabbit callbacks ----------
    def on_forecast(self, ch, method, properties, body: bytes):
        try:
            msg = json.loads(body.decode("utf-8"))
        except Exception:
            ch.basic_ack(delivery_tag=method.delivery_tag)
            return

        ctx = self._build_context_from_msg(msg)
        self._latest_context = ctx

        # Guard: require at least price + load forecast
        if ctx.get("price_eur_kwh") is None or ctx.get("forecast_load_q50_kw") is None:
            ch.basic_ack(delivery_tag=method.delivery_tag)
            return

        if self._should_decide():
            allowed = self._allowed_actions(ctx)
            action, mode = self.bandit.choose_action(allowed)

            decision_id = str(uuid.uuid4())
            decision = {
                "ts": self._iso_utc_now(),
                "decision_id": decision_id,
                "domain": DOMAIN,
                "action": action,
                "policy": "epsilon_greedy",
                "epsilon": EPSILON,
                "mode": mode,
                "context": ctx,
            }

            # Persist + publish
            self.store.insert_decision(
                decision_id=decision_id,
                domain=DOMAIN,
                policy="epsilon_greedy",
                epsilon=EPSILON,
                action=action,
                context=ctx,
            )
            self._publish_to_queue(QUEUE_OUT, decision)

            self._last_decision_wallclock = time.time()

        ch.basic_ack(delivery_tag=method.delivery_tag)

    def on_reward(self, ch, method, properties, body: bytes):
        try:
            msg = json.loads(body.decode("utf-8"))
        except Exception:
            ch.basic_ack(delivery_tag=method.delivery_tag)
            return

        decision_id = msg.get("decision_id")
        domain = msg.get("domain") or DOMAIN

        reward = msg.get("reward")
        energy_cost = msg.get("energy_cost_eur")

        # Allow reward inference from energy_cost if needed
        if reward is None and energy_cost is not None:
            try:
                reward = -float(energy_cost)
            except Exception:
                reward = None

        if not decision_id or reward is None:
            ch.basic_ack(delivery_tag=method.delivery_tag)
            return

        action = self.store.get_decision_action(decision_id)
        if action in ACTIONS:
            # Persist reward
            try:
                e_cost = float(energy_cost) if energy_cost is not None else None
            except Exception:
                e_cost = None

            self.store.insert_reward(
                decision_id=decision_id,
                domain=domain,
                reward=float(reward),
                energy_cost_eur=e_cost,
                metadata=msg.get("metadata") or {},
            )

            # Update bandit
            self.bandit.update(action, float(reward))

        ch.basic_ack(delivery_tag=method.delivery_tag)

    def run(self):
        print(
            f"[bandit] domain={DOMAIN} actions={ACTIONS} eps={EPSILON} alpha={ALPHA} "
            f"interval={MIN_DECISION_INTERVAL_SEC}s soc_min={SOC_MIN} soc_max={SOC_MAX}"
        )
        print(f"[bandit] consume queue: {QUEUE_IN}")
        print(f"[bandit] reward  queue: {QUEUE_REW}")
        print(f"[bandit] publish queue: {QUEUE_OUT}")

        self._ch.basic_consume(queue=QUEUE_IN, on_message_callback=self.on_forecast, auto_ack=False)
        self._ch.basic_consume(queue=QUEUE_REW, on_message_callback=self.on_reward, auto_ack=False)

        self._ch.start_consuming()


if __name__ == "__main__":
    agent = BanditAgent()
    try:
        agent.run()
    except KeyboardInterrupt:
        pass
    finally:
        agent.close()

