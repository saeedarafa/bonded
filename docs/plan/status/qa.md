# QA automation engineer status
Updated: 2026-11-02 · Branch: qa/QA-01b-format-check · Milestone: M1

## Resume here
<!-- Keep this current after every step: the next AI (Claude, Codex or Copilot) starts from it. -->
- Last AI / date: Claude Code · 2026-11-02 (stopped at a usage-limit warning)
- Branches: `qa/QA-01b-format-check` @ a9c83bc + status commit, pushed, ready for the lead. `qa/QA-03-contract-tests` (from main fc86e16), pushed; last code commit "[QA-03] wip: run contract tests in the db-reset job on the same stack", plus this status commit. Draft: QA-03 depends on BE-04.
- Uncommitted work: none
- Exact next step: on `qa/QA-03-contract-tests`, squash/rename the wip commit if wanted and ask the lead to review. When PO grants the gh `workflow` scope, move the suite into its own `contract` job in ci.yml (add to `ci-ok` needs) and drop the call from db-reset.sh. When BE-03/BE-04/BE-24 land, turn the todos in `qa/contract/planned.test.ts` into tests.
- Commands to re-run: `npm --prefix qa/contract ci && npm --prefix qa/contract run typecheck` (works without Docker); `bash qa/ci/contract.sh` (needs supabase CLI + Docker; not on this Mac); CI on a branch: `gh workflow run ci.yml --ref <branch>`; `npm ci && bash qa/ci/app.sh`; `npx --yes @action-validator/cli .github/workflows/ci.yml`
- Watch out for: the gh token has no `workflow` scope, so pushes touching `.github/workflows/` are rejected. Contract tests need the local stack; global-setup fails loudly without it and refuses non-localhost URLs. vitest pinned to 4.1.12 (5.0.5 crashed while printing a globalSetup error). Files share personas, so `fileParallelism: false`; each file resets persona couples/invites/entitlements/push tokens with the service role. `.prettierignore` excludes `qa/` (I formatted qa/contract with `--ignore-path /dev/null`). git: `DEVELOPER_DIR=/Library/Developer/CommandLineTools git ...`, push with `-c credential.helper= -c 'credential.helper=!gh auth git-credential'`.

## Doing
- QA-01b: done, waiting for the lead to merge.
- QA-03 (draft): live contract tests green in CI; waiting on BE-03/BE-04/BE-24 for the todo rows.

## Done (since last update)
- QA-01 merged; first GitHub run on main all green.
- QA-01b: `qa/ci/app.sh` runs `npm run format:check` between lint and Jest, guarded like the other steps. Workflow unchanged. Local run green (typecheck, lint, Prettier, Jest 2 suites / 50 tests).
- QA-03: `qa/contract/` (Vitest 4 + supabase-js 2.118, typed with `src/types/database.ts`). Personas from `qa/fixtures/personas.json` created via the Auth admin API and signed in with a real email OTP (generateLink -> verifyOtp). `rpc.test.ts` (21): every live RPC, every BE-02 code incl. NOT_AUTHENTICATED via a subject-less JWT, anon 42501, retries. `tables.test.ts` (14): reveal rule, profiles, couples, invites, threads, read markers, packs, entitlements, push tokens, outsider and anon. `planned.test.ts`: 45 `it.todo` for BE-03, BE-04 (D01, D04, D05, D06), D02 token, BE-24. Wired via `qa/ci/contract.sh`, called from `qa/ci/db-reset.sh` on the same stack (no workflow change). CI run 41475226546 (workflow_dispatch on the branch): all jobs green; contract: 2 files passed, 1 skipped (todos); 35 passed, 45 todo.

## Next
- QA-02 once BE-05 lands. QA-03: convert todos as BE-03/BE-04/BE-24 merge.

## Blocked
- Required check on `main`: branch protection is not available on the current plan (lead raised with PO).

## Needs from
- product owner (via lead): run `gh auth refresh -h github.com -s workflow` so QA can push `.github/workflows/` changes (a separate `contract` job).
- backend: nothing blocking. FYI QA-03 creates FIXTURE-CONTRACT-* questions and `fixture-contract-*` packs on the local stack; keep `get_daily_question` independent of seed content. For BE-24, `planned.test.ts` expects the helpers to be unreachable via `rpc()`.
- lead: when protecting `main`, require check **`ci-ok`** (it aggregates all jobs). If you prefer per-job checks: `plan-check`, `agents-sync-check`, `db-tests`, `db-reset`, `functions`, `app`. Names are stable; no path filters, so they always report.
- backend: keep the `test` and `check:types` scripts in `supabase/tests/package.json` (CI calls them) and its lockfile committed. For BE-23, a `supabase/functions/deno.json` is picked up automatically; test files `*_test.ts`.
- mobile: in root `package.json` (MOB-01) define `typecheck`, `lint` and `test` scripts and commit `package-lock.json`; add `.nvmrc` if you need a Node other than 24.

## Contract changes in flight
- —

## Questions for the product owner
- —
