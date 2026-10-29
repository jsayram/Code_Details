#!/usr/bin/env bash
# D00b: bundles the importer (run.ts) with the repo's esbuild and runs it under
# the loopback-only socket guard, with a minimal environment: no .env file is
# read and nothing but 127.0.0.1 can be reached. Every .env* file is hashed
# before and after; a change fails the run.
#
# Usage: scripts/d00b-import/run.sh <capture dir> <private dir>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
envhash() { (cd "$ROOT" && for f in .env*; do [ -f "$f" ] && shasum -a 256 "$f"; done) | shasum -a 256; }
BEFORE="$(envhash)"
BUNDLE="$ROOT/.test-runtime/convex-import/run.cjs"
"$ROOT/node_modules/.bin/esbuild" "$ROOT/scripts/d00b-import/run.ts" --bundle --platform=node --format=cjs \
  --packages=external --log-level=warning --outfile="$BUNDLE"
set +e
env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" \
  NODE_OPTIONS="--import $ROOT/tests/e2e/server-net-guard.mjs" \
  node "$BUNDLE" "$@"
STATUS=$?
set -e
[ "$(envhash)" = "$BEFORE" ] || { echo "an .env file changed during the import" >&2; exit 2; }
exit $STATUS
