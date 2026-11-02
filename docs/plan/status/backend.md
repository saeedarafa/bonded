# Backend / data developer status
Updated: 2026-11-02 · Branch: be/BE-07-notification-prefs-v2 · Milestone: M2

## Resume here
<!-- Keep this current after every step: the next AI (Claude, Codex or Copilot) starts from it. -->
- Last AI / date: Codex · 2026-11-02
- Branch + last commit: `be/BE-07-notification-prefs-v2` @ `bb3a950`; created from `origin/main` @ `4130160`, independent of pending PRs #1–#3.
- Uncommitted work: BE-07 contract resolution, safer function search paths, test registration and this status update.
- Exact next step: commit/push BE-07 and open its PR against `main`, then create BE-09 from the latest `main` without waiting for review.
- Commands to re-run: `npm --prefix supabase/tests test`; `node supabase/tests/notifications.test.mjs`; `node supabase/tests/gen-types.mjs --check`; `node supabase/scripts/build-seed.mjs --check`.
- Watch out for: timezone constraints use `DROP CONSTRAINT IF EXISTS` so this migration remains compatible if PR #1 lands first. `notification_prefs` is one own row per user; only the `register_push_token` RPC may transfer a token to a new account.

## Doing
- BE-07: notification preferences, IANA timezones and push-token ownership complete; 58 focused tests pass.

## Done (since last update)
- BE-04c hardening: [PR #1](https://github.com/saeedarafa/bonded/pull/1), pending review.
- BE-23 Edge Functions: [PR #2](https://github.com/saeedarafa/bonded/pull/2), pending review; deployment needs a Supabase management access token.
- BE-06 streak v2: [PR #3](https://github.com/saeedarafa/bonded/pull/3), pending review.

## Next
- BE-09 ended couples, then BE-20 history/realtime/storage.

## Blocked
- BE-23 dev deployment: project exists, but `supabase link` and deploy require a Supabase access token with `project_admin_read` and `edge_functions_write`; the database password cannot authorize the management API.
- Local `supabase db reset` needs Docker; CI covers it.

## Needs from
- mobile: regenerate types; use `notification_prefs` instead of `profiles.reminder_time`, use `register_push_token` for device-token registration, and validate IANA timezones before save.
- qa: BE-07 adds `notifications.test.mjs` (58 checks); verify on real PostgREST/Docker after merge.
- lead: PRs #1–#3 do not block this branch or the next independent BE-09 task.

## Contract changes in flight
- BE-07: `notification_prefs`, `register_push_token`, IANA timezone checks and removal of `profiles.reminder_time` (mobile + QA acknowledgement requested).

## Questions for the product owner
- Provide a Supabase access token with `project_admin_read` and `edge_functions_write` when you want the BE-23 dev deployment run.
