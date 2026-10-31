#!/usr/bin/env bash
# CI gate: every commit in the range has the expected author and no co-author.
#
#   check-commits.sh <expected author email> <base sha or empty> <head sha>
#
# An empty, all-zero or unknown base (first push, force push) checks the whole history of head.
set -euo pipefail

expected_email=${1:-}
base=${2:-}
head=${3:?usage: check-commits.sh <email> <base> <head>}

[ -n "$expected_email" ] || { echo "::error::repository variable COMMIT_AUTHOR_EMAIL is not set" >&2; exit 1; }

if [[ "$base" =~ ^0*$ ]] || ! git cat-file -e "$base^{commit}" 2>/dev/null; then
  range=$head
else
  range=$base..$head
fi

failed=false
checked=0
while read -r commit; do
  checked=$((checked + 1))
  author=$(git show -s --format=%ae "$commit")
  if [ "$author" != "$expected_email" ]; then
    echo "::error::$commit has another author"
    failed=true
  fi
  if git show -s --format=%B "$commit" | grep -qi '^co-authored-by:'; then
    echo "::error::$commit has a Co-authored-by trailer"
    failed=true
  fi
done < <(git rev-list "$range")

echo "checked $checked commits in $range"
[ "$failed" = false ]
