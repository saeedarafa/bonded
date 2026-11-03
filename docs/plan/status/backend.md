# Backend / data developer status

Updated: 2026-11-03 · Branch: `be/BE-20-history-realtime` · Milestone: M2

## Resume here

- Last AI / date: Codex · 2026-11-03
- Branch + last commit: `be/BE-20-history-realtime` @ verification/status checkpoint (commit next).
- Uncommitted work: this status update only.
- Exact next step: commit and push the verified BE-20 branch, open its PR, and monitor CI. Then take BE-26 if it remains unblocked; PR #21 and PR #17 each need QA-side stale test corrections before their CI can turn green.
- Commands to re-run: `npm --prefix supabase/tests test`; `SUPABASE_TELEMETRY_DISABLED=1 node supabase/tests/gen-types.mjs --check`; `node supabase/scripts/build-seed.mjs --check`; `deno lint supabase/functions && deno check supabase/functions/**/*.ts && deno test -A supabase/functions`.
- Watch out for: unread counts return no text and are restricted to active/revealed pair-period threads; mobile expects `setof {couple_question_id, unread}`. Storage path is `{uid}/avatar.jpg`. The bucket is private/couple-scoped as requested, which conflicts with the existing anonymous `invite_preview` avatar URL contract; lead must choose public delivery or a signed-preview path.

## Doing

- BE-20 history/realtime: complete and verified. Full PGlite DB suite passes (including 12 new unread/avatar behavior/RLS tests), generated types and seed checks pass, and Deno lint/check/test pass. The local-only `supabase db reset` could not finish because its Storage image pull left local services stopped; it did not target a remote project.

## Done

- PR #17 / BE-08: review fixes remain on the PR; its functions CI failure is a QA auth-stub that sends no notify event but expects 200, reported in the PR.
- PR #21 / BE-25: backend correction is pushed. CI now confirms the remaining failures are stale QA assertions that expect D04 to delete the solo archive (both PGlite and `qa/contract/invites.test.ts`); QA must update those owned tests for the documented archive behavior.

## Next

- Finish and open BE-20, then BE-26 if its BE-04c dependency remains merged and no review needs attention.

## Blocked

- BE-10 and BE-19 wait for BE-08 to merge. Dev deployment remains blocked until the lead identifies an unambiguous dev project.

## Needs from

- Lead: choose how anonymous invite previews should deliver an avatar now that BE-20's required private/couple-scoped bucket is in place (signed preview URL vs. public bucket); merge PR #17 and PR #21 after green CI; provide an unambiguous dev project reference for BE-08 deployment.
- Mobile / QA: BE-20 adds `unread_thread_counts()` and `couple_members` realtime; the API is additive. Avatars are private to the owner/current or recent partner pending the invite-preview delivery decision.
