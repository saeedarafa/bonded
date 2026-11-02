# QA automation engineer status
Updated: 2026-11-02 · Branch: qa/QA-03b-be04-be05 · Milestone: M1

## Resume here
<!-- Keep this current after every step: the next AI (Claude, Codex or Copilot) starts from it. -->
- Last AI / date: Claude Code · 2026-11-02
- Branch: `qa/QA-03b-be04-be05` from `origin/lead/integrate-be05` (main db26cfe + BE-04 + BE-05). CI run 41488134287 (workflow_dispatch, code at b435758): all 7 jobs green; contract in db-reset: 3 files passed, 137 passed, 1 expected fail (QA-BUG-1), 9 todo. Not merged. Next branch: `qa/QA-02-seed-scenario` from this one (Task B).
- Uncommitted work: none
- Exact next step: QA-02: `qa/scripts/seed-scenario.ts`, `npm run qa:scenario <id>` (root script), `qa/contract/scenarios.test.ts` over all 19 `dev_seed` scenarios, CI via `gh workflow run ci.yml --ref qa/QA-02-seed-scenario`. Then tell the lead both branches are ready (QA-02 stacks on QA-03b: merge QA-03b first, or QA-02 alone brings both).
- Commands to re-run: `npm --prefix qa/contract ci && npm --prefix qa/contract run typecheck` (works without Docker); `bash qa/ci/contract.sh` (needs supabase CLI + Docker; not on this Mac); CI on a branch: `gh workflow run ci.yml --ref <branch>`; `npm ci && bash qa/ci/app.sh`; `npx --yes @action-validator/cli .github/workflows/ci.yml`
- Watch out for: the gh token has no `workflow` scope, so pushes touching `.github/workflows/` are rejected. Contract tests need the local stack; global-setup fails loudly without it and refuses non-localhost URLs/DB hosts. The `private` schema (invite attempt log, tokens) is only reachable over direct Postgres: `stack.dbUrl` (from `supabase status -o env` `DB_URL`, else `postgresql://postgres:postgres@127.0.0.1:54322/postgres`), via `sql()`/`atTime()` in `qa/contract/helpers.ts` (pg 8). `atTime()` calls `private.accept_invite_at`/`invite_preview_at` with a pinned clock. `resetWorld()` also clears `private.invite_attempts` (the limiter keys on user, or anon on hashed IP). After `supabase db reset` the DB is in scenario `streak-11-both-answered`; `resetWorld` removes persona couples. vitest pinned to 4.1.12. Files share personas: `fileParallelism: false`. `.prettierignore` excludes `qa/` (format with `npx prettier@3 --ignore-path /dev/null --write qa/contract/*.ts`). This Mac: python3 and git need `DEVELOPER_DIR=/Library/Developer/CommandLineTools`; push with `-c credential.helper= -c 'credential.helper=!gh auth git-credential'`; `gh run view` also needs DEVELOPER_DIR.

## Doing
- QA-03b: done, CI green, waiting for the lead.
- QA-02: starting.

## Done (since last update)
- QA-03 merged by the lead (db26cfe).
- Acknowledged change-log rows (CONTRACTS §2): **BE-04** (invites v2: `create_invite` returns `{code, expires_at, token}`, `accept_invite`/`invite_preview` return json, D04 solo joiner, D02 limiter + token, body-borne 400 errors, `pair_invites` read-only for clients) and **BE-05** (answers 1–500, `reactions.kind`, `first_day` special on day 1, stage-aware dailies, `dev_seed`). Tests and helpers follow both.
- QA-03b: new `qa/contract/invites.test.ts` (create_invite shape/48 h/one active invite/token never readable; accept_invite code formats, D04, J5 inheritance, order of errors, reveal rule for the day-1 answer, race; rate limit 5/15 min incl. pinned clock and per-user; link token rules; global hourly cap alert row; `invite_preview` anon shape, no leaks, errors, limiter incl. anon IP). `rpc.test.ts`: `create_couple`, `get_daily_question` (first_day, day 2 is not special, stage rule), BE-24 list now includes the `*_at` and limiter functions. `tables.test.ts`: `pair_invites` anon denied (42501), answers 1–500 and threads 2000, reactions with `kind` (upsert, kinds, reveal rule, partner/outsider/anon, delete own). `planned.test.ts` now only holds the next backend rows (BE-06, 09, 10, 11, 14, 17, 20).
- Verified on real PostgREST (UNVERIFIED in the brief): `accept_invite`/`invite_preview` failures arrive as HTTP 400 with `error.message === '<CODE>'`, `error.code === 'P0001'`, `data` null, and the failed attempt persists in `private.invite_attempts`.
- CI run 41488134287: db-tests, plan-check, db-reset (incl. contract), functions, app, agents-sync-check, ci-ok green. Contract: 137 passed, 1 expected fail, 9 todo (3 files).

## Bugs and findings
- **QA-BUG-1 (sev 4, BE-04 or TEST_PLAN, lead to decide):** TEST_PLAN D02 says the token of an expired invite "does not skip the limit". Live: a valid token on an expired invite skips the limiter, so a user already at 5 failures gets `INVITE_EXPIRED`, not `RATE_LIMITED` (backend's own `invites-v2.test.mjs` encodes that). No security impact (the token is a 192-bit secret; nothing to guess). Test kept strict as `it.fails` in `invites.test.ts` ("the token of an expired invite does not skip the limit"); it goes red when the behaviour changes. Either backend changes `private.accept_invite_at` (check the limiter before reporting expiry) or QA updates the TEST_PLAN row.

## Next
- QA-02 (seed-scenario). Then QA-03: BE-06 onwards as they land.

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
