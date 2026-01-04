# services/console_api/db.py
import os
import json
import psycopg2
from psycopg2.extras import RealDictCursor, Json

DB_HOST = os.getenv("DB_HOST", "timescaledb")
DB_PORT = int(os.getenv("DB_PORT", "5432"))
DB_NAME = os.getenv("DB_NAME", "energy")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "postgres")

def get_conn():
    return psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
    )

def create_optimize_job(device, usecase, horizon_hours, constraints):
    sql = """
    INSERT INTO optimize_jobs (device, usecase, horizon_hours, constraints)
    VALUES (%s, %s, %s, %s)
    RETURNING job_id, status, plan_id;
    """
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # HIER ist der wichtige Teil: Json(constraints)
            cur.execute(
                sql,
                (device, usecase, horizon_hours, Json(constraints)),
            )
            row = cur.fetchone()
    return row

def get_optimize_job(job_id):
    sql = """
    SELECT job_id,
           status,
           plan_id,
           device,
           usecase,
           horizon_hours,
           constraints,
           created_at,
           updated_at,
           error_text,
           result
    FROM optimize_jobs
    WHERE job_id = %s;
    """
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, (job_id,))
            row = cur.fetchone()
    return row

