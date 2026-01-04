-- ==========================================================
-- Smart Energy Router – DB Recreate (idempotent)
-- Target DB: energy (TimescaleDB)
-- ==========================================================

-- 0) Extensions
CREATE EXTENSION IF NOT EXISTS timescaledb;
-- (optional) nützliche Aggregate:
-- CREATE EXTENSION IF NOT EXISTS timescaledb_toolkit;

-- 1) measurements: Rohdaten vom ingestor (source/key/value)
CREATE TABLE IF NOT EXISTS measurements (
  ts        timestamptz NOT NULL,
  source    text        NOT NULL,
  key       text        NOT NULL,
  value     double precision NOT NULL,
  meta      jsonb       NULL
);
SELECT create_hypertable('measurements','ts', if_not_exists => TRUE, migrate_data => TRUE);
CREATE INDEX IF NOT EXISTS ix_measurements_src_key_ts ON measurements (source, key, ts DESC);

-- 2) forecasts: Ausgaben des predictors (quantile ≥ optional)
CREATE TABLE IF NOT EXISTS forecasts (
  ts         timestamptz NOT NULL,                 -- Zeitpunkt der Prognoseerstellung
  target_ts  timestamptz NOT NULL,                 -- Zeitpunkt auf den sich die Prognose bezieht
  series     text        NOT NULL,                 -- z.B. 'meter1:load_kw'
  q10        double precision NULL,
  q50        double precision NULL,
  q90        double precision NULL,
  backend    text        NULL,                     -- z.B. 'torch-cpu'
  meta       jsonb       NULL
);
SELECT create_hypertable('forecasts','ts', if_not_exists => TRUE, migrate_data => TRUE);
CREATE INDEX IF NOT EXISTS ix_forecasts_target ON forecasts (target_ts DESC);
CREATE INDEX IF NOT EXISTS ix_forecasts_series_ts ON forecasts (series, ts DESC);

-- 3) decisions: Ausgaben des optimizers (Sollwerte)
CREATE TABLE IF NOT EXISTS decisions (
  ts          timestamptz NOT NULL,                -- Zeitpunkt der Entscheidungserzeugung
  target_ts   timestamptz NOT NULL,                -- Zeitpunkt der geplanten Wirksamkeit
  device      text        NOT NULL,                -- z.B. 'battery'
  setpoint_kw double precision NOT NULL,
  reason      text        NULL,                    -- z.B. 'heuristic_v0'
  meta        jsonb       NULL
);
SELECT create_hypertable('decisions','ts', if_not_exists => TRUE, migrate_data => TRUE);

-- Upsert-Constraint wie in euren Services verwendet:
-- (Konflikt auf (ts, target_ts, device) – bitte nicht ändern, wenn Code bereits so arbeitet)
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

-- 5) Retention Policies (anpassbar)
--    Rohdaten/Prognosen/Entscheidungen 30 Tage aufbewahren:
SELECT add_retention_policy('measurements', INTERVAL '30 days')
  ON CONFLICT DO NOTHING;
SELECT add_retention_policy('forecasts',   INTERVAL '30 days')
  ON CONFLICT DO NOTHING;
SELECT add_retention_policy('decisions',   INTERVAL '30 days')
  ON CONFLICT DO NOTHING;

-- 6) Continuous Aggregates für Dashboards/Monitoring
--    decisions_5m: gemittelte Setpoints je Gerät in 5-Min-Buckets
CREATE MATERIALIZED VIEW IF NOT EXISTS decisions_5m
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('5 minutes', target_ts) AS bucket,
  device,
  avg(setpoint_kw) AS setpoint_avg_kw,
  count(*)         AS n
FROM decisions
GROUP BY bucket, device;

-- CAGG-Refresh-Policy (rollierend)
SELECT add_continuous_aggregate_policy(
  'decisions_5m',
  start_offset     => INTERVAL '2 days',
  end_offset       => INTERVAL '1 minute',
  schedule_interval=> INTERVAL '1 minute'
) ON CONFLICT DO NOTHING;

-- (Optional) forecasts_5m: Median (q50) über 5-Minuten je Serie
CREATE MATERIALIZED VIEW IF NOT EXISTS forecasts_5m
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('5 minutes', target_ts) AS bucket,
  series,
  avg(q50) AS q50_avg,
  count(*) AS n
FROM forecasts
GROUP BY bucket, series;

SELECT add_continuous_aggregate_policy(
  'forecasts_5m',
  start_offset      => INTERVAL '2 days',
  end_offset        => INTERVAL '1 minute',
  schedule_interval => INTERVAL '2 minutes'
) ON CONFLICT DO NOTHING;

-- 7) Nützliche Views (für schnelle Checks)
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

-- 8) Minimalrechte (optional; hier alles owner=postgres)
-- Du kannst eigene Rollen definieren und SELECT/INSERT-Rechte vergeben, z. B.:
-- GRANT SELECT, INSERT ON measurements, forecasts, decisions TO energy_writer;
-- GRANT SELECT ON ALL TABLES IN SCHEMA public TO energy_reader;

-- 9) Sanity-Probes
-- (laufen idempotent – nützlich, um zu prüfen, dass Tabellen existieren)
-- SELECT * FROM measurements LIMIT 0;
-- SELECT * FROM forecasts LIMIT 0;
-- SELECT * FROM decisions LIMIT 0;
-- SELECT * FROM applications LIMIT 0;

