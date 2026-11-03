# Backend / data developer status

Updated: 2026-11-03 · Branch: `be/BE-16-delete-account` · Milestone: M4

## Resume here

- Last AI / date: Codex · 2026-11-03
- Branch + last commit: `be/BE-16-delete-account` @ `f9765da` `Merge pull request #30 from saeedarafa/mobile/MOB-09-pairing-fixes`.
- Uncommitted work: BE-16 implementation and this status update (commit, push, then open PR).
- Exact next step: commit the BE-16 trigger/function/tests, push and open its PR; watch PR #25 CI and ask for lead review once green. BE-06 PR #34 needs QA to turn its now-passing `it.fails` sentinel into a regular test. Rebuild BE-26 only after PR #21 merges.
- Commands to re-run: `node supabase/tests/ended-couples.test.mjs`; `npm --prefix supabase/tests test`; `SUPABASE_TELEMETRY_DISABLED=1 node supabase/tests/gen-types.mjs --check`; `node supabase/scripts/build-seed.mjs --check`; `deno lint supabase/functions && deno check supabase/functions/**/*.ts && deno test -A supabase/functions`.
- Watch out for: Auth's cascade deletes the departing member row, so the profile `BEFORE DELETE` trigger must timestamp and end the couple first. Do not return admin error details to the app or logs.

## Doing

- BE-16 delete-account: profile-delete trigger ends an active couple and timestamps the surviving membership before the Auth cascade; Edge Function deletes only the authenticated user and is idempotent on Auth 404. Focused database and function tests are green.

## Done

- PR #17 / BE-08 and PR #21 / BE-25 are green, awaiting lead merge.
- PR #25 / BE-20 is rebased with private avatars and a null anonymous preview field; CI is running.
- PR #34 / BE-06 fixes `completed_today`; backend checks pass, while the QA-owned expected-failure sentinel now needs conversion to a normal assertion.

## Next

- Open BE-16 PR after committing this branch. Then rebuild BE-26 from PR #21 once it merges.

## Blocked

- BE-10 and BE-19 wait for BE-08 to merge. BE-06 CI waits for QA's expected-failure conversion. Dev deployment remains blocked until the lead identifies an unambiguous dev project.

## Needs from

- Lead: review/merge green PRs #17 and #21; re-review PR #25 after its database jobs finish; provide an unambiguous dev project reference for BE-08 deployment.
- Mobile / QA: BE-16 makes `delete-account` live. It returns `{ok:true}` on success and the partner retains only their own 30-day archive after deletion.
- QA: convert QA-BUG-3's `it.fails` in `qa/contract/streak.test.ts` to a normal assertion on a branch based on `be/BE-06-streak-regression`, so PR #34 can go green.
