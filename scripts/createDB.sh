docker compose exec timescaledb \
  psql -U postgres -c "CREATE DATABASE energy_restore_test3  OWNER postgres;"
docker compose exec timescaledb   psql -U postgres -d energy_restore_test3 -c "CREATE EXTENSION IF NOT EXISTS timescaledb;"
docker compose exec timescaledb   psql -U postgres -d energy_restore_test3 -c "CREATE EXTENSION IF NOT EXISTS timescaledb_toolkit;"

