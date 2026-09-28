#!/usr/bin/env bash
#
# Deploy gps_crm on the server (same flow as buh_crm, minus the database: the demo has none yet).
#
#   ./scripts/deploy.sh      pull, rebuild, wait until /health answers
#
set -euo pipefail

cd "$(dirname "$0")/.."

say() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

[ -f .env ] || { echo "no .env in $(pwd); copy .env.example to .env and fill it in" >&2; exit 1; }
docker network inspect proxy >/dev/null 2>&1 ||
  { echo "docker network 'proxy' not found. Is Traefik running on this host?" >&2; exit 1; }

say "Pulling"
git pull --ff-only

say "Rebuilding and restarting"
docker compose up -d --build

say "Waiting for the app to answer"
for i in $(seq 1 60); do
  if docker compose exec -T app node -e 'fetch(`http://127.0.0.1:${process.env.PORT||3000}/health`).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' 2>/dev/null; then
    echo "   up after ${i}s"
    break
  fi
  [ "$i" = 60 ] && { echo "   still not answering, check: docker compose logs app" >&2; exit 1; }
  sleep 1
done

say "Done: $(git log -1 --format='%h %s')"
echo "   rollback, if needed: git checkout <previous commit> && docker compose up -d --build"
