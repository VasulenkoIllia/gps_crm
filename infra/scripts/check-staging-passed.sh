#!/usr/bin/env bash
# Production takes only a tag whose CI run on main reached a successful deploy-staging job. Needs GH_TOKEN with
# actions: read. CI tags images with the full commit, which is also what the runs API filters on. The job decides, not
# the run: a failed image cleanup turns the run red without saying anything about staging, and a job can be re-run.
set -euo pipefail

readonly RUNS_TO_CHECK=10

tag=${1:?usage: check-staging-passed.sh <tag>}

[[ "$tag" =~ ^sha-[0-9a-f]{40}$ ]] || { echo "::error::tag must be sha-<full commit>" >&2; exit 1; }

run_ids=$(gh run list --workflow ci.yml --branch main --commit "${tag#sha-}" --limit "$RUNS_TO_CHECK" \
  --json databaseId --jq '.[].databaseId')
for run_id in $run_ids; do
  staging=$(gh run view "$run_id" --json jobs --jq '.jobs[] | select(.name == "deploy-staging") | .conclusion')
  if [ "$staging" = success ]; then exit 0; fi
done

echo "::error::no successful deploy-staging on main for $tag" >&2
exit 1
