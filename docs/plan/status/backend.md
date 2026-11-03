# Backend / data developer status

Updated: 2026-11-03 · Branch: `be/BE-20-history-realtime` · Milestone: M2

## Resume here

- Last AI / date: Codex · 2026-11-03
- Branch + last commit: `be/BE-20-history-realtime` @ rebased BE-20 history; avatar preview correction and status commit next.
- Uncommitted work: avatar-preview review correction and this status update.
- Exact next step: commit and force-push the BE-20 rebase with lease protection, then monitor PR #25 CI/review. Once PR #21 merges, rebuild BE-26 from that dependency.
- Commands to re-run: `npm --prefix supabase/tests test`; `SUPABASE_TELEMETRY_DISABLED=1 node supabase/tests/gen-types.mjs --check`; `node supabase/scripts/build-seed.mjs --check`; `deno lint supabase/functions && deno check supabase/functions/**/*.ts && deno test -A supabase/functions`.
- Watch out for: unread counts return no text and are restricted to active/revealed pair-period threads; mobile expects `setof {couple_question_id, unread}`. Storage path is `{uid}/avatar.jpg`. The bucket is private/couple-scoped, so `invite_preview.inviter_avatar_url` is deliberately `null` until BE-20b supplies a short-lived, token-scoped signed URL.

## Doing

- BE-20 history/realtime: rebased on `origin/main`; PR review decision implemented: avatars are private and anonymous `invite_preview` returns a null avatar field pending BE-20b. The unread/avatar suite passes 12/12; generated types and seed checks pass.

## Done

- PR #17 / BE-08: rebased review fixes are green in CI, awaiting lead merge.
- PR #21 / BE-25: corrected crossing-archive regression was pushed and CI is re-running.

## Next

- BE-26 after PR #21 merges; rebuild from that dependency rather than overwriting its stale remote rebase.

## Blocked

- BE-10 and BE-19 wait for BE-08 to merge. Dev deployment remains blocked until the lead identifies an unambiguous dev project.

## Needs from

- Lead: re-review PR #25 after this rebase/decision implementation; merge PRs #17 and #21 after green CI; provide an unambiguous dev project reference for BE-08 deployment.
- Mobile / QA: BE-20 adds `unread_thread_counts()` and `couple_members` realtime; the API is additive. Avatars are private to the owner/current or recent partner; anonymous previews use the initial until BE-20b.
