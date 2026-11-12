#!/usr/bin/env bash
# Spin up a throwaway local Postgres, load shim + all migrations, then run SQL tests.
# Usage: ./scripts-pg.sh   (needs postgresql installed: /usr/lib/postgresql/*/bin)
set -euo pipefail
cd "$(dirname "$0")"
BIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1)
DATA=${PGDATA_DIR:-/tmp/kw-pgdata}
PORT=${PGPORT_KW:-54329}
RUN="su postgres -c"
if [ "$(id -u)" != "0" ]; then RUN="bash -c"; fi

rm -rf "$DATA"; mkdir -p "$DATA"; chown postgres "$DATA" 2>/dev/null || true
$RUN "$BIN/initdb -D $DATA -A trust >/dev/null"
$RUN "$BIN/pg_ctl -D $DATA -o '-p $PORT -k /tmp' -l $DATA/log -w start >/dev/null"
trap '$RUN "$BIN/pg_ctl -D '"$DATA"' -m immediate stop >/dev/null" || true' EXIT

PSQL="$BIN/psql -h /tmp -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"
$PSQL -d postgres -c "create database kw" >/dev/null
$PSQL -d kw -f supabase/tests/shim.sql >/dev/null
for f in supabase/migrations/*.sql; do
  echo "== migration: $f"
  $PSQL -d kw -f "$f" >/dev/null
done
for t in supabase/tests/*.test.sql; do
  [ -e "$t" ] || continue
  echo "== test: $t"
  if ! out=$($PSQL -tA -d kw -f "$t" 2>&1); then
    echo "$out" | grep -E "ok - |FAIL|ERROR" || echo "$out"
    echo "SQL TESTS FAILED"; exit 1
  fi
  echo "$out" | grep -E "ok - |FAIL|ERROR" || true
done
echo "ALL SQL TESTS PASSED"
