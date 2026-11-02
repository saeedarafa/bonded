# QA automation engineer status
Updated: 2026-11-02 · Branch: qa/QA-07-visual-a11y · Milestone: M1

## Resume here
<!-- Keep this current after every step: the next AI (Claude, Codex or Copilot) starts from it. -->
- Last AI / date: Claude Code · 2026-11-02 (late)
- **QA-03c** on `qa/QA-03c-be06-07-23` (from main, with BE-04/05/06/07/23): new `qa/contract/streak.test.ts` (BE-06: get_streak shape/NOT_PAIRED/anon, missed-day current 0 with pinned clock, at_risk, couple-tz day, every D17 boundary via `private.answer_counts_for_day`, offline sync, late merge, too-late no merge, client_written_at clamp, column grants, edit keeps flags), `qa/contract/notifications.test.ts` (BE-07: prefs defaults/RLS/CHECK/no delete, quiet-hours fn, register_push_token move/idempotent/length/platform, IANA timezone checks), `qa/functions/stubs_test.ts` (BE-23: real authenticators with env secrets; hooked into `qa/ci/functions.sh`), `callAs` helper, BE-06 todos removed from planned.test.ts. NOT run against a live stack (no Docker on this Mac): typecheck clean, deno 6+9 tests green. First CI run is the real check; expect to fix test-side surprises.
- **QA-03d** on `qa/QA-03d-be04c-tests` (from `origin/be/BE-04c-hardening`, NOT merged with main: main conflicts in backend-owned `docs/CONTRACTS.md`, `status/backend.md`, `supabase/tests/package.json`): fixes the PR #1 db-reset failure. Cause: the test is outdated. BE-04c (F4) moved the hourly global count from scanning `private.invite_attempts` to the sharded counter `private.invite_failure_counts`, so seeding 99 attempt rows no longer reaches the cap. The test now seeds `invite_failure_counts` (current hour, shard 0, n=99); `resetAttempts` also clears the counter. No backend bug found. Backend can cherry-pick/merge this branch into be/BE-04c-hardening (changes only `qa/contract/`). Note the helper change needs the 04c table, so it only works with 04c merged.
- Earlier: **QA-07** on `qa/QA-07-visual-a11y` (merged). `qa/QA-03b-be04-be05` @ 9ace9cb.
- Uncommitted work: none
- Exact next step: tell the lead both branches are ready. When BE-06 and later land, convert the todos in `qa/contract/planned.test.ts`. Decide QA-BUG-1 and QA-BUG-2 with the lead/backend. When PO grants the gh `workflow` scope, move contract + seeder smoke into their own `contract` job in ci.yml (add to `ci-ok` needs).
- Commands to re-run: `npm --prefix qa/contract ci && npm --prefix qa/contract run typecheck` (works without Docker); `bash qa/ci/contract.sh` (needs supabase CLI + Docker; not on this Mac); CI on a branch: `gh workflow run ci.yml --ref <branch>`; `npm ci && bash qa/ci/app.sh`; `npx --yes @action-validator/cli .github/workflows/ci.yml`
- Watch out for: the gh token has no `workflow` scope, so pushes touching `.github/workflows/` are rejected. Contract tests need the local stack; global-setup fails loudly without it and refuses non-localhost URLs/DB hosts. The `private` schema (invite attempt log, tokens) is only reachable over direct Postgres: `stack.dbUrl` (from `supabase status -o env` `DB_URL`, else `postgresql://postgres:postgres@127.0.0.1:54322/postgres`), via `sql()`/`atTime()` in `qa/contract/helpers.ts` (pg 8). `atTime()` calls `private.accept_invite_at`/`invite_preview_at` with a pinned clock. `resetWorld()` also clears `private.invite_attempts` (the limiter keys on user, or anon on hashed IP). After `supabase db reset` the DB is in scenario `streak-11-both-answered`; `resetWorld` removes persona couples. vitest pinned to 4.1.12. Files share personas: `fileParallelism: false`. `.prettierignore` excludes `qa/` (format with `npx prettier@3 --ignore-path /dev/null --write qa/contract/*.ts`). This Mac: python3 and git need `DEVELOPER_DIR=/Library/Developer/CommandLineTools`; push with `-c credential.helper= -c 'credential.helper=!gh auth git-credential'`; `gh run view` also needs DEVELOPER_DIR.

## Doing
- QA-03b: done, CI green, waiting for the lead.
- QA-02: done once the last CI run (see Done) is green; waiting for the lead.

## Done (since last update)
- QA-07: gallery visual + a11y suite in light, dark, light-200%, dark-200%: committed text baselines, accessible names/roles/state, SVG hiding, headers, 44 pt hit areas, WCAG AA contrast on composited backgrounds, no truncation, type-scale tokens. Mutation check (lightened `text2`) turned contrast + baseline red, then reverted. Result: 0 product findings, so `KNOWN` is empty. Limit: structural, not pixels (Node has no layout); pixel screenshots need a simulator (see README). Re-run: `bash qa/ci/visual.sh`; update baselines: `UPDATE_BASELINES=1 bash qa/ci/visual.sh`.
- Finding (not a bug filed, FYI mobile): `GalleryScreen` ignores `SchemeOverride`/`FontScaleOverride` wrapped around it (it installs its own from internal state), so tests drive its switches.
- QA-03 merged by the lead (db26cfe).
- Acknowledged change-log rows (CONTRACTS §2): **BE-04** (invites v2: `create_invite` returns `{code, expires_at, token}`, `accept_invite`/`invite_preview` return json, D04 solo joiner, D02 limiter + token, body-borne 400 errors, `pair_invites` read-only for clients) and **BE-05** (answers 1–500, `reactions.kind`, `first_day` special on day 1, stage-aware dailies, `dev_seed`). Tests and helpers follow both.
- QA-03b: new `qa/contract/invites.test.ts` (create_invite shape/48 h/one active invite/token never readable; accept_invite code formats, D04, J5 inheritance, order of errors, reveal rule for the day-1 answer, race; rate limit 5/15 min incl. pinned clock and per-user; link token rules; global hourly cap alert row; `invite_preview` anon shape, no leaks, errors, limiter incl. anon IP). `rpc.test.ts`: `create_couple`, `get_daily_question` (first_day, day 2 is not special, stage rule), BE-24 list now includes the `*_at` and limiter functions. `tables.test.ts`: `pair_invites` anon denied (42501), answers 1–500 and threads 2000, reactions with `kind` (upsert, kinds, reveal rule, partner/outsider/anon, delete own). `planned.test.ts` now only holds the next backend rows (BE-06, 09, 10, 11, 14, 17, 20).
- Verified on real PostgREST (UNVERIFIED in the brief): `accept_invite`/`invite_preview` failures arrive as HTTP 400 with `error.message === '<CODE>'`, `error.code === 'P0001'`, `data` null, and the failed attempt persists in `private.invite_attempts`.
- CI run 41488134287: db-tests, plan-check, db-reset (incl. contract), functions, app, agents-sync-check, ci-ok green. Contract: 137 passed, 1 expected fail, 9 todo (3 files).

## Bugs and findings
- **QA-BUG-2 (sev 3, BE-05, dev tooling only):** `dev_seed.reset()` (called by `apply_scenario`) deletes only the couples listed in `dev_seed.couple`. If a persona is a member of any other couple (made through the app or a contract test), the next `apply_scenario` fails with `couple_members_one_couple_per_user`. The seeder works around it (drops every couple a persona belongs to first), but `reset()` should do the same so `select dev_seed.apply_scenario(...)` from psql is safe. Owner: backend.
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
