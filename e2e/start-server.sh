#!/usr/bin/env bash
# A fresh database, then the two steps a deploy runs, then the built app. `npm run build` comes first.
set -euo pipefail
cd "$(dirname "$0")/../apps/api"

# What backup.sh leaves on a server, fresh, so the screen «Система» shows a healthy state
mkdir -p "$BACKUP_STATUS_DIR"
now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf '{"schema":1,"finishedAt":"%s","ok":true,"reason":null,"lastOkAt":"%s","dumpBytes":2048,"copies":3}' "$now" "$now" \
  >"$BACKUP_STATUS_DIR/dump.json"
printf '{"schema":1,"finishedAt":"%s","ok":true,"reason":null,"lastOkAt":"%s","tables":15}' "$now" "$now" \
  >"$BACKUP_STATUS_DIR/check.json"

node ../../e2e/reset-database.mjs
# Set rather than left out: Prisma's config would fill the gap from a local .env, which names the working database
export MIGRATION_DATABASE_URL="$E2E_DATABASE_URL"
DATABASE_URL="$E2E_DATABASE_URL" ../../node_modules/.bin/prisma migrate deploy
DATABASE_URL="$E2E_DATABASE_URL" FIRST_ADMIN_EMAIL=admin@example.test FIRST_ADMIN_NAME="Перший Адмін" \
  FIRST_ADMIN_PASSWORD="$E2E_ADMIN_PASSWORD" node dist/setup.js
unset MIGRATION_DATABASE_URL
exec node dist/main.js
