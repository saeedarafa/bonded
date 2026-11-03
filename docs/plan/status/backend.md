# Backend / data developer status

Updated: 2026-11-03 · Branch: `be/BE-20-history-realtime` · Milestone: M2

## Resume here

- Last AI / date: Codex · 2026-11-03
- Branch + last commit: `be/BE-20-history-realtime` @ this task-start handoff commit.
- Uncommitted work: none.
- Exact next step: implement BE-20 in a new migration after `20261102280000_claim_push_rpc.sql`: `unread_thread_counts()` with active-couple/RLS-safe reads and indexes; publish `couple_members`; create the `avatars` bucket and couple-scoped Storage policies. Add PGlite behavior/RLS tests, regenerate types, update CONTRACTS/change log, test, commit, push, and open a PR.
- Commands to re-run: `npm --prefix supabase/tests test`; `SUPABASE_TELEMETRY_DISABLED=1 node supabase/tests/gen-types.mjs --check`; `node supabase/scripts/build-seed.mjs --check`; `deno lint supabase/functions && deno check supabase/functions/**/*.ts && deno test -A supabase/functions`.
- Watch out for: unread counts must never expose answer/message text and must respect ended archives/pair-period rules. Mobile gates this feature with `UNREAD_COUNTS_AVAILABLE`; it expects `setof {couple_question_id, unread}`. Storage path is `{uid}/avatar.jpg`; do not edit product-owned content.

## Doing

- BE-20 history/realtime: scope and existing RLS/contract surfaces inspected; implementation next.

## Done

- PR #17 / BE-08: rebased review fixes force-pushed; CI was running.
- PR #21 / BE-25: review-test correction pushed; it preserves the joiner's archive while asserting only active membership/question visibility.

## Next

- BE-20, then BE-26 if its BE-04c dependency remains merged and no review needs attention.

## Blocked

- BE-10 and BE-19 wait for BE-08 to merge. Dev deployment remains blocked until the lead identifies an unambiguous dev project.

## Needs from

- Lead: merge PR #17 and PR #21 after green CI; provide an unambiguous dev project reference for BE-08 deployment.
