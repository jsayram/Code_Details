#!/usr/bin/env bash
# D08e: starts a third local Convex backend for manual login checks with real
# development providers (Jose, 2026-10-29, "Separate manual backend"), modelled on
# tests/convex/up.sh: one process bound to 127.0.0.1 only (3230 client, 3231
# site), beacon off, all state under .test-runtime/convex-manual/. It is a
# separate deployment from the test backend on 3210 (which tests wipe) and the
# import backend on 3220. Only it ever gets the real GitHub values (see
# set-github-secrets.mjs); tests never call it. No Convex account, no cloud
# deployment, no .env file written. Its users are whoever Jose signs up by hand.
# Stop it with backend-down.sh; --wipe drops its data.
#
# Usage: scripts/dev-auth/backend-up.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VERSION=precompiled-2026-10-22-1447815
BIN="$HOME/.cache/convex/binaries/$VERSION/convex-local-backend"
NAME=codedetails-d08e-manual
PORT=3230
SITE_PORT=3231
STATE="$ROOT/.test-runtime/convex-manual"
CONFIG="$STATE/deployment.json"
ENV_FILE="$ROOT/.test-runtime/convex-manual.env"

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
