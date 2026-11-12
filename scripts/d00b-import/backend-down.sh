#!/usr/bin/env bash
# D00b: stops the import backend started by backend-up.sh. The imported data
# stays in .test-runtime/convex-import/ unless --wipe is given, which is the
# P07 §10 rollback: it deletes the deployment's data and nothing else.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STATE="$ROOT/.test-runtime/convex-import"
PIDFILE="$STATE/backend.pid"

if [ -f "$PIDFILE" ]; then
  PID="$(cat "$PIDFILE")"
  # Only stop the process if it really is our backend binary.
  if ps -ww -p "$PID" -o command= 2>/dev/null | grep -q "convex-local-backend.*codedetails-d00b-import"; then
    kill "$PID"
    for _ in $(seq 1 20); do ps -p "$PID" >/dev/null 2>&1 || break; sleep 0.25; done
    echo "stopped D00b import backend (pid $PID)"
  fi
  rm -f "$PIDFILE"
fi

if [ "${1:-}" = "--wipe" ]; then
  rm -rf "$STATE" "$ROOT/.test-runtime/convex-import.env"
  echo "removed $STATE"
fi
