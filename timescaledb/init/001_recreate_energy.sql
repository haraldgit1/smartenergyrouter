-- ==========================================================
-- Smart Energy Router – DB Recreate (idempotent, fixed)
-- Target DB: energy (TimescaleDB)
-- ==========================================================

-- 0) Extensions
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- 1) measurements: Rohdaten
CREATE TABLE IF NOT EXISTS measurements (
  ts        timestamptz NOT NULL,
  source    text        NOT NULL,
  key       text        NOT NULL,
  value     double precision NOT NULL,
  meta      jsonb       NULL
);
SELECT create_hypertable('measurements','ts', if_not_exists => TRUE, migrate_data => TRUE);
CREATE INDEX IF NOT EXISTS ix_measurements_src_key_ts ON measurements (source, key, ts DESC);

-- 2) forecasts: Predictor-Outputs
CREATE TABLE IF NOT EXISTS forecasts (
  ts         timestamptz NOT NULL,  -- Zeitpunkt der Prognoseerstellung
  target_ts  timestamptz NOT NULL,  -- Zeitpunkt, auf den sich die Prognose bezieht
  series     text        NOT NULL,  -- z.B. 'meter1:load_kw'
  q10        double precision NULL,
  q50        double precision NULL,
  q90        double precision NULL,
  backend    text        NULL,      -- z.B. 'torch-cpu'
  meta       jsonb       NULL
);
SELECT create_hypertable('forecasts','ts', if_not_exists => TRUE, migrate_data => TRUE);
CREATE INDEX IF NOT EXISTS ix_forecasts_target ON forecasts (target_ts DESC);
CREATE INDEX IF NOT EXISTS ix_forecasts_series_ts ON forecasts (series, ts DESC);

-- 3) decisions: Optimizer-Outputs
CREATE TABLE IF NOT EXISTS decisions (
  ts          timestamptz NOT NULL, -- Zeitpunkt der Entscheidungserzeugung
  target_ts   timestamptz NOT NULL, -- Zeitpunkt der geplanten Wirksamkeit
  device      text        NOT NULL, -- z.B. 'battery'
  setpoint_kw double precision NOT NULL,
  reason      text        NULL,     -- z.B. 'heuristic_v0'
  meta        jsonb       NULL
);
SELECT create_hypertable('decisions','ts', if_not_exists => TRUE, migrate_data => TRUE);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE schemaname = 'public' AND indexname = 'ux_decisions_ts_target_device'
  ) THEN
    CREATE UNIQUE INDEX ux_decisions_ts_target_device
      ON decisions (ts, target_ts, device);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS ix_decisions_target_device ON decisions (target_ts DESC, device);

-- 4) applications: Idempotenz-Marker des router_agent
CREATE TABLE IF NOT EXISTS applications (
  device     text        NOT NULL,
  target_ts  timestamptz NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  corr_id    text        NULL,
  PRIMARY KEY (device, target_ts)
);

-- 5) Retention Policies (mit try/catch, da IF NOT EXISTS fehlt)
DO $$ BEGIN
  PERFORM add_retention_policy('measurements', INTERVAL '30 days');
EXCEPTION WHEN others THEN
  -- ignorieren, wenn schon vorhanden
END $$;

DO $$ BEGIN
  PERFORM add_retention_policy('forecasts', INTERVAL '30 days');
EXCEPTION WHEN others THEN
END $$;

DO $$ BEGIN
  PERFORM add_retention_policy('decisions', INTERVAL '30 days');
EXCEPTION WHEN others THEN
END $$;

-- 6) Continuous Aggregates
--    WICHTIG: time_bucket MUSS auf der Hypertable-Zeitspalte liegen (hier 'ts')
--    a) decisions_5m: Aggregation nach Erstellzeit der Entscheidung
CREATE MATERIALIZED VIEW IF NOT EXISTS decisions_5m
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('5 minutes', ts) AS bucket,
  device,
  avg(setpoint_kw) AS setpoint_avg_kw,
  count(*)         AS n
FROM decisions
GROUP BY bucket, device;

DO $$ BEGIN
  PERFORM add_continuous_aggregate_policy(
    'decisions_5m',
    start_offset      => INTERVAL '2 days',
    end_offset        => INTERVAL '1 minute',
    schedule_interval => INTERVAL '1 minute'
  );
EXCEPTION WHEN others THEN
END $$;

--    b) forecasts_5m: Aggregation nach Erstellzeit der Prognose
CREATE MATERIALIZED VIEW IF NOT EXISTS forecasts_5m
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('5 minutes', ts) AS bucket,
  series,
  avg(q50) AS q50_avg,
  count(*) AS n
FROM forecasts
GROUP BY bucket, series;

DO $$ BEGIN
  PERFORM add_continuous_aggregate_policy(
    'forecasts_5m',
    start_offset      => INTERVAL '2 days',
    end_offset        => INTERVAL '1 minute',
    schedule_interval => INTERVAL '2 minutes'
  );
EXCEPTION WHEN others THEN
END $$;

-- 7) Nützliche Views
CREATE OR REPLACE VIEW v_decisions_latest AS
SELECT *
FROM decisions
WHERE ts > now() - INTERVAL '10 minutes'
ORDER BY ts DESC, target_ts ASC;

CREATE OR REPLACE VIEW v_forecasts_latest AS
SELECT *
FROM forecasts
WHERE ts > now() - INTERVAL '10 minutes'
ORDER BY ts DESC, target_ts ASC;

