# Backend / data developer status

Updated: 2026-11-03 · Branch: `be/BE-26-typed-code-approval` · Milestone: M2

## Resume here

- Last AI / date: Codex · 2026-11-03
- Branch + last commit: `be/BE-26-typed-code-approval` @ rebase in progress onto `be/BE-25-solo-archive`.
- Uncommitted work: rebase resolution for this status file only.
- Exact next step: continue the rebase, inspect the committed BE-26 join-request foundation, then preserve `private.accept_invite_at` as the immediate-pairing core and move no-token behavior into request creation. Add focused tests, regenerate types, update CONTRACTS, test, push, and open a PR.
- Commands to re-run: `npm --prefix supabase/tests test`; `SUPABASE_TELEMETRY_DISABLED=1 node supabase/tests/gen-types.mjs --check`; `node supabase/scripts/build-seed.mjs --check`; `deno lint supabase/functions && deno check supabase/functions/**/*.ts && deno test -A supabase/functions`.
- Watch out for: `join_requests` must be published to Realtime and readable only to the requester/inviter. A typed code must never pair immediately; a valid link token keeps the immediate path. Preserve BE-04c’s locked/rate-limited behavior and BE-25’s archived-solo-couple behavior.

## Doing

- BE-26 typed-code approval: rebasing its existing join-request foundation onto the unmerged BE-25 archive branch; compatibility correction follows.

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
