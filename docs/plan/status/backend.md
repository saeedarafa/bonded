# Backend / data developer status

Updated: 2026-11-03 · Branch: `be/BE-26-typed-code-approval` · Milestone: M2

## Resume here

- Last AI / date: Codex · 2026-11-03
- Branch + last implementation commit: `be/BE-26-typed-code-approval` @ `4a75e7b` `[BE-26] Record rebased verification handoff` (rebased onto `origin/be/BE-25-solo-archive` at `cc0480a`; PR #41).
- Uncommitted work: this status refresh only (commit and push next).
- Exact next step: monitor PR #41 CI/review and SEC-01 sign-off. Its base is unmerged PR #21, so rebase it onto `origin/main` only after #21 lands. Then take the next unblocked BE task from latest `origin/main`.
- Commands to re-run: `npm --prefix supabase/tests test`; `SUPABASE_TELEMETRY_DISABLED=1 node supabase/tests/gen-types.mjs --check`; `node supabase/scripts/build-seed.mjs --check`; `deno lint supabase/functions && deno check supabase/functions/**/*.ts && deno test -A supabase/functions`.
- Watch out for: the full DB suite, type/seed checks and Deno lint/check/test all pass after the rebase. PGlite's existing 10,000-code collision fixture makes the DB suite take several minutes. Use `SUPABASE_TELEMETRY_DISABLED=1` for type generation. The branch remains based on `be/BE-25-solo-archive`, so do not rebase it onto main until its dependency merges. The branch intentionally requires `--force-with-lease` because its prior remote history predates the dependency rebase.

## Doing

- BE-26 typed-code approval / PR #41: migration, contract, generated types and regression fixtures are complete; it targets BE-25 / PR #21 until that dependency merges. SEC-01 routing comment is on the PR.

## Done

- PR #25 / BE-20 opened: unread counts, `couple_members` Realtime and private avatars.
- PR #21 / BE-25 backend correction pushed; stale QA-owned archive-deletion assertions reported.
- PR #17 / BE-08 review fixes remain blocked by a stale QA auth-stub expectation, reported in the PR.
- BE-26 focused approval test: 13 passed; full `supabase/tests` suite: passed; generated artifacts and Deno suite: passed after the BE-25 rebase.

## Next

- Monitor PR #41, then take the next unblocked backend task.

## Blocked

- BE-10 and BE-19 wait for BE-08 to merge. Dev deployment remains blocked until the lead identifies an unambiguous dev project.

## Needs from

- Lead: review PR #25 and decide signed preview delivery vs. a public avatar bucket; merge PR #17 and PR #21 after their QA test corrections; provide an unambiguous dev project reference for BE-08 deployment.
- Security: SEC-01 review required for BE-26 typed-code pairing/approval before merge.
