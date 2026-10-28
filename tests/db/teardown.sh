#!/usr/bin/env bash
# Removes the task-owned test database created by tests/db/provision.sh, and
# nothing else: each object must carry the codedetails.test=phase-b label.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NAME=codedetails-phaseb-testdb
VOL=$NAME-data

label() { docker "$1" inspect -f '{{index .Config.Labels "codedetails.test"}}' "$2" 2>/dev/null || true; }

if docker container inspect "$NAME" >/dev/null 2>&1; then
  [ "$(label container "$NAME")" = phase-b ] || { echo "refusing: $NAME is not labelled codedetails.test=phase-b" >&2; exit 1; }
  docker rm -f "$NAME" >/dev/null
  echo "removed container $NAME"
fi
if docker volume inspect "$VOL" >/dev/null 2>&1; then
  [ "$(docker volume inspect -f '{{index .Labels "codedetails.test"}}' "$VOL")" = phase-b ] || { echo "refusing: $VOL is not labelled" >&2; exit 1; }
  docker volume rm "$VOL" >/dev/null
  echo "removed volume $VOL"
fi
rm -f "$ROOT/.test-runtime/test-db.json"
