#!/usr/bin/env bash
# Rolls one environment out to an image already pulled by deploy-entry.sh, which also holds the deploy lock and keeps
# this script running if its SSH session dies. Runs from <env dir>/release/scripts. The server is shared: this script
# touches only its own compose project, its own files and old images of this repository, and never uses prune,
# `down -v` or anything host-wide.
#
#   deploy.sh <staging|production> <sha-tag> [--skip-migrate]
set -euo pipefail
umask 077

readonly IMAGE_REPO=ghcr.io/vasulenkoillia/gps_crm
readonly READY_TIMEOUT_SECONDS=90
readonly DB_READY_TIMEOUT_SECONDS=60
readonly MIGRATE_TIMEOUT_SECONDS=600
readonly ROUTE_CHECK_ATTEMPTS=10
readonly ROUTE_CHECK_DELAY_SECONDS=2
readonly IMAGES_TO_KEEP=5
readonly DUMPS_TO_KEEP=10

target_env=${1:?usage: deploy.sh <env> <tag> [--skip-migrate]}
tag=${2:?usage: deploy.sh <env> <tag> [--skip-migrate]}
skip_migrate=${3:-}

env_dir=$(cd "$(dirname "$0")/../.." && pwd)
env_file=$env_dir/.env
tag_file=$env_dir/current_tag
previous_tag_file=$env_dir/previous_tag
compose_file=$env_dir/release/compose.yml
project=$(basename "$env_dir")

say() { printf '\n== %s\n' "$1"; }
die() { echo "deploy: $1" >&2; exit 1; }

# The project name is explicit in every call: without it compose derives one from the folder and starts a second,
# empty database next to the real one.
compose_command=(docker compose --project-name "$project" --env-file "$env_file")

compose() {
  IMAGE_TAG=$tag "${compose_command[@]}" -f "$compose_file" "$@"
}

check_env_file() {
  grep -qx "APP_NAME=$project" "$env_file" || die "$env_file must set APP_NAME=$project"
  docker network inspect proxy >/dev/null 2>&1 || die "docker network proxy not found"
}

# The live container is the truth about what runs; the file is the fallback when nothing healthy runs
running_tag() {
  local image
  image=$(docker ps \
    --filter "label=com.docker.compose.project=$project" \
    --filter "label=com.docker.compose.service=app" \
    --filter "health=healthy" \
    --format '{{.Image}}' | head -n 1)
  if [ -n "$image" ]; then
    echo "${image##*:}"
  elif [ -f "$tag_file" ]; then
    cat "$tag_file"
  fi
}

start_db() {
  compose up -d --no-deps --wait --wait-timeout "$DB_READY_TIMEOUT_SECONDS" db
}

dump_database() {
  local dump_dir=$env_dir/backups dump
  mkdir -p "$dump_dir"
  dump=$dump_dir/predeploy-$(date +%Y%m%d-%H%M%S)-$tag.dump
  # shellcheck disable=SC2016 # $POSTGRES_* expand inside the db container, on purpose
  compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' >"$dump"
  # grep without -q reads to the end: stopping at the first match would kill pg_restore with SIGPIPE under pipefail
  compose exec -T db pg_restore --list <"$dump" | grep 'TABLE DATA' >/dev/null || die "dump $dump failed the read check"
  echo "dump: $dump ($(wc -c <"$dump") bytes)"
  # shellcheck disable=SC2012 # our own timestamped names without spaces; keeps the newest dumps
  ls -1t "$dump_dir"/predeploy-*.dump | tail -n +$((DUMPS_TO_KEEP + 1)) | while read -r old_dump; do
    rm -f "$old_dump"
  done
}

# Outside any `if`, and strict about the answer: a failed check must stop the deploy, not read as an empty database
# and let a migration run without a dump.
dump_unless_empty() {
  local count
  # shellcheck disable=SC2016 # $POSTGRES_* expand inside the db container, on purpose
  count=$(compose exec -T db sh -c \
    'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select count(*) from pg_tables where schemaname = '\''public'\''"') ||
    die "could not read the database, refusing to go on without a dump"
  [[ "$count" =~ ^[0-9]+$ ]] || die "unexpected table count: $count"
  if [ "$count" -gt 0 ]; then
    dump_database
  else
    echo "empty database: nothing to dump on the first deploy"
  fi
}

# A timeout, because a migration stuck on a lock would hold the deploy lock for good; lock_timeout in compose.yml
# keeps it from blocking the running version meanwhile.
migrate() {
  IMAGE_TAG=$tag timeout "$MIGRATE_TIMEOUT_SECONDS" "${compose_command[@]}" -f "$compose_file" run --rm migrate ||
    die "migration failed or took over $MIGRATE_TIMEOUT_SECONDS s: see «Коли міграція впала» in docs/deployment.md"
}

# `--wait` follows the container healthcheck, which calls /health/ready, and fails as soon as it turns unhealthy
start_app() {
  compose up -d --no-deps --wait --wait-timeout "$READY_TIMEOUT_SECONDS" app
}

roll_back_to() {
  local previous_tag=$1 log=$env_dir/failed-start.log
  # Into a file: this output reaches the CI log, and application logs do not belong there
  compose logs --tail 100 app >"$log" 2>&1 || true
  echo "application log of the failed start: $log" >&2
  [ -n "$previous_tag" ] || die "$tag is not ready and there is no previous version to return to"
  say "Returning to $previous_tag"
  tag=$previous_tag
  [ ! -f "$env_dir/release.prev/compose.yml" ] || compose_file=$env_dir/release.prev/compose.yml
  start_app || die "$previous_tag did not become ready either: the app is down"
  die "new version was not ready, $previous_tag is running again"
}

record_release() {
  local previous_tag=$1
  [ -z "$previous_tag" ] || [ "$previous_tag" = "$tag" ] || echo "$previous_tag" >"$previous_tag_file"
  echo "$tag" >"$tag_file"
  : >"$env_dir/release/.live"
}

# Tags of every environment stay: production updates rarely, and its rollback target must survive staging's releases.
# `image rm` refuses an image a container runs, which is what we want here, so its failures are not errors.
remove_old_images() {
  local kept_tags
  kept_tags=$(cat "$env_dir"/../gps_crm_*/current_tag "$env_dir"/../gps_crm_*/previous_tag 2>/dev/null || true)
  docker image ls --format '{{.CreatedAt}} {{.Repository}}:{{.Tag}}' "$IMAGE_REPO" |
    sort -r |
    awk '{print $NF}' |
    grep ':sha-' |
    tail -n +$((IMAGES_TO_KEEP + 1)) |
    while read -r old_image; do
      grep -qxF "${old_image##*:}" <<<"$kept_tags" && continue
      docker image rm "$old_image" >/dev/null 2>&1 || echo "keeping $old_image"
    done
}

# A healthy container says nothing about Traefik: a wrong label or a clash on Host gives 404 behind a green deploy.
# Traefik needs a few seconds to pick the container up. 401 is a pass: that is Basic Auth answering on our router.
check_route() {
  local domain code=000
  domain=$(sed -n 's/^APP_DOMAIN=//p' "$env_file")
  for _ in $(seq 1 "$ROUTE_CHECK_ATTEMPTS"); do
    code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 5 --resolve "$domain:443:127.0.0.1" \
      "https://$domain/health" || true)
    case $code in 200 | 401) return 0 ;; esac
    sleep "$ROUTE_CHECK_DELAY_SECONDS"
  done
  die "$tag runs, but Traefik answers $code for $domain: check the labels and ROUTER_MIDDLEWARES"
}

main() {
  check_env_file
  local previous_tag
  previous_tag=$(running_tag)
  echo "environment: $target_env, new: $tag, running: ${previous_tag:-none}"

  say "Database"
  # The dump comes first: `up` applies this release's db settings and may recreate the container
  [ -n "$(compose ps --status running --quiet db)" ] || start_db
  dump_unless_empty
  start_db || die "db did not start with the settings of $tag; to return: ${previous_tag:-none} --skip-migrate"

  if [ "$skip_migrate" = "--skip-migrate" ]; then
    say "Migrations skipped"
  else
    say "Migrations"
    migrate
  fi

  say "Starting $tag"
  start_app || roll_back_to "$previous_tag"

  record_release "$previous_tag"
  remove_old_images
  if [ -n "$previous_tag" ] && [ "$previous_tag" != "$tag" ]; then
    echo "to return: send '$previous_tag --skip-migrate' with the $target_env deploy key"
  fi

  say "Traefik"
  check_route
  say "Done: $target_env runs $tag"
}

main
