#!/usr/bin/env bash
# Scheduled backups of one environment, on the deploy user's cron: a dump every 6 hours and a monthly restore check.
# The dump before a deploy stays in deploy.sh; both kinds live in <env dir>/backups.
#
# Installed by hand into gps_crm_deploy, like deploy-entry.sh, and never updated by a release: it runs on the shared host
# with access to Docker, so a new image must not be able to change it. The server is shared: this script touches only
# the database container of its own compose project, its own files and one throwaway container of its own, and never
# uses prune, `down -v` or anything host-wide.
#
#   backup.sh <staging|production> dump    dump, read the dump back in full, rotate
#   backup.sh <staging|production> check   restore the newest scheduled dump into a throwaway database, compare it with
#                                          the live one
set -euo pipefail
umask 077
# One zone for the names and the status file, one order for sort, comm and join: the host's settings are not ours
export TZ=UTC LC_ALL=C
# Cron's PATH stops at /usr/bin:/bin. Set here, not in the crontab: a PATH line there changes other projects' jobs too.
export PATH=$PATH:/usr/local/bin

readonly SCHEDULED_TO_KEEP=8
readonly DAILY_TO_KEEP=7
readonly WEEKLY_TO_KEEP=4
# The disk is shared: a dump that fills it stops every other project on the host
readonly MIN_FREE_MB=2048
# Above the worst case of a deploy, which holds the lock: see the timeout of deploy-staging in ci.yml
readonly LOCK_WAIT_SECONDS=3600
# A dump stuck on the database would hold the deploy lock for good and never reach the status file
readonly STEP_TIMEOUT_SECONDS=3600
readonly CLEANUP_TIMEOUT_SECONDS=60
readonly CHECK_READY_TIMEOUT_SECONDS=120
readonly CHECK_MEM_LIMIT=1g
# Smaller tables are not compared: the rows added since the dump could be most of them
readonly ROWS_COMPARED_FROM=20

# The newest migration a database has finished: what tells a dump that predates a deploy from a broken one
readonly LATEST_MIGRATION_SQL="select coalesce(max(migration_name), '') from _prisma_migrations
  where finished_at is not null and rolled_back_at is null;"
# What the runtime role may do to each table. The catalog, not information_schema: that one shows a grant only to the role
# that made it, and the two databases are read by different users.
readonly GRANTS_SQL="select c.oid::regclass::text || chr(9) || string_agg(a.privilege_type, ',' order by a.privilege_type)
  from pg_class c cross join lateral aclexplode(c.relacl) a
  join pg_roles r on r.oid = a.grantee
  where r.rolname = 'gps_crm_app' and c.relkind in ('r', 'p')
  group by c.oid;"
# Before the restore: a dump holds no roles, and the throwaway cluster has only its own superuser
readonly CREATE_ROLES_SQL="select format('create role %I', name)
  from unnest(array[:'owner', 'gps_crm_app']) as name
  where not exists (select 1 from pg_roles where rolname = name) \\gexec"
# Every table and its row count. It names no table: a list here is how a future table would be missed.
readonly TABLE_ROWS_SQL="select format('%I.%I', schemaname, tablename) || chr(9) ||
    (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', schemaname, tablename),
      false, true, '')))[1]::text
  from pg_tables where schemaname not in ('pg_catalog', 'information_schema');"

target_env=${1:-}
mode=${2:-}
if ! [[ "$target_env" =~ ^(staging|production)$ && "$mode" =~ ^(dump|check)$ ]]; then
  echo "usage: backup.sh <staging|production> <dump|check>" >&2
  exit 64
fi

project=gps_crm_$target_env
env_dir=$(cd "$(dirname "$0")/.." && pwd)/$project
# Before the trap: the status file must not create the folder of an environment that does not exist
[ -d "$env_dir" ] || { echo "backup: $env_dir is missing" >&2; exit 78; }
dump_dir=$env_dir/backups
status_dir=$env_dir/backup-status
check_container=$project-restore-check
check_lock=$env_dir/.restore-check.lock

db=
reason=unknown
status_extra=
partial_dump=
scratch=
is_check_db_started=

say() { echo "$(date +%Y-%m-%dT%H:%M:%SZ) $target_env $mode: $1"; }

# The reason is a code from this script, the only part of a failure the status file carries: the sentence goes to the
# log and can name tables or paths.
fail() {
  reason=$1
  say "FAILED: $2" >&2
  exit 1
}

# What the «Система» screen will read over a read-only mount, so world-readable and free of anything secret. Numbers
# and codes only, which is why plain printf can write the JSON. A chain, because on_exit runs without errexit: on a full
# disk a failed printf must stop here, not end in a truncated file replacing a good one.
write_status() {
  local code=$1 file=$status_dir/$mode.json now last_ok last_ok_json=null ok=true reason_json=null
  now=$(date +%Y-%m-%dT%H:%M:%SZ)
  last_ok=$(sed -n 's/.*"lastOkAt":"\([^"]*\)".*/\1/p' "$file" 2>/dev/null || true)
  if [ "$code" -eq 0 ]; then
    last_ok=$now
  else
    ok=false
    reason_json="\"$reason\""
    status_extra=
  fi
  [ -z "$last_ok" ] || last_ok_json="\"$last_ok\""
  mkdir -p "$status_dir" && chmod 755 "$status_dir" &&
    printf '{"schema":1,"environment":"%s","finishedAt":"%s","ok":%s,"reason":%s,"lastOkAt":%s%s}\n' \
      "$target_env" "$now" "$ok" "$reason_json" "$last_ok_json" "$status_extra" >"$file.tmp" &&
    chmod 644 "$file.tmp" && mv -f "$file.tmp" "$file"
}

# --foreground: Ctrl-C of a run started by hand has to reach docker too, or it waits for the end of the step
timed() {
  timeout --foreground "$STEP_TIMEOUT_SECONDS" "$@"
}

# -v every time: the image keeps its data in a volume of its own, and without it a restored copy of the database stays
# on the disk as an anonymous volume
remove_check_db() {
  local errors
  # Kept only for a failure: on success docker can still name a container that was not there, and that is the usual case
  errors=$(timeout --foreground "$CLEANUP_TIMEOUT_SECONDS" docker rm -f -v "$check_container" 2>&1 >/dev/null) && return 0
  say "could not remove $check_container, a restored copy of the database is still on the disk: $errors" >&2
  return 1
}

# No errexit here: whatever fails, the run still has to report itself
on_exit() {
  local code=$?
  trap - EXIT
  set +e
  [ -z "$partial_dump" ] || rm -f "$partial_dump"
  [ -z "$scratch" ] || rm -rf "$scratch"
  if [ -n "$is_check_db_started" ] && ! remove_check_db && [ "$code" -eq 0 ]; then
    reason=cleanup
    code=1
  fi
  if ! write_status "$code"; then
    say "could not write the status file" >&2
    [ "$code" -ne 0 ] || code=1
  fi
  exit "$code"
}
trap on_exit EXIT
trap 'exit 143' TERM INT

# The lock deploy-entry.sh holds for a whole rollout: a dump must not meet the db container being replaced, and a
# deploy waits for a dump the way it waits for a cancelled run. A scheduled run waits instead of skipping, because a
# deploy takes a dump of its own but says nothing in the status file.
take_deploy_lock() {
  exec 9>"$env_dir/.deploy.lock"
  flock -w "$LOCK_WAIT_SECONDS" 9 || fail lock "a deploy held the lock for $LOCK_WAIT_SECONDS s"
}

find_db() {
  db=$(docker ps \
    --filter "label=com.docker.compose.project=$project" \
    --filter "label=com.docker.compose.service=db" \
    --filter "health=healthy" \
    --format '{{.Names}}') || fail no-db "docker did not answer"
  [ -n "$db" ] && [[ "$db" != *$'\n'* ]] || fail no-db "expected one healthy db container of $project, found: ${db:-none}"
}

# Empty before the first dump. Scheduled dumps only: they appear whole, by mv, while deploy.sh writes its dump under the
# final name and leaves it there when the read check fails.
newest_dump() {
  # shellcheck disable=SC2012 # the names carry the date, so they sort newest first
  ls -1r "$dump_dir"/scheduled-*.dump 2>/dev/null | sed -n 1p || true
}

ensure_free_space() {
  local sample=$1 factor=$2 bytes=0 needed_mb free_mb
  [ -z "$sample" ] || bytes=$(wc -c <"$sample")
  needed_mb=$((bytes * factor / 1048576 + MIN_FREE_MB))
  free_mb=$(df -Pk "$env_dir" | awk 'NR == 2 { print int($4 / 1024) }')
  [ "$free_mb" -ge "$needed_mb" ] || fail disk "only $free_mb MB free, $needed_mb MB needed"
}

keep_newest() {
  local prefix=$1 count=$2
  # shellcheck disable=SC2012 # the names carry the date, so they sort newest first
  ls -1r "$dump_dir/$prefix"-*.dump | tail -n +$((count + 1)) | while read -r old_dump; do
    rm -f "$old_dump"
  done
}

# Hard links: a daily or weekly copy is the same file as its scheduled dump, so a dump kept in two rows costs the disk
# once. Called only after the read-back: a run that failed never clears an older copy.
rotate() {
  local dump=$1 day=$2 week=$3
  [ -e "$dump_dir/daily-$day.dump" ] || ln "$dump" "$dump_dir/daily-$day.dump"
  [ -e "$dump_dir/weekly-$week.dump" ] || ln "$dump" "$dump_dir/weekly-$week.dump"
  keep_newest scheduled "$SCHEDULED_TO_KEEP"
  keep_newest daily "$DAILY_TO_KEEP"
  keep_newest weekly "$WEEKLY_TO_KEEP"
}

# A check killed outright, by a reboot or the OOM killer, leaves a restored copy of the database behind. The lock tells
# that from a check still running. A failure here is logged and does not cost the dump.
remove_leftover_check_db() {
  {
    if flock -n 8; then remove_check_db || true; fi
  } 8>"$check_lock" || say "could not open $check_lock: a leftover check was not looked for" >&2
}

take_dump() {
  local stamp dump bytes copies
  take_deploy_lock
  remove_leftover_check_db
  find_db
  ensure_free_space "$(newest_dump)" 2
  mkdir -p "$dump_dir"
  chmod 700 "$dump_dir"
  rm -f "$dump_dir"/*.part
  stamp=$(date +%Y%m%d-%H%M%S)
  dump=$dump_dir/scheduled-$stamp.dump
  partial_dump=$dump.part
  # shellcheck disable=SC2016 # $POSTGRES_* expand inside the db container, on purpose
  timed docker exec "$db" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' >"$partial_dump" ||
    fail dump "pg_dump failed with exit $?"
  # In full, not --list: a dump cut off halfway still lists its contents
  timed docker exec -i "$db" pg_restore -f /dev/null <"$partial_dump" ||
    fail read-back "the dump does not read back, exit $?"
  mv "$partial_dump" "$dump"
  partial_dump=
  rotate "$dump" "${stamp%-*}" "$(date +%GW%V)"
  bytes=$(wc -c <"$dump" | tr -d ' ')
  # shellcheck disable=SC2012 # counts inodes: a hard link of the rotation is not another copy
  copies=$(ls -1i "$dump_dir"/*.dump | awk '{ print $1 }' | sort -u | wc -l | tr -d ' ')
  status_extra=$(printf ',"dumpBytes":%s,"copies":%s' "$bytes" "$copies")
  say "$(basename "$dump"), $bytes bytes, $copies different dumps kept"
}

start_check_db() {
  local image=$1
  remove_check_db || fail cleanup "an older throwaway database is in the way"
  is_check_db_started=true
  # `trust` is safe only because this container has no network: every query here is a `docker exec`
  docker run -d --name "$check_container" --network none --user postgres --cap-drop ALL \
    --security-opt no-new-privileges --memory "$CHECK_MEM_LIMIT" \
    -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=restore_check "$image" >/dev/null ||
    fail restore "the throwaway database did not start"
  # Over TCP: while the image initialises, a temporary server answers on the socket only
  for _ in $(seq 1 "$CHECK_READY_TIMEOUT_SECONDS"); do
    if docker exec "$check_container" pg_isready -q -h 127.0.0.1 -U postgres -d restore_check >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  docker logs --tail 20 "$check_container" >&2 || true
  fail restore "the throwaway database did not become ready"
}

# The two roles every restore has to find: RESTORE.md. A dump that names a third one fails here, which is the point.
create_check_roles() {
  local owner
  owner=$(timed docker exec "$db" printenv POSTGRES_USER) || fail live "could not read the owner role of $db"
  timed docker exec -i "$check_container" psql -U postgres -d restore_check -v ON_ERROR_STOP=1 -X -q \
    -v owner="$owner" <<<"$CREATE_ROLES_SQL" || fail restore "the roles of the dump could not be created"
}

# With owners and privileges, the way RESTORE.md restores: a copy that drops them would pass with the grants of the
# runtime role gone. Errors go to a file: in a line of pg_restore the server goes on to quote the failing row after the
# colon, and rows hold personal data, so the log gets only the start of it and the entry that failed, which names a
# table and no row. A first line of another kind, such as docker's own error, stays whole.
restore_dump() {
  local dump=$1 code=0
  timed docker exec -i "$check_container" pg_restore -U postgres -d restore_check \
    --exit-on-error --single-transaction <"$dump" 2>"$scratch/restore-errors" || code=$?
  [ "$code" -ne 0 ] || return 0
  sed -n -e 's/^\(pg_restore: error: [^:]*\):.*/\1/p' -e '/^pg_restore: from TOC entry/p' \
    -e '1{/^pg_restore: /!p;}' "$scratch/restore-errors" >&2
  fail restore "$(basename "$dump") did not restore, exit $code"
}

# Read-only by the session's setting, not by promise
live_sql() {
  # shellcheck disable=SC2016 # $POSTGRES_* expand inside the db container, on purpose
  timed docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' "$db" \
    sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -X -q -At'
}

restored_sql() {
  timed docker exec -i "$check_container" psql -U postgres -d restore_check -v ON_ERROR_STOP=1 -X -q -At
}

compare_with_live() {
  local dump_name=$1 tab=$'\t' live_head restored_head differ short tables tables_compared=false
  live_head=$(live_sql <<<"$LATEST_MIGRATION_SQL") || fail live "could not read the live database"
  restored_head=$(restored_sql <<<"$LATEST_MIGRATION_SQL") || fail tables "could not read the restored database"
  live_sql <<<"$TABLE_ROWS_SQL" | sort >"$scratch/live" || fail live "could not count the live tables"
  restored_sql <<<"$TABLE_ROWS_SQL" | sort >"$scratch/restored" || fail rows "could not count the restored tables"
  tables=$(wc -l <"$scratch/restored" | tr -d ' ')

  [ -n "$restored_head" ] || fail tables "$dump_name holds no finished migration"
  if [ "$live_head" = "$restored_head" ]; then
    differ=$(comm -3 <(cut -f1 "$scratch/live") <(cut -f1 "$scratch/restored") | tr -d '\t' | tr '\n' ' ')
    [ -z "$differ" ] || fail tables "the restored tables differ from the live ones: $differ"
    live_sql <<<"$GRANTS_SQL" | sort >"$scratch/live-grants" || fail live "could not read the live grants"
    restored_sql <<<"$GRANTS_SQL" | sort >"$scratch/restored-grants" || fail grants "could not read the restored grants"
    differ=$(comm -3 "$scratch/live-grants" "$scratch/restored-grants" | tr -s '\t\n' ' ')
    [ -z "$differ" ] || fail grants "the grants of the runtime role differ from the live ones: $differ"
    tables_compared=true
  elif [[ "$restored_head" < "$live_head" ]]; then
    # Normal right after a deploy: the sets of tables are not comparable then
    say "$dump_name predates migration $live_head: table sets not compared"
  else
    fail tables "$dump_name is ahead of the live database: $restored_head"
  fi

  # Within reach, not equal: the live database moved on after the dump
  short=$(join -t "$tab" "$scratch/live" "$scratch/restored" |
    awk -F "$tab" -v from="$ROWS_COMPARED_FROM" \
      '$2 >= from && $3 < $2 / 2 { printf "%s (%s live, %s restored) ", $1, $2, $3 }')
  [ -z "$short" ] || fail rows "far fewer rows than the live database: $short"

  status_extra=$(printf ',"dump":"%s","tables":%s,"tablesCompared":%s' "$dump_name" "$tables" "$tables_compared")
  say "$dump_name restores: $tables tables"
}

check_restore() {
  local dump dump_name image
  exec 8>"$check_lock"
  flock -n 8 || fail busy "another check is running"
  dump=$(newest_dump)
  [ -n "$dump" ] || fail no-dump "no scheduled dump in $dump_dir"
  dump_name=$(basename "$dump")
  # Tables and indexes take several times the space of a compressed dump
  ensure_free_space "$dump" 5
  find_db
  image=$(docker inspect -f '{{.Config.Image}}' "$db") || fail live "could not read the image of $db"
  scratch=$(mktemp -d)
  start_check_db "$image"
  create_check_roles
  say "restoring $dump_name into a throwaway database"
  restore_dump "$dump"
  # Only now: a long restore must not hold up a deploy, and the comparison must not meet the db container being replaced
  take_deploy_lock
  find_db
  compare_with_live "$dump_name"
}

case $mode in
  dump) take_dump ;;
  check) check_restore ;;
esac
