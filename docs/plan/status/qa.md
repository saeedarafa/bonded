# QA automation engineer status
Updated: 2026-11-02 · Branch: qa/QA-01-ci · Milestone: M1

## Resume here
<!-- Keep this current after every step: the next AI (Claude, Codex or Copilot) starts from it. -->
- Last AI / date: Claude Code · 2026-11-02
- Branch + last commit: qa/QA-01-ci, rebased on main be3ae4e (BE-01), @ 1e49e2a "[QA-01] CI: db-tests on supabase/tests, db-reset on real Postgres, Node 24" (plus this status commit). Not pushed: no git remote yet (waiting on PO `gh auth login`).
- Uncommitted work: none
- Exact next step: lead merges QA-01. When a remote exists, check the first GitHub run: `db-reset` (Supabase CLI 3.0.0 + Docker) has never run anywhere yet; `functions` and `app` should show "skipped". Then QA-02 once BE-05 lands.
- Commands to re-run: `bash qa/ci/db-tests.sh` (runs: 22 passed, 0 failed; `src/types/database.ts is up to date`); `bash qa/ci/functions.sh; bash qa/ci/app.sh` (SKIP); `bash qa/ci/db-reset.sh` only works with the supabase CLI + Docker (not on this Mac); `node scripts/plan/generate.mjs --check`; `node scripts/agents/sync.mjs --check`; `npx --yes @action-validator/cli .github/workflows/ci.yml`
- Watch out for: git on this Mac needs `DEVELOPER_DIR=/Library/Developer/CommandLineTools git -C /Users/saeedarafa/dev/bonded-qa ...`. qa/ci scripts must stay bash-3.2 safe for local runs (empty arrays via `${a[@]+"${a[@]}"}`). actionlint was not run (binary download denied); only action-validator schema check + YAML parse. CI default Node is 24 (BE-01 built on 24); `.nvmrc` overrides.

## Doing
- QA-01: done locally and rebased on BE-01; waiting for the lead to merge, and for a remote to see the first run.

## Done (since last update)
- `.github/workflows/ci.yml` with jobs `plan-check`, `agents-sync-check`, `db-tests`, `db-reset`, `functions`, `app`, `ci-ok` (aggregate). Logic in `qa/ci/*.sh`.
- After BE-01: `db-tests` uses `supabase/tests/` (`npm ci`, `npm test`, `npm run check:types`) and runs for real now (22 passed, types up to date); new `db-reset` job (Supabase CLI 3.0.0, `supabase start` + `db reset`, Postgres 17), skips without `supabase/config.toml`.
- Verified locally: the three guarded jobs skip cleanly today; in a scratch copy with BE-01/BE-23/MOB-01 stand-ins they turn on, db-tests ran the PGlite tests green, and a failing Deno test, a type error and a failing Jest script each fail their job.
- `qa/TEST_PLAN.md`: decision tests for D02 token, D26 widgets, D32 reduced motion, D33 Spicy hold; coverage rows; CI map. `qa/fixtures/deeplinks.json`: D02 token links.

## Next
- QA-02 once BE-05 lands; draft `test.todo` contract tests for D02 (QA-03) against CONTRACTS meanwhile.

## Blocked
- Opening the PR / first CI run: no GitHub remote yet (PO `gh auth login`).

## Needs from
- lead: when protecting `main`, require check **`ci-ok`** (it aggregates all jobs). If you prefer per-job checks: `plan-check`, `agents-sync-check`, `db-tests`, `db-reset`, `functions`, `app`. Names are stable; no path filters, so they always report.
- backend: keep the `test` and `check:types` scripts in `supabase/tests/package.json` (CI calls them) and its lockfile committed. For BE-23, a `supabase/functions/deno.json` is picked up automatically; test files `*_test.ts`.
- mobile: in root `package.json` (MOB-01) define `typecheck`, `lint` and `test` scripts and commit `package-lock.json`; add `.nvmrc` if you need a Node other than 24.

## Contract changes in flight
- —

## Questions for the product owner
- —
