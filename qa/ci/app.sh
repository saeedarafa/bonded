#!/usr/bin/env bash
# CI job "app": typecheck, lint and Jest for the Expo app (MOB-01).
# Turns on when the root package.json lands. Each step prefers the app's own npm script
# (typecheck / lint / format:check / test) so mobile controls flags; typecheck falls back to tsc --noEmit.
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

echo "== format"
if has_script . format:check; then
  npm run format:check
else
  echo "::warning title=app::no format:check script in package.json; Prettier check skipped."
fi

echo "== unit tests"
if has_script . test; then
  CI=true npm test
else
  echo "::warning title=app::no test script in package.json; Jest skipped."
fi

# QA-06: QA's app-level Jest suite (qa/app): real premium api/hooks against a fake PostgREST.
if [ -f qa/app/jest.config.js ]; then
  echo "== qa/app (Jest)"
  CI=true npx --no-install jest -c qa/app/jest.config.js
  npx --no-install tsc -p qa/app/tsconfig.json --noEmit
fi

# QA-04: the Maestro flows only use testIDs that exist, and parse (no simulator needed).
if [ -d .maestro ] && [ -f qa/e2e/package.json ]; then
  echo "== maestro flow lint"
  npm_install qa/e2e
  npm --prefix qa/e2e run lint
fi
