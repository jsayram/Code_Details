#!/usr/bin/env bash
# Stops the task-owned local Convex backend started by tests/convex/up.sh.
# Data stays in .test-runtime/convex/ unless --wipe is given.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STATE="$ROOT/.test-runtime/convex"
PIDFILE="$STATE/backend.pid"

if [ -f "$PIDFILE" ]; then
  PID="$(cat "$PIDFILE")"
  # Only stop the process if it really is our backend binary.
  if ps -p "$PID" -o command= 2>/dev/null | grep -q "convex-local-backend.*codedetails-phase-c"; then
    kill "$PID"
    for _ in $(seq 1 20); do ps -p "$PID" >/dev/null 2>&1 || break; sleep 0.25; done
    echo "stopped local Convex backend (pid $PID)"
  fi
  rm -f "$PIDFILE"
fi

if [ "${1:-}" = "--wipe" ]; then
  rm -rf "$STATE" "$ROOT/.test-runtime/convex.env"
  echo "removed $STATE"
fi
