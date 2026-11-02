#!/usr/bin/env bash
# CI job "db-tests": RLS/RPC behaviour tests in PGlite plus the generated-types check.
# The test package is supabase/tests/package.json (BE-01, backend owns it):
#   npm test            runs rls.test.mjs against supabase/migrations (exits 1 on any FAIL)
#   npm run check:types fails when src/types/database.ts is stale
# Turns on when supabase/tests/package.json exists; skips cleanly before that.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

pkg=supabase/tests
[ -f "$pkg/package.json" ] || skip db-tests "$pkg/package.json not on this branch yet (BE-01)."

npm_install "$pkg"

echo "== npm test ($pkg)"
npm --prefix "$pkg" test

echo "== npm run check:types ($pkg)"
if has_script "$pkg" check:types; then
  npm --prefix "$pkg" run check:types
else
  echo "::warning title=db-tests::no check:types script in $pkg/package.json; generated types not checked."
fi
