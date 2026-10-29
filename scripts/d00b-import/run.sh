#!/usr/bin/env bash
# D00b: runs the importer (run.ts) under the loopback-only socket guard, with
# a minimal environment: no .env file is read and nothing but 127.0.0.1 can be
# reached. Every .env* file is hashed before and after; a change fails the run.
#
# Usage: scripts/d00b-import/run.sh <capture dir> <private dir>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
envhash() { (cd "$ROOT" && for f in .env*; do [ -f "$f" ] && shasum -a 256 "$f"; done) | shasum -a 256; }
BEFORE="$(envhash)"
set +e
env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" TS_NODE_TRANSPILE_ONLY=1 \
  NODE_OPTIONS="--import $ROOT/tests/e2e/server-net-guard.mjs" \
  node -r ts-node/register "$ROOT/scripts/d00b-import/run.ts" "$@"
STATUS=$?
set -e
[ "$(envhash)" = "$BEFORE" ] || { echo "an .env file changed during the import" >&2; exit 2; }
exit $STATUS
