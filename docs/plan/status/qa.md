# QA automation engineer status
Updated: 2026-11-02 · Branch: qa/QA-03-contract-tests · Milestone: M1

## Resume here
<!-- Keep this current after every step: the next AI (Claude, Codex or Copilot) starts from it. -->
- Last AI / date: Claude Code · 2026-11-02
- Branch: `qa/QA-03-contract-tests`, rebased on main 381cc5c (contains QA-01b, MOB-29, BE-24, BE-03). The wip commit is squashed into d3a18be; 791a5e2 converts the BE-03/BE-24 todos. Not merged (lead merges). CI run 41480171723 (workflow_dispatch on the branch, code at 791a5e2): all 7 jobs green; contract tests in db-reset: 2 files passed, 79 passed, 25 todo.
- Uncommitted work: none
- Exact next step: tell the lead QA-03 is ready to review/merge (squash is already done). When BE-04 lands, convert the BE-04 and D02 todos in `qa/contract/planned.test.ts` (and drop the "second open code" COUPLE_FULL test and the solo-caller ALREADY_PAIRED test, which BE-04 changes: D04, one active invite). When BE-05 lands, the first_day todo. When PO grants the gh `workflow` scope, move the suite into its own `contract` job in ci.yml (add to `ci-ok` needs) and drop the call from db-reset.sh.
- Commands to re-run: `npm --prefix qa/contract ci && npm --prefix qa/contract run typecheck` (works without Docker); `bash qa/ci/contract.sh` (needs supabase CLI + Docker; not on this Mac); CI on a branch: `gh workflow run ci.yml --ref <branch>`; `npm ci && bash qa/ci/app.sh`; `npx --yes @action-validator/cli .github/workflows/ci.yml`
- Watch out for: the gh token has no `workflow` scope, so pushes touching `.github/workflows/` are rejected. Contract tests need the local stack; global-setup fails loudly without it and refuses non-localhost URLs. vitest pinned to 4.1.12 (5.0.5 crashed while printing a globalSetup error). Files share personas, so `fileParallelism: false`; each file resets persona couples/invites/entitlements/push tokens with the service role. `pair(inviter, joiner)` in helpers now calls `create_couple` for the inviter first (BE-03); the joiner must have no couple until BE-04 (D04). `.prettierignore` excludes `qa/` (format qa/contract with `npx prettier@3 --ignore-path /dev/null --write qa/contract/*.ts`). This Mac: python3 and git need `DEVELOPER_DIR=/Library/Developer/CommandLineTools`; push with `-c credential.helper= -c 'credential.helper=!gh auth git-credential'`.

## Doing
- QA-03 (draft): live contract tests for BE-02, BE-03 and BE-24; waiting on BE-04/BE-05 for the remaining todo rows.

## Done (since last update)
- Acknowledged change-log rows (CONTRACTS §2): **BE-24** (RLS helpers moved to `private`; QA never called them; the contract suite now asserts they are unreachable) and **BE-03** (breaking: `create_invite` needs `create_couple` first, `accept_invite` joins the inviter's couple, couples `status`/`ended_at`/ids not client-writable, `key_dates`). Contract tests, helpers and seeding follow both.
- QA-03 rebased on main 381cc5c; wip commit squashed.
- `helpers.pair()` creates the solo couple first; `loose()` helper for calling functions that must not exist.
- `rpc.test.ts`: new `create_couple` suite (solo couple, cleaned settings, caps, optional stage, idempotent retry, ALREADY_PAIRED, enum error 22P02, solo `get_daily_question` then joiner gets same question); `create_invite` NOT_PAIRED/partner_name/couple_id; `accept_invite` joins the inviter's couple, inherits stage/goals/key dates (J5), solo caller ALREADY_PAIRED order, OWN_CODE for a solo inviter; anon and subject-less JWT cover `create_couple`; BE-24: 7 helpers x (maya, eve, anon) get PGRST202/404, `private` schema gives PGRST106, outsider cannot probe a foreign question.
- `tables.test.ts`: couple read with `couple_members(user_id,left_at)` and status filter; couple settings update (stage enum, goals/partner_name limits, `status`/`ended_at`/`id` denied 42501, no client insert/delete, outsider updates 0 rows); `key_dates` (upsert one row per kind, birthdays per owner, kind enum, check constraints, duplicate 23505, outsider and anon).
- `planned.test.ts`: BE-03 and BE-24 todos removed; BE-04 (D01, D04, D05, D06), D02 token and a BE-05 `first_day` todo remain.
- QA-03 base (earlier): `qa/contract/` Vitest 4 + supabase-js 2.118, typed with `src/types/database.ts`; personas from `qa/fixtures/personas.json` via the Auth admin API, signed in with a real email OTP (generateLink -> verifyOtp). Wired via `qa/ci/contract.sh`, called from `qa/ci/db-reset.sh` on the same stack (no workflow change).
- QA-01b merged by the lead.
- CI (run 41480171723): db-tests, plan-check, db-reset (incl. contract), functions, app, agents-sync-check, ci-ok all green. Contract layer: rpc.test.ts 53, tables.test.ts 26 passed, planned.test.ts 25 todo. No open bugs (sev-1/2: none).

## Next
- QA-02 once BE-05 lands. QA-03: convert todos as BE-04/BE-05 merge.

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
