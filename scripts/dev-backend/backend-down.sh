#!/usr/bin/env bash
# D08g4 flip-on: stops the dev backend started by backend-up.sh. Its data stays
# in the main checkout's .test-runtime/convex-dev/ unless --wipe is given, which
# deletes that deployment's state and nothing else. Jose's content lives there
# once he uses it: copy the folder somewhere private before any --wipe.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MAIN="$(cd "$(git -C "$ROOT" rev-parse --git-common-dir)/.." && pwd)"
STATE="$MAIN/.test-runtime/convex-dev"
PIDFILE="$STATE/backend.pid"

if [ -f "$PIDFILE" ]; then
  PID="$(cat "$PIDFILE")"
  # Only stop the process if it really is this backend binary.
  if ps -p "$PID" -o command= 2>/dev/null | grep -Eq "convex-local-backend.*--instance-name codedetails-dev( |\$)"; then
    kill "$PID"
    for _ in $(seq 1 20); do ps -p "$PID" >/dev/null 2>&1 || break; sleep 0.25; done
    echo "stopped dev Convex backend (pid $PID)"
  fi
  rm -f "$PIDFILE"
fi

if [ "${1:-}" = "--wipe" ]; then
  rm -rf "${STATE:?}" "${MAIN:?}/.test-runtime/convex-dev.env"
  echo "removed $STATE"
fi
