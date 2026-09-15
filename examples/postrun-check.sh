#!/usr/bin/env bash
# postrun-check.sh — make a hollow OK impossible.
# Usage:  postrun-check.sh before  <table>          # snapshot fingerprint (run before your job)
#         postrun-check.sh after   <table> [min_changed_rows]   # exit 1 with a one-line reason if nothing changed
# Needs: psql on PATH and DATABASE_URL (or PG* vars). Fingerprint = row count + md5 of every row, order-independent.
set -euo pipefail
mode="${1:-}"; table="${2:-}"; min="${3:-1}"
[[ -z "$mode" || -z "$table" ]] && { echo "usage: $0 before|after <table> [min_changed_rows]" >&2; exit 2; }
[[ "$table" =~ ^[A-Za-z0-9_.\"]+$ ]] || { echo "refusing suspicious table name: $table" >&2; exit 2; }
snap="${TMPDIR:-/tmp}/postrun-check.$(echo "$table" | tr -c 'A-Za-z0-9' '_').snap"
fingerprint() {
  psql "${DATABASE_URL:-}" -X -A -t -v ON_ERROR_STOP=1 -c \
    "SELECT count(*) || ':' || coalesce(md5(string_agg(h, ',' ORDER BY h)),'empty') FROM (SELECT md5(t::text) AS h FROM $table t) s;"
}
changed_rows() {  # rows whose fingerprint is new since the snapshot (needs the per-row list)
  psql "${DATABASE_URL:-}" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT md5(t::text) FROM $table t" | sort > "$snap.rows.after"
  comm -13 "$snap.rows.before" "$snap.rows.after" | wc -l | tr -d ' '
}
case "$mode" in
  before)
    fingerprint > "$snap"
    psql "${DATABASE_URL:-}" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT md5(t::text) FROM $table t" | sort > "$snap.rows.before"
    echo "snapshot $table $(cat "$snap")";;
  after)
    [[ -f "$snap" ]] || { echo "FAIL $table: no 'before' snapshot found; run 'postrun-check.sh before $table' first" ; exit 1; }
    before=$(cat "$snap"); after=$(fingerprint)
    if [[ "$before" == "$after" ]]; then echo "FAIL $table: fingerprint unchanged ($after) — the job reported success but touched no rows"; exit 1; fi
    n=$(changed_rows)
    if (( n < min )); then echo "FAIL $table: only $n changed rows, expected at least $min"; exit 1; fi
    echo "OK $table: $n changed rows ($before -> $after)";;
  *) echo "unknown mode $mode" >&2; exit 2;;
esac
