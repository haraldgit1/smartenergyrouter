# SmartEnergyRouter – Minimal Compose Skeleton
Generated: 2025-11-10

## Quickstart
```bash
# Copy to server (adjust host)
scp -r SmartEnergyRouter ubuntu@<host>:~/

cd ~/SmartEnergyRouter
cp .env.example .env
docker compose build
docker compose up -d
docker compose ps
docker compose logs -f feature_engine
```
