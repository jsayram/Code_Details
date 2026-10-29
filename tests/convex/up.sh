#!/usr/bin/env bash
# Starts the task-owned local Convex backend (Phase C, C07): one process bound
# to 127.0.0.1 only (3210 client, 3211 site in test slot 0), beacon off, all
# state under .test-runtime/convex/ (.test-runtime/slot-<n>/convex/ in slot n).
# No Convex account, no cloud deployment, no .env file written. It only ever
# holds synthetic fixtures. Stop it with tests/convex/down.sh (--wipe drops
# its data).
#
# Usage: [CODEDETAILS_TEST_SLOT=n] tests/convex/up.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VERSION=precompiled-2026-10-22-1447815
BIN="$HOME/.cache/convex/binaries/$VERSION/convex-local-backend"
# Ports, instance name and state folder come from the active test slot
# (CODEDETAILS_TEST_SLOT, tests/support/slot.cjs). Slot 0: codedetails-phase-c
# on 3210/3211, state in .test-runtime/.
SLOT_VARS="$(node "$ROOT/tests/support/slot.cjs" --shell)"
eval "$SLOT_VARS"
NAME=$SLOT_CONVEX_INSTANCE
PORT=$SLOT_CONVEX_PORT
SITE_PORT=$SLOT_CONVEX_SITE_PORT
RUNTIME="$ROOT/$SLOT_RUNTIME_DIR"
STATE="$RUNTIME/convex"
CONFIG="$STATE/deployment.json"
ENV_FILE="$RUNTIME/convex.env"

umask 077
mkdir -p "$STATE/storage"

[ -x "$BIN" ] || { echo "local backend $VERSION not found at $BIN" >&2; exit 1; }
for p in $PORT $SITE_PORT; do
  if lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null 2>&1; then echo "port $p is in use" >&2; exit 1; fi
done

# Instance secret and admin key are created once per state folder and are
# throwaway: they only open this local backend.
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
    echo "local Convex backend $VERSION on 127.0.0.1:$PORT (pid $(cat "$STATE/backend.pid"))"
    exit 0
  fi
  sleep 0.5
done
echo "local Convex backend did not start; see $STATE/backend.log" >&2
exit 1
