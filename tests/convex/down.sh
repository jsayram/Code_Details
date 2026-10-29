#!/usr/bin/env bash
# Stops the task-owned local Convex backend started by tests/convex/up.sh.
# Data stays in .test-runtime/convex/ (.test-runtime/slot-<n>/convex/ in test
# slot n) unless --wipe is given.
#
# Usage: [CODEDETAILS_TEST_SLOT=n] tests/convex/down.sh [--wipe]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SLOT_VARS="$(node "$ROOT/tests/support/slot.cjs" --shell)"
eval "$SLOT_VARS"
NAME=$SLOT_CONVEX_INSTANCE
RUNTIME="$ROOT/$SLOT_RUNTIME_DIR"
STATE="$RUNTIME/convex"
PIDFILE="$STATE/backend.pid"

if [ -f "$PIDFILE" ]; then
  PID="$(cat "$PIDFILE")"
  # Only stop the process if it really is this slot's backend binary.
  if ps -p "$PID" -o command= 2>/dev/null | grep -Eq "convex-local-backend.*--instance-name $NAME( |\$)"; then
    kill "$PID"
    for _ in $(seq 1 20); do ps -p "$PID" >/dev/null 2>&1 || break; sleep 0.25; done
    echo "stopped local Convex backend (pid $PID)"
  fi
  rm -f "$PIDFILE"
fi

if [ "${1:-}" = "--wipe" ]; then
  rm -rf "$STATE" "$RUNTIME/convex.env"
  echo "removed $STATE"
fi
