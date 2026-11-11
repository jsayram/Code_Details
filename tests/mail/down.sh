#!/usr/bin/env bash
# Stops and removes the Mailpit container from tests/mail/up.sh, with every
# message in it (there is no volume). The pinned image stays cached; remove it
# with `docker image rm axllent/mailpit:v1.32.0` if wanted.
set -euo pipefail
NAME=codedetails-mailpit
if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  docker rm -f "$NAME" >/dev/null
  echo "removed $NAME"
else
  echo "$NAME is not running"
fi
