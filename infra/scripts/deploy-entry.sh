#!/usr/bin/env bash
# Target of the restricted deploy keys: command=".../deploy-entry.sh <env>",restrict in authorized_keys. The key fixes
# the environment, the client only names a tag. Installed once, by hand, outside any release.
#
# compose.yml and deploy.sh come out of the image, but they run on a shared host with access to Docker, which is root
# in all but name. So only a pair the owner approved runs: pushing an image can change the app inside its container,
# never the host. An ordinary release does not touch the pair and goes through on its own.
set -euo pipefail
umask 077

readonly IMAGE_REPO=ghcr.io/vasulenkoillia/gps_crm
readonly PROJECTS_ROOT=/var/www/projects
readonly APPROVED_INFRA=$PROJECTS_ROOT/gps_crm_deploy/approved-infra.sha256
readonly PULL_ATTEMPTS=3
# A GHCR layer can stall mid-download without failing
readonly PULL_TIMEOUT_SECONDS=360
# A cancelled CI run leaves its rollout going on the server: the next deploy waits for it instead of failing
readonly LOCK_WAIT_SECONDS=900

die() { echo "deploy-entry: $1" >&2; exit 1; }

target_env=${1:-}
[[ "$target_env" =~ ^(staging|production)$ ]] || die "authorized_keys must name the environment"

command_re='^(sha-[0-9a-f]{7,40})( --skip-migrate)?$'
[[ "${SSH_ORIGINAL_COMMAND:-}" =~ $command_re ]] || die "expected: <sha-tag> [--skip-migrate]"
tag=${BASH_REMATCH[1]}
skip_migrate=${BASH_REMATCH[2]:-}
skip_migrate=${skip_migrate# }

env_dir=$PROJECTS_ROOT/gps_crm_$target_env
[ -f "$env_dir/.env" ] || die "$env_dir/.env is missing"

exec 9>"$env_dir/.deploy.lock"
if ! flock -n 9; then
  echo "deploy-entry: waiting for the running deploy of $target_env, its output is in deploy.log"
  flock -w "$LOCK_WAIT_SECONDS" 9 || die "another deploy of $target_env is still running"
fi

# A sha tag never changes, so an image kept on the server needs no registry: a rollback works without GHCR or a token
image=$IMAGE_REPO:$tag
if ! docker image inspect "$image" >/dev/null 2>&1; then
  pulled=false
  for attempt in $(seq 1 "$PULL_ATTEMPTS"); do
    if timeout "$PULL_TIMEOUT_SECONDS" docker pull --quiet "$image"; then pulled=true; break; fi
    echo "deploy-entry: pull attempt $attempt failed" >&2
  done
  [ "$pulled" = true ] || die "could not pull $image"
fi

# Only the two files, not the folder: the image is not trusted yet, and a tree from it could hold anything
release_new=$env_dir/release.new
rm -rf "$release_new"
mkdir -p "$release_new/scripts"
container=$(docker create "$image")
if ! docker cp "$container:/app/infra/compose.yml" "$release_new/compose.yml" >/dev/null ||
  ! docker cp "$container:/app/infra/scripts/deploy.sh" "$release_new/scripts/deploy.sh" >/dev/null; then
  docker rm "$container" >/dev/null
  die "could not copy infra out of $image"
fi
docker rm "$container" >/dev/null
[ ! -L "$release_new/compose.yml" ] && [ ! -L "$release_new/scripts/deploy.sh" ] || die "$image holds a symlink in infra"

infra_hash=$(cat "$release_new/compose.yml" "$release_new/scripts/deploy.sh" | sha256sum | cut -d' ' -f1)
grep -qx "$infra_hash" "$APPROVED_INFRA" ||
  die "compose.yml or deploy.sh of $tag is not approved. Read the change, then on the server: echo $infra_hash >> $APPROVED_INFRA"

# release.prev: a rollback must start the old image with the compose file it was built for. Only a release that went
# live may take that place (deploy.sh marks it): after two failed releases in a row the way back is still the good one.
if [ -f "$env_dir/release/.live" ]; then
  rm -rf "$env_dir/release.prev"
  mv "$env_dir/release" "$env_dir/release.prev"
else
  rm -rf "$env_dir/release"
fi
mv "$release_new" "$env_dir/release"

# The rollout has to outlive this session: a cancelled CI run or a dropped connection would otherwise kill it with
# SIGPIPE on its next output, for example between stopping the old container and starting the new one. It runs in a
# session of its own, writes to a file and inherits the lock on fd 9; the SSH client only watches the file.
log_file=$env_dir/deploy.log
: >"$log_file"
setsid --wait bash "$env_dir/release/scripts/deploy.sh" "$target_env" "$tag" ${skip_migrate:+"$skip_migrate"} \
  </dev/null >"$log_file" 2>&1 &
rollout=$!
tail --pid="$rollout" --lines=+1 --follow "$log_file" 9>&- || true
wait "$rollout"
