#!/usr/bin/env bash
# CI job "db-tests": RLS/RPC behaviour tests in PGlite (supabase/tests/).
# Turns on when supabase/package.json exists (BE-01). Preferred entry point: the "test"
# script in supabase/package.json, so backend controls which migrations are applied.
# Fallback: node supabase/tests/rls.test.mjs supabase/migrations/*.sql (sorted).
set -euo pipefail
source "$(dirname "$0")/lib.sh"

[ -f supabase/package.json ] || skip db-tests "supabase/package.json not on this branch yet (BE-01)."
[ -d supabase/tests ] || skip db-tests "supabase/tests/ not on this branch yet."

npm_install supabase

if has_script supabase test; then
  npm test --prefix supabase
else
  shopt -s nullglob
  migrations=(supabase/migrations/*.sql)
  [ ${#migrations[@]} -gt 0 ] || { echo "::error::no migrations in supabase/migrations/"; exit 1; }
  for t in supabase/tests/*.test.mjs; do
    echo "== node $t ${migrations[*]}"
    node "$t" "${migrations[@]}"
  done
fi
