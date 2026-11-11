#!/usr/bin/env bash
# Starts Mailpit for local development email (D08e, Jose 2026-10-29 "Docker,
# pinned"): the image pinned by digest, ports bound to 127.0.0.1 only (UI and
# HTTP API on 8025, SMTP on 1025), no volume, so messages vanish when it
# stops. Auth emails reach it through its send API, /api/v1/send
# (convex/email.ts). Automated tests don't use it; they run their own fake
# receiver. Stop it with tests/mail/down.sh.
#
# Usage: tests/mail/up.sh
set -euo pipefail

IMAGE="axllent/mailpit:v1.32.0@sha256:0790692be935ea4420d085694f7985b1f692ca6a8771ab0e0bd8ba75ac180498"
NAME=codedetails-mailpit

if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  echo "$NAME already exists; run tests/mail/down.sh first" >&2
  exit 1
fi
for p in 8025 1025; do
  if lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null 2>&1; then echo "port $p is in use" >&2; exit 1; fi
done

docker run -d --name "$NAME" --label codedetails.purpose=dev-mail \
  -p 127.0.0.1:8025:8025 -p 127.0.0.1:1025:1025 \
  -e MP_DISABLE_VERSION_CHECK=true -e MP_MAX_MESSAGES=500 \
  "$IMAGE" >/dev/null

for _ in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:8025/api/v1/info >/dev/null 2>&1; then
    echo "Mailpit on http://127.0.0.1:8025 (SMTP 127.0.0.1:1025)"
    exit 0
  fi
  sleep 0.5
done
echo "Mailpit did not start; see: docker logs $NAME" >&2
exit 1
