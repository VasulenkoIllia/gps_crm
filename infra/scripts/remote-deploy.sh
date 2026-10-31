#!/usr/bin/env bash
# CI side of a deploy: sends the tag over SSH. On the server the key's command= fixes the environment and takes it from
# there, so the job picks the environment by the key it holds.
# Reads DEPLOY_SSH_KEY, DEPLOY_HOST, DEPLOY_USER and DEPLOY_KNOWN_HOSTS from the environment.
set -euo pipefail

tag=${1:?usage: remote-deploy.sh <tag>}

[[ "$tag" =~ ^sha-[0-9a-f]{7,40}$ ]] || { echo "::error::tag must look like sha-<commit>" >&2; exit 1; }
: "${DEPLOY_SSH_KEY:?}" "${DEPLOY_HOST:?}" "${DEPLOY_USER:?}" "${DEPLOY_KNOWN_HOSTS:?}"

ssh_dir=$(mktemp -d)
trap 'rm -rf "$ssh_dir"' EXIT
printf '%s\n' "$DEPLOY_SSH_KEY" >"$ssh_dir/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" >"$ssh_dir/known_hosts"
chmod 600 "$ssh_dir/key"

# Keepalives instead of a command timeout: a slow pull is fine, a dead connection is not. The job timeout is the cap.
ssh -i "$ssh_dir/key" \
  -o IdentitiesOnly=yes \
  -o BatchMode=yes \
  -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile="$ssh_dir/known_hosts" \
  -o ConnectTimeout=20 \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=6 \
  "$DEPLOY_USER@$DEPLOY_HOST" "$tag"
