# QA automation engineer status
Updated: 2026-11-02 · Branch: qa/QA-01-ci · Milestone: M1

## Resume here
<!-- Keep this current after every step: the next AI (Claude, Codex or Copilot) starts from it. -->
- Last AI / date: Claude Code · 2026-11-02
- Branch + last commit: qa/QA-01-ci @ b86bdc5 "[QA-01] Test plan: kickoff decisions D02 token, D26, D32, D33 and CI map" (plus this status commit). Not pushed: no git remote yet (waiting on PO `gh auth login`).
- Uncommitted work: none
- Exact next step: when a remote exists, push and open the QA-01 PR; confirm the first GitHub run is green and that `db-tests` / `functions` / `app` show the "skipped" notice. Then QA-02 once BE-05 lands.
- Commands to re-run: `bash qa/ci/db-tests.sh; bash qa/ci/functions.sh; bash qa/ci/app.sh` (all exit 0 with SKIP on today's main); `node scripts/plan/generate.mjs --check`; `node scripts/agents/sync.mjs --check`; `npx --yes @action-validator/cli .github/workflows/ci.yml`
- Watch out for: git on this Mac needs `DEVELOPER_DIR=/Library/Developer/CommandLineTools git -C /Users/saeedarafa/dev/bonded-qa ...`. qa/ci scripts must stay bash-3.2 safe for local runs (empty arrays via `${a[@]+"${a[@]}"}`). actionlint was not run (binary download denied); only action-validator schema check + YAML parse.

## Doing
- QA-01: done locally, waiting on a remote to open the PR and see the first run.

## Done (since last update)
- `.github/workflows/ci.yml` with jobs `plan-check`, `agents-sync-check`, `db-tests`, `functions`, `app`, `ci-ok` (aggregate). Logic in `qa/ci/*.sh`.
- Verified locally: the three guarded jobs skip cleanly today; in a scratch copy with BE-01/BE-23/MOB-01 stand-ins they turn on, db-tests ran the 23 PGlite tests green, and a failing Deno test, a type error and a failing Jest script each fail their job.
- `qa/TEST_PLAN.md`: decision tests for D02 token, D26 widgets, D32 reduced motion, D33 Spicy hold; coverage rows; CI map. `qa/fixtures/deeplinks.json`: D02 token links.

## Next
- QA-02 once BE-05 lands; draft `test.todo` contract tests for D02 (QA-03) against CONTRACTS meanwhile.

## Blocked
- Opening the PR / first CI run: no GitHub remote yet (PO `gh auth login`).

## Needs from
- lead: when protecting `main`, require check **`ci-ok`** (it aggregates all jobs). If you prefer per-job checks: `plan-check`, `agents-sync-check`, `db-tests`, `functions`, `app`. Names are stable; no path filters, so they always report.
- backend: in `supabase/package.json` (BE-01) add a `"test"` script that runs the PGlite tests against the migrations you want (CI calls `npm test --prefix supabase`; fallback passes every `supabase/migrations/*.sql`). Commit `supabase/package-lock.json`. For BE-23, a `supabase/functions/deno.json` is picked up automatically; test files `*_test.ts`.
- mobile: in root `package.json` (MOB-01) define `typecheck`, `lint` and `test` scripts and commit `package-lock.json`; add `.nvmrc` if you need a Node other than 22.

## Contract changes in flight
- —

## Questions for the product owner
- —
