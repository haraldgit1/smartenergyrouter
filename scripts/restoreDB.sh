docker compose exec -T timescaledb \
  pg_restore -U postgres -d energy_restore_test3 < energy_2025-11-25_2317.dump
