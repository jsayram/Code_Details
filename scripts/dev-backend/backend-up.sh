#!/usr/bin/env bash
# D08g4 flip-on: starts the local Convex backend Jose's dev app uses now that
# Convex is the data default (Jose, 2026-10-30, "Fresh empty backend"), modelled
# on scripts/dev-auth/backend-up.sh: one process bound to 127.0.0.1 only (3240
# client, 3241 site), beacon off. It is separate from the test slots, the import
# backend on 3220 and the manual-check backend on 3230; tests never call it.
# State lives in the MAIN checkout's .test-runtime/convex-dev/ (found from git's
# common dir), so running this from a worktree never puts Jose's data in a
# disposable folder. No Convex account, no cloud deployment, no .env file
# written. Push with `npm run test:convex:push -- --target dev`. Stop it with
# backend-down.sh; --wipe drops its data. Recovery plan:
# Agent Planning/phase-d08/D08G4_LATE_FLIP_REPORT.md (g4 flip-on).
#
# Usage: scripts/dev-backend/backend-up.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MAIN="$(cd "$(git -C "$ROOT" rev-parse --git-common-dir)/.." && pwd)"
VERSION=precompiled-2026-10-22-1447815
BIN="$HOME/.cache/convex/binaries/$VERSION/convex-local-backend"
NAME=codedetails-dev
PORT=3240
SITE_PORT=3241
STATE="$MAIN/.test-runtime/convex-dev"
CONFIG="$STATE/deployment.json"
ENV_FILE="$MAIN/.test-runtime/convex-dev.env"

umask 077
mkdir -p "$STATE/storage"

[ -x "$BIN" ] || { echo "local backend $VERSION not found at $BIN" >&2; exit 1; }
for p in $PORT $SITE_PORT; do
  if lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null 2>&1; then echo "port $p is in use" >&2; exit 1; fi
done

# Instance secret and admin key are created once per state folder: they only
# open this local backend.
if [ ! -f "$CONFIG" ]; then
  SECRET="$(openssl rand -hex 32)"
  KEY="$("$BIN" keygen admin-key --instance-name "$NAME" --instance-secret "$SECRET")"
  printf '{"instanceName":"%s","instanceSecret":"%s","adminKey":"%s"}\n' "$NAME" "$SECRET" "$KEY" > "$CONFIG"
fi
SECRET="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["instanceSecret"])' "$CONFIG")"
KEY="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["adminKey"])' "$CONFIG")"

# What the Convex CLI reads for a self-hosted target (used with --env-file).
printf 'CONVEX_SELF_HOSTED_URL=http://127.0.0.1:%s\nCONVEX_SELF_HOSTED_ADMIN_KEY=%s\n' "$PORT" "$KEY" > "$ENV_FILE"

nohup "$BIN" \
  --interface 127.0.0.1 --port $PORT --site-proxy-port $SITE_PORT \
  --convex-origin "http://127.0.0.1:$PORT" --convex-site "http://127.0.0.1:$SITE_PORT" \
  --instance-name "$NAME" --instance-secret "$SECRET" \
  --local-storage "$STATE/storage" --disable-beacon \
  "$STATE/backend.sqlite3" > "$STATE/backend.log" 2>&1 &
echo $! > "$STATE/backend.pid"

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$PORT/version" >/dev/null 2>&1; then
    echo "dev Convex backend $VERSION on 127.0.0.1:$PORT (pid $(cat "$STATE/backend.pid")), state in $STATE"
    exit 0
  fi
  sleep 0.5
done
echo "dev Convex backend did not start; see $STATE/backend.log" >&2
exit 1
