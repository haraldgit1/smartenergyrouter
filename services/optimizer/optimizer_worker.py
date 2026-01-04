# services/optimizer/optimizer_worker.py
import json
import os
from datetime import datetime, timedelta, timezone

import pika
import psycopg2

AMQP_URL = os.getenv("AMQP_URL", "amqp://admin:admin@rabbitmq:5672")
PG_CONN = os.getenv("PG_CONN", "postgres://postgres:postgres@timescaledb:5432/energy")

def get_db_conn():
    return psycopg2.connect(PG_CONN)

def update_job_status(job_id, status, plan_id=None, result=None, error_text=None):
    sql = """
    UPDATE optimize_jobs
    SET status = %s,
        plan_id = COALESCE(%s, plan_id),
        result = COALESCE(%s, result),
        error_text = COALESCE(%s, error_text),
        updated_at = NOW()
    WHERE job_id = %s;
    """
    with get_db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (
                status,
                plan_id,
                json.dumps(result) if result else None,
                error_text,
                job_id,
            ))
    print(f"[optimizer_worker] Job {job_id} -> {status}")

def dummy_optimize(msg: dict):
    now = datetime.now(timezone.utc)
    start = now + timedelta(hours=1)
    end = start + timedelta(hours=2)

    device = msg["device"]
    usecase = msg["usecase"]
    horizon_hours = msg["horizon_hours"]

    power_kw = 2.0
    duration_h = (end - start).total_seconds() / 3600.0
    price_eur_per_kwh = 0.20
    baseline_price_eur_per_kwh = 0.28

    energy_kwh = power_kw * duration_h
    expected_cost = energy_kwh * price_eur_per_kwh
    baseline_cost = energy_kwh * baseline_price_eur_per_kwh

    co2_intensity_baseline = 350
    co2_intensity_opt = 220

    baseline_co2 = energy_kwh * co2_intensity_baseline
    expected_co2 = energy_kwh * co2_intensity_opt

    plan_id = f"{device}-{usecase}-{int(now.timestamp())}"

    result = {
        "device": device,
        "usecase": usecase,
        "plan_id": plan_id,
        "window": [
            [start.isoformat(), end.isoformat()]
        ],
        "power_kw": power_kw,
        "summary": {
            "expected_cost_eur": round(expected_cost, 4),
            "baseline_cost_eur": round(baseline_cost, 4),
            "cost_saved_eur": round(baseline_cost - expected_cost, 4),
            # HIER korrigiert: nur einmal *100
            "cost_saved_percent": round(
                100.0 * (baseline_cost - expected_cost) / baseline_cost, 2
            ),

            "expected_co2_g": round(expected_co2, 2),
            "baseline_co2_g": round(baseline_co2, 2),
            "co2_saved_g": round(baseline_co2 - expected_co2, 2),
            "co2_saved_percent": round(
                100.0 * (baseline_co2 - expected_co2) / baseline_co2, 2
            ),

            "horizon_hours": horizon_hours,
        },
    }
    return plan_id, result

def main():
    params = pika.URLParameters(AMQP_URL)
    connection = pika.BlockingConnection(params)
    channel = connection.channel()

    channel.queue_declare(queue="optimize.requests", durable=True)
    print("[optimizer_worker] Waiting for messages on 'optimize.requests'...")

    def callback(ch, method, properties, body):
        msg = None
        try:
            msg = json.loads(body.decode("utf-8"))
            job_id = msg["job_id"]
            print(f"[optimizer_worker] Received job {job_id}: {msg}")

            update_job_status(job_id, "running")

            plan_id, result = dummy_optimize(msg)

            update_job_status(job_id, "done", plan_id=plan_id, result=result)

            ch.basic_ack(delivery_tag=method.delivery_tag)
        except Exception as e:
            print(f"[optimizer_worker] ERROR: {e}")
            try:
                if msg and "job_id" in msg:
                    update_job_status(msg["job_id"], "failed", error_text=str(e))
            except Exception as e2:
                print(f"[optimizer_worker] Failed to update job status: {e2}")
            ch.basic_ack(delivery_tag=method.delivery_tag)

    channel.basic_qos(prefetch_count=1)
    channel.basic_consume(queue="optimize.requests", on_message_callback=callback)

    try:
        channel.start_consuming()
    except KeyboardInterrupt:
        print("[optimizer_worker] Stopped")
    finally:
        connection.close()

if __name__ == "__main__":
    main()

