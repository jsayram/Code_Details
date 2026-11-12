#!/usr/bin/env bash
# D00b source: restores P02 capture <capture dir> into a task-owned Postgres
# container for the one-time import (P07 §10). Same image as the capture,
# --network none, no published ports, C.UTF-8 collation (P02 finding), and a
# throwaway superuser password that never touches disk. After the restore it
# fingerprints every table against the capture, then creates a login role that
# can only read (default_transaction_read_only, SELECT grants only; BYPASSRLS
# because the source tables have RLS on and policies would hide rows); the
# importer reads through `docker exec ... psql -U d00b_reader` and nothing else.
# Never touches supabase_*_Code_Details. Remove with source-down.sh.
#
# Usage: scripts/d00b-import/source-up.sh <capture dir> <evidence dir>
set -euo pipefail

CAP="$(cd "$1" && pwd)"
OUT="$(mkdir -p "$2" && cd "$2" && pwd)"
IMG=public.ecr.aws/supabase/postgres:15.8.1.085
NAME=codedetails-d00b-source
LABEL=codedetails.d00b=source
umask 077

if docker ps -a --filter "label=$LABEL" -q | grep -q .; then echo "a $LABEL container already exists" >&2; exit 1; fi
(cd "$CAP" && shasum -a 256 -c SHA256SUMS --quiet) || { echo "capture checksum mismatch" >&2; exit 1; }
echo "capture SHA256SUMS ok" > "$OUT/source-checksums.txt"

PW="$(openssl rand -hex 24)"
docker volume create --label "$LABEL" "$NAME-data" >/dev/null
docker run -d --name "$NAME" --label "$LABEL" --network none \
  -e POSTGRES_PASSWORD="$PW" -e POSTGRES_INITDB_ARGS="--lc-collate=C.UTF-8 --lc-ctype=en_US.UTF-8" \
  -v "$NAME-data":/var/lib/postgresql/data "$IMG" >/dev/null

for _ in $(seq 1 90); do
  docker exec "$NAME" pg_isready -U postgres -h localhost >/dev/null 2>&1 && break
  sleep 2
done
sleep 5
docker exec "$NAME" pg_isready -U postgres -h localhost >/dev/null

docker cp "$CAP/postgres-full.dump" "$NAME":/tmp/postgres-full.dump
docker cp "$CAP/globals-no-passwords.sql" "$NAME":/tmp/globals.sql
ADMIN=(docker exec -i -e PGPASSWORD="$PW" "$NAME")
"${ADMIN[@]}" psql -h localhost -U supabase_admin -d postgres -X -q -f /tmp/globals.sql > "$OUT/globals.log" 2>&1 || true
"${ADMIN[@]}" pg_restore -h localhost -U supabase_admin -d postgres --clean --if-exists --no-password \
  /tmp/postgres-full.dump > "$OUT/pg_restore.log" 2>&1 || echo "pg_restore exit $?" >> "$OUT/pg_restore.log"
docker exec "$NAME" rm -f /tmp/postgres-full.dump /tmp/globals.sql

# Same fingerprint query as P02 capture.sh / restore-rehearsal.sh.
FINGERPRINT_SQL="$(cat <<'SQL'
select n.nspname, c.relname,
  (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text,
  (xpath('/row/h/text()', query_to_xml(format(
     'select md5(coalesce(string_agg(t::text, chr(10) order by t::text collate "C"), %L)) as h from %I.%I t', '', n.nspname, c.relname), false, true, '')))[1]::text
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r','p')
  and n.nspname not in ('pg_catalog','information_schema','pg_toast')
  and n.nspname not like 'pg_temp%'
order by 1, 2;
SQL
)"
echo "$FINGERPRINT_SQL" | "${ADMIN[@]}" psql -h localhost -U supabase_admin -d postgres -X -q -At -v ON_ERROR_STOP=1 -f - > "$OUT/fingerprint-restored.txt"
if diff -q "$CAP/fingerprint-before.txt" "$OUT/fingerprint-restored.txt" >/dev/null; then echo identical; else echo different; fi > "$OUT/fingerprint.result"
[ "$(cat "$OUT/fingerprint.result")" = identical ] || { echo "restored fingerprint differs from the capture" >&2; exit 1; }
echo "$FINGERPRINT_SQL" > "$OUT/fingerprint.sql"

# Read-only reader. The password is local to the network-less container: it
# only ever authenticates over its own loopback.
RPW="$(openssl rand -hex 24)"
"${ADMIN[@]}" psql -h localhost -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1 -f - <<SQL >/dev/null
create role d00b_reader login password '$RPW' nosuperuser nocreatedb nocreaterole noinherit bypassrls;
alter role d00b_reader set default_transaction_read_only = on;
grant usage on schema public, storage to d00b_reader;
grant select on all tables in schema public, storage to d00b_reader;
SQL
docker exec "$NAME" sh -c "umask 077; printf 'localhost:5432:postgres:d00b_reader:%s\n' '$RPW' > /tmp/.pgpass_reader; chown postgres /tmp/.pgpass_reader"
echo "$NAME" > "$OUT/source-name.txt"
echo "source=$NAME fingerprint=$(cat "$OUT/fingerprint.result")"
