# Backend / data developer status

Updated: 2026-11-03 · Branch: `be/BE-26-typed-code-approval` · Milestone: M2

## Resume here

- Last AI / date: Codex · 2026-11-03
- Branch + last commit: `be/BE-26-typed-code-approval` @ `fd2524e` `[BE-26] Align pairing regressions with approval flow`.
- Uncommitted work: this status handoff only (commit next).
- Exact next step: force-push the diverged BE-26 branch and open its PR with base `be/BE-25-solo-archive` (BE-25 is still unmerged); request the required SEC-01 review for the typed pairing flow. Then check PR feedback and choose the next unblocked BE task from latest `origin/main`.
- Commands to re-run: `npm --prefix supabase/tests test`; `SUPABASE_TELEMETRY_DISABLED=1 node supabase/tests/gen-types.mjs --check`; `node supabase/scripts/build-seed.mjs --check`; `deno lint supabase/functions && deno check supabase/functions/**/*.ts && deno test -A supabase/functions`.
- Watch out for: the full DB suite passes, including 131 invite and 91 pairing-hardening regressions. PGlite's existing 10,000-code collision fixture makes that command take several minutes. Use `SUPABASE_TELEMETRY_DISABLED=1` for type generation. The branch remains based on `be/BE-25-solo-archive`, so do not rebase it onto main until its dependency merges.

## Doing

- BE-26 typed-code approval: migration, contract, generated types and all regression fixtures are complete; publish PR pending.

## Done

- PR #25 / BE-20 opened: unread counts, `couple_members` Realtime and private avatars.
- PR #21 / BE-25 backend correction pushed; stale QA-owned archive-deletion assertions reported.
- PR #17 / BE-08 review fixes remain blocked by a stale QA auth-stub expectation, reported in the PR.
- BE-26 tests now distinguish typed pending requests from token-immediate pairing; archive and F5 race tests cover BE-25 composition.

## Next

- Publish BE-26, then take the next unblocked backend task.

## Blocked

- BE-10 and BE-19 wait for BE-08 to merge. Dev deployment remains blocked until the lead identifies an unambiguous dev project.

## Needs from

- Lead: review PR #25 and decide signed preview delivery vs. a public avatar bucket; merge PR #17 and PR #21 after their QA test corrections; provide an unambiguous dev project reference for BE-08 deployment.
- Security: SEC-01 review required for BE-26 typed-code pairing/approval before merge.
