create table if not exists measurements_histo (
    ts        timestamptz not null,
    series    text        not null,
    value     double precision not null,
    source    text,
    quality   text,
    meta      jsonb
);

create index if not exists measurements_histo_series_ts_idx
    on measurements_histo (series, ts desc);

-- Timescale hypertable
select create_hypertable(
    'measurements_histo',
    'ts',
    if_not_exists => true
);


create table if not exists forecasts_histo (
    ts          timestamptz not null,
    target_ts   timestamptz not null,
    series      text        not null,
    quantile    double precision not null,
    value       double precision not null,
    model       text,
    meta        jsonb
);

create index if not exists forecasts_histo_series_target_ts_idx
    on forecasts_histo (series, target_ts desc);

select create_hypertable(
    'forecasts_histo',
    'ts',
    if_not_exists => true
);


create table if not exists decisions_histo (
    ts          timestamptz not null,
    decision_id text        not null,
    device      text        not null,
    action      text        not null,
    value       double precision,
    reason      text,
    source      text,
    meta        jsonb
);

create index if not exists decisions_histo_device_ts_idx
    on decisions_histo (device, ts desc);

select create_hypertable(
    'decisions_histo',
    'ts',
    if_not_exists => true
);


create table if not exists router_actions_histo (
    ts        timestamptz not null,
    device    text        not null,
    setpoint  double precision,
    source    text,
    meta      jsonb
);

create index if not exists router_actions_histo_device_ts_idx
    on router_actions_histo (device, ts desc);

select create_hypertable(
    'router_actions_histo',
    'ts',
    if_not_exists => true
);



