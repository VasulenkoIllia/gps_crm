#!/usr/bin/env bash
# Starts the built image once, before it is published. Tests run through Vite, so only this shows that the compiled
# code and the type-stripped packages/shared load under plain Node. /health needs no database, the URL only has to parse.
set -euo pipefail

readonly ATTEMPTS=20
readonly CONTAINER=gps_crm_smoke
# Nothing is sealed here: the app only needs a key of the right length to start
readonly PLACEHOLDER_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=

image=${1:?usage: smoke-image.sh <image>}

trap 'docker rm -f "$CONTAINER" >/dev/null 2>&1 || true' EXIT
docker run --detach --name "$CONTAINER" --env DATABASE_URL=postgresql://smoke:smoke@127.0.0.1:1/smoke \
  --env APP_URL=http://127.0.0.1:3000 --env SECRETS_KEY="$PLACEHOLDER_KEY" --env FILES_DIR=/files "$image" >/dev/null

health="fetch('http://127.0.0.1:3000/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
for _ in $(seq 1 "$ATTEMPTS"); do
  if docker exec "$CONTAINER" node -e "$health" 2>/dev/null; then
    echo "image answers /health"
    exit 0
  fi
  sleep 1
done

docker logs "$CONTAINER" >&2
echo "image did not answer /health" >&2
exit 1
