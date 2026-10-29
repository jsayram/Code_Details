#!/usr/bin/env bash
# Removes only the D00b source container and volume (label codedetails.d00b=source).
set -euo pipefail
LABEL=codedetails.d00b=source
for c in $(docker ps -a --filter "label=$LABEL" -q); do docker rm -f "$c" >/dev/null; done
for v in $(docker volume ls --filter "label=$LABEL" -q); do docker volume rm "$v" >/dev/null; done
echo "removed $LABEL objects; remaining: $(docker ps -a --filter "label=$LABEL" -q | wc -l | tr -d ' ') containers, $(docker volume ls --filter "label=$LABEL" -q | wc -l | tr -d ' ') volumes"
