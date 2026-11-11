#!/usr/bin/env bash
# Creates the task-owned test database (Phase B, B08): a labelled Postgres
# container on 127.0.0.1:55432 (55432+n in test slot n) holding the roles and
# schema (no rows) of a P02 capture. The capture is only read. Remove
# everything with tests/db/teardown.sh.
#
# Usage: [CODEDETAILS_TEST_SLOT=n] tests/db/provision.sh [capture dir]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CAP="$(cd "${1:-$ROOT/Agent Planning/private-data-backups/p02-20261028T173830Z}" && pwd)"
IMG=public.ecr.aws/supabase/postgres:15.8.1.085
# Container name, port and state folder come from the active test slot
# (CODEDETAILS_TEST_SLOT, tests/support/slot.cjs). Slot 0:
# codedetails-phaseb-testdb on 55432, state in .test-runtime/.
SLOT_VARS="$(node "$ROOT/tests/support/slot.cjs" --shell)"
eval "$SLOT_VARS"
NAME=$SLOT_DB_CONTAINER
VOL=$NAME-data
LABEL=codedetails.test=phase-b
PORT=$SLOT_DB_PORT
RUNTIME="$ROOT/$SLOT_RUNTIME_DIR"
MARKER=codedetails-phase-b-isolated

umask 077
mkdir -p "$RUNTIME"
LOG="$RUNTIME/provision.log"
: > "$LOG"

verify_capture() { (cd "$CAP" && shasum -a 256 -c SHA256SUMS --quiet) || { echo "capture checksum mismatch: $CAP" >&2; exit 1; }; }

verify_capture
if docker container inspect "$NAME" >/dev/null 2>&1 || docker volume inspect "$VOL" >/dev/null 2>&1; then
  echo "$NAME or $VOL already exists; run tests/db/teardown.sh first" >&2; exit 1
fi
if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then echo "port $PORT is in use" >&2; exit 1; fi

# Throwaway password for this disposable target only.
PW="$(openssl rand -hex 24)"

docker volume create --label "$LABEL" "$VOL" >/dev/null
docker run -d --name "$NAME" --label "$LABEL" -p 127.0.0.1:$PORT:5432 \
  -e POSTGRES_PASSWORD="$PW" -e POSTGRES_INITDB_ARGS="--lc-collate=C.UTF-8 --lc-ctype=en_US.UTF-8" \
  -v "$VOL":/var/lib/postgresql/data "$IMG" >/dev/null

for _ in $(seq 1 90); do
  docker exec "$NAME" pg_isready -U postgres -h localhost >/dev/null 2>&1 && break
  sleep 2
done
sleep 5
docker exec "$NAME" pg_isready -U postgres -h localhost >/dev/null

docker cp "$CAP/postgres-full.dump" "$NAME":/tmp/postgres-full.dump
docker cp "$CAP/globals-no-passwords.sql" "$NAME":/tmp/globals.sql

ADMIN=(docker exec -i -e PGPASSWORD="$PW" "$NAME")
"${ADMIN[@]}" psql -h localhost -U supabase_admin -d postgres -X -q -f /tmp/globals.sql >> "$LOG" 2>&1 || true
"${ADMIN[@]}" pg_restore -h localhost -U supabase_admin -d postgres --schema-only --clean --if-exists --no-password \
  /tmp/postgres-full.dump >> "$LOG" 2>&1 || echo "pg_restore exit $? (see log; pre-existing Supabase objects are expected)" >> "$LOG"
docker exec "$NAME" rm -f /tmp/postgres-full.dump /tmp/globals.sql

# The app connects as postgres. The captured roles carry no passwords, so set one.
"${ADMIN[@]}" psql -h localhost -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1 -v pw="$PW" -v marker="$MARKER" -v cap="$(basename "$CAP")" <<'SQL' >> "$LOG" 2>&1
alter role postgres with login password :'pw';
create schema codedetails_test;
create table codedetails_test.marker (value text primary key, capture text not null, created_at timestamptz not null default now());
insert into codedetails_test.marker (value, capture) values (:'marker', :'cap');
grant usage on schema codedetails_test to postgres;
grant select on codedetails_test.marker to postgres;
SQL

# Check: every public table from the capture exists and is empty.
TABLES="$("${ADMIN[@]}" psql -h localhost -U supabase_admin -d postgres -X -At -c \
  "select string_agg(format('%s=%s', c.relname, (xpath('/row/c/text()', query_to_xml(format('select count(*) c from public.%I', c.relname), false, true, '')))[1]), ' ' order by c.relname)
   from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'")"
EXPECTED="$(awk -F'|' '$1=="public"{print $2}' "$CAP/fingerprint-before.txt" | sort | tr '\n' ' ' | sed 's/ $//')"
ACTUAL="$(echo "$TABLES" | tr ' ' '\n' | cut -d= -f1 | sort | tr '\n' ' ' | sed 's/ $//')"
[ "$EXPECTED" = "$ACTUAL" ] || { echo "public table set differs from capture" >&2; echo "expected: $EXPECTED" >&2; echo "actual:   $ACTUAL" >&2; exit 1; }
echo "$TABLES" | tr ' ' '\n' | grep -v '=0$' && { echo "restored tables are not empty" >&2; exit 1; }

verify_capture

printf '{"container":"%s","port":%s,"password":"%s","capture":"%s"}\n' "$NAME" "$PORT" "$PW" "$(basename "$CAP")" > "$RUNTIME/test-db.json"
chmod 600 "$RUNTIME/test-db.json" "$LOG"
echo "provisioned $NAME on 127.0.0.1:$PORT from $(basename "$CAP"): $(echo "$TABLES" | wc -w | tr -d ' ') empty public tables; capture checksums OK"
