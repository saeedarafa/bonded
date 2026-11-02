#!/usr/bin/env bash
# CI job "app": typecheck, lint and Jest for the Expo app (MOB-01).
# Turns on when the root package.json lands. Each step prefers the app's own npm script
# (typecheck / lint / test) so mobile controls flags; typecheck falls back to tsc --noEmit.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

[ -f package.json ] || skip app "root package.json not on this branch yet (MOB-01)."

npm_install .

echo "== typecheck"
if has_script . typecheck; then
  npm run typecheck
elif [ -f tsconfig.json ]; then
  npx --no-install tsc --noEmit
else
  echo "::warning title=app::no typecheck script and no tsconfig.json; typecheck skipped."
fi

echo "== lint"
if has_script . lint; then
  npm run lint
else
  echo "::warning title=app::no lint script in package.json; lint skipped (MOB-01 adds ESLint)."
fi

echo "== unit tests"
if has_script . test; then
  CI=true npm test
else
  echo "::warning title=app::no test script in package.json; Jest skipped."
fi
