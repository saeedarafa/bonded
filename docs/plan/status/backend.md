# Backend / data developer status

Updated: 2026-11-03 · Branch: `be/BE-26-typed-code-approval` · Milestone: M2

## Resume here

- Last AI / date: Codex · 2026-11-03
- Branch + last commit: `be/BE-26-typed-code-approval` @ BE-26 typed request WIP.
- Uncommitted work: migration, focused test, legacy fixture-token conversions, CONTRACTS and status (commit next).
- Exact next step: update `error-codes.test.mjs` and `invites-v2.test.mjs` for typed-pending versus token-immediate behavior, then run the full DB suite. Regenerate types with Supabase telemetry disabled or redirected inside the workspace, push, and open a PR based on `be/BE-25-solo-archive`.
- Commands to re-run: `npm --prefix supabase/tests test`; `SUPABASE_TELEMETRY_DISABLED=1 node supabase/tests/gen-types.mjs --check`; `node supabase/scripts/build-seed.mjs --check`; `deno lint supabase/functions && deno check supabase/functions/**/*.ts && deno test -A supabase/functions`.
- Watch out for: focused `node supabase/tests/join-requests.test.mjs` passes. `npm --prefix supabase/tests test` currently stops in `error-codes.test.mjs`, whose old fixture pairings omit tokens. `gen-types.mjs` is blocked because the Supabase CLI attempts to write `/Users/saeedarafa/.supabase/telemetry.json`; set its telemetry home to a writable temp/workspace path.

## Doing

- BE-26 typed-code approval: completed request/approval migration and focused regression test; converting legacy fixture assumptions.

## Done

- PR #25 / BE-20 opened: unread counts, `couple_members` Realtime and private avatars.
- PR #21 / BE-25 backend correction pushed; stale QA-owned archive-deletion assertions reported.
- PR #17 / BE-08 review fixes remain blocked by a stale QA auth-stub expectation, reported in the PR.

## Next

- Complete BE-26, then take the next unblocked backend task.

## Blocked

- BE-10 and BE-19 wait for BE-08 to merge. Dev deployment remains blocked until the lead identifies an unambiguous dev project.

## Needs from

- Lead: review PR #25 and decide signed preview delivery vs. a public avatar bucket; merge PR #17 and PR #21 after their QA test corrections; provide an unambiguous dev project reference for BE-08 deployment.
