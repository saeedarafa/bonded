#!/usr/bin/env bash
# Contract tests (QA-03, QA-11 email sign-in via the local Mailpit): the qa/contract Vitest suite as signed-in personas against the real
# local Supabase stack (CLI + Docker). Typecheck first (no Docker needed), so a drift in
# src/types/database.ts fails fast.
#   bash qa/ci/contract.sh                 start the stack, reset, test, stop
#   bash qa/ci/contract.sh --stack-running use the stack the caller started and reset (db-reset.sh)
# Skips cleanly without supabase/config.toml or qa/contract.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

[ -f supabase/config.toml ] || skip contract "supabase/config.toml not on this branch yet (BE-01)."
[ -f qa/contract/package.json ] || skip contract "qa/contract not on this branch."

node -v
npm_install qa/contract

echo "== contract imports stay off the app tsconfig"
# Vitest (oxc) loads the nearest tsconfig.json of every imported file. The db-reset job installs no
# app dependencies, so a file whose nearest tsconfig extends expo/tsconfig.base (the repo root, so
# also qa/e2e) fails to load there with TSCONFIG_ERROR (PR #182). Shared code goes in qa/scripts.
node - <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const dir = path.resolve('qa/contract');
const bad = [];
for (const f of fs.readdirSync(dir).filter((n) => /\.(ts|mts)$/.test(n))) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  // Type-only imports are erased before loading, so only value imports count.
  for (const m of src.matchAll(/^(?!import type )[^\n]*?(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/gm)) {
    let d = path.dirname(path.resolve(dir, m[1]));
    while (!fs.existsSync(path.join(d, 'tsconfig.json')) && d !== path.dirname(d)) d = path.dirname(d);
    const tsconfig = path.join(d, 'tsconfig.json');
    if (fs.existsSync(tsconfig) && /expo\//.test(fs.readFileSync(tsconfig, 'utf8'))) {
      bad.push(`qa/contract/${f} imports ${m[1]} (nearest tsconfig ${path.relative(process.cwd(), tsconfig)} extends expo)`);
    }
  }
}
if (bad.length) {
  for (const b of bad) console.log(`::error::${b}`);
  process.exit(1);
}
console.log('ok');
NODE

echo "== contract typecheck (against src/types/database.ts)"
npm --prefix qa/contract run typecheck

if [ "${1:-}" != "--stack-running" ]; then
  command -v supabase >/dev/null || { echo "::error::supabase CLI not installed"; exit 1; }
  command -v docker >/dev/null || { echo "::error::docker not available"; exit 1; }
  supabase start
  trap 'supabase stop --no-backup >/dev/null 2>&1 || true' EXIT
  supabase db reset
fi

echo "== contract tests"
# global-setup reads the stack's URL and keys from `supabase status -o env`.
npm --prefix qa/contract test

# QA-02: the scenario seeder, through the same entry point developers use. Needs BE-05's dev_seed.
if [ -f qa/scripts/seed-scenario.ts ] && has_script . qa:scenario; then
  echo "== qa:scenario (seeder CLI)"
  npm_install qa/scripts
  npm run qa:scenario -- --list
  npm run qa:scenario -- streak-11-both-answered
  npm run qa:scenario -- solo-invite-pending --now 2026-12-01T09:00:00Z
  npm run qa:scenario -- streak-11-both-answered
fi
