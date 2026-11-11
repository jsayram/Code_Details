#!/usr/bin/env bash
# D08e: stops the manual-check backend started by backend-up.sh. Its data and
# env vars (including any real GitHub values) stay in
# .test-runtime/convex-manual/ unless --wipe is given, which deletes that
# deployment's state and nothing else.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STATE="$ROOT/.test-runtime/convex-manual"
PIDFILE="$STATE/backend.pid"

if [ -f "$PIDFILE" ]; then
  PID="$(cat "$PIDFILE")"
  # Only stop the process if it really is our backend binary.
  if ps -p "$PID" -o command= 2>/dev/null | grep -q "convex-local-backend.*codedetails-d08e-manual"; then
    kill "$PID"
    for _ in $(seq 1 20); do ps -p "$PID" >/dev/null 2>&1 || break; sleep 0.25; done
    echo "stopped D08e manual backend (pid $PID)"
  fi
  rm -f "$PIDFILE"
fi

if [ "${1:-}" = "--wipe" ]; then
  rm -rf "$STATE" "$ROOT/.test-runtime/convex-manual.env"
  echo "removed $STATE"
fi
