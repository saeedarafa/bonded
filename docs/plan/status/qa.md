# QA automation engineer status
Updated: 2026-11-02 · Branch: qa/QA-01b-format-check · Milestone: M1

## Resume here
<!-- Keep this current after every step: the next AI (Claude, Codex or Copilot) starts from it. -->
- Last AI / date: Claude Code · 2026-11-02
- Branch + last commit: qa/QA-01b-format-check (from main fc86e16) @ a9c83bc "[QA-01b] CI app job: run format:check (Prettier) when the script exists" (plus this status commit), pushed.
- Uncommitted work: none
- Exact next step: lead merges QA-01b. Then branch `qa/QA-03-contract-tests` from main: contract tests for the BE-02 RPCs/error codes that exist on main, `test.todo` for BE-03/BE-04/BE-24 rows.
- Commands to re-run: `npm ci && bash qa/ci/app.sh` (typecheck, lint, format:check, Jest 2 suites / 50 tests: all green); `bash qa/ci/db-tests.sh`; `node scripts/plan/generate.mjs --check`; `node scripts/agents/sync.mjs --check`; `npx --yes @action-validator/cli .github/workflows/ci.yml`
- Watch out for: git on this Mac needs `DEVELOPER_DIR=/Library/Developer/CommandLineTools git ...`; push with `-c credential.helper= -c 'credential.helper=!gh auth git-credential'`. qa/ci scripts must stay bash-3.2 safe. `.prettierignore` excludes `qa/`, so format:check does not cover QA files. Branch protection is unavailable (private repo, free plan); `ci-ok` cannot be required yet.

## Doing
- QA-01b: done, waiting for the lead to merge.

## Done (since last update)
- QA-01 merged; first GitHub run on main all green (plan-check, agents-sync-check, db-tests, db-reset with Supabase CLI + Docker, functions, app, ci-ok).
- QA-01b: `qa/ci/app.sh` runs `npm run format:check` between lint and Jest, guarded like the other steps (warning + skip when the script is missing). Workflow unchanged. Local run green.

## Next
- QA-02 once BE-05 lands; draft `test.todo` contract tests for D02 (QA-03) against CONTRACTS meanwhile.

## Blocked
- Required check on `main`: branch protection is not available on the current plan (lead raised with PO).

## Needs from
- lead: when protecting `main`, require check **`ci-ok`** (it aggregates all jobs). If you prefer per-job checks: `plan-check`, `agents-sync-check`, `db-tests`, `db-reset`, `functions`, `app`. Names are stable; no path filters, so they always report.
- backend: keep the `test` and `check:types` scripts in `supabase/tests/package.json` (CI calls them) and its lockfile committed. For BE-23, a `supabase/functions/deno.json` is picked up automatically; test files `*_test.ts`.
- mobile: in root `package.json` (MOB-01) define `typecheck`, `lint` and `test` scripts and commit `package-lock.json`; add `.nvmrc` if you need a Node other than 24.

## Contract changes in flight
- —

## Questions for the product owner
- —
