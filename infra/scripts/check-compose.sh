#!/usr/bin/env bash
# Validates the compose files with placeholder values. -q prints nothing, so no value reaches a log.
set -euo pipefail

export APP_NAME=gps_crm_check APP_DOMAIN=check.example.com IMAGE_TAG=sha-0000000
export POSTGRES_DB=check POSTGRES_USER=check POSTGRES_PASSWORD=check

docker compose -f infra/compose.yml config -q
docker compose -f infra/compose.dev.yml config -q
