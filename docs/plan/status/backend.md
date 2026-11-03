# Backend / data developer status

Updated: 2026-11-03 · Branch: `be/BE-16-delete-account` · Milestone: M4

## Resume here

- Last AI / date: Claude Code · 2026-11-03
- Branch + last commit: `be/BE-16-delete-account` @ `dd64443` (plus this status commit). Merged `origin/be/BE-16-codex-unpushed` and `origin/main` (9e44983); no rebase or force-push.
- Uncommitted work: none (pushed). PR #35 comment posted with the summary and test results.
- State: delete-account removes `avatars/{uid}/avatar.jpg` before `auth.admin.deleteUser`; storage or delete failure = `500 DELETE_FAILED` (fixed message, no user data); 404/`USER_NOT_FOUND` = `200`. Migration renamed to `20261103110000_delete_account.sql` so it sorts after main's feedback migration.
- Exact next step: wait for CI on PR #35 and the lead's review; fix anything raised. Then BE-27 continues once the PO names the dev project ref.
- Commands to re-run: `bash qa/ci/functions.sh`; `deno fmt --check supabase/functions`; `npm --prefix supabase/tests ci && npm --prefix supabase/tests test`; `npm --prefix supabase/tests run check:types`.
- Watch out for: never reset the shared `bonded` local stack (QA, `~/dev/bonded-qa`); never write to `nciyrepyphvksusoigzx` until it is confirmed dev. `feedback.user_id` cascades on profile delete, so a deleted user's feedback is removed too.

## Doing

- BE-16 delete-account / PR #35: profile-delete trigger ends an active couple and timestamps the surviving membership before the Auth cascade; Edge Function deletes only the authenticated user and is idempotent on Auth 404. Avatar removal and retry/failure Deno tests added; all function and DB suites green locally; CI pending, awaiting lead review.

## Done

- PR #17 / BE-08 and PR #21 / BE-25 are green, awaiting lead merge.
- PR #25 / BE-20 is green with private avatars and a null anonymous preview field, awaiting lead review.
- PR #34 / BE-06 fixes `completed_today`; backend checks pass, while the QA-owned expected-failure sentinel now needs conversion to a normal assertion.

## Next

- Monitor PR #35. BE-27 waits on the PO's dev project ref.

## Blocked

- BE-10 and BE-19 wait for BE-08 to merge. BE-06 CI waits for QA's expected-failure conversion. Dev deployment remains blocked until the lead identifies an unambiguous dev project.

## Needs from

- Lead: review/merge green PRs #17, #21 and #25; provide an unambiguous dev project reference for BE-08 deployment.
- Mobile / QA: BE-16 makes `delete-account` live. It returns `{ok:true}` on success and the partner retains only their own 30-day archive after deletion.
- QA: convert QA-BUG-3's `it.fails` in `qa/contract/streak.test.ts` to a normal assertion on a branch based on `be/BE-06-streak-regression`, so PR #34 can go green.
