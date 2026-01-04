docker compose exec timescaledb \
  psql -U postgres -c "DROP DATABASE IF EXISTS energy_restore_test3 WITH (FORCE);"
