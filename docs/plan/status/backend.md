# Backend / data developer status

Updated: 2026-11-03 · Branch: `be/auth-email-link-code` · Task: #28 email sign-in

## Resume here

- Last session: 2026-11-03.
- Branch + last commit: `be/auth-email-link-code` @ this completed email-template commit (not pushed).
- Worktree: `/Users/saeedarafa/dev/bonded-be-auth-email-link-code`, freshly created from `origin/main` at `9e449839446be0e02f196aeb345c2e0d4b1fbdc1`; existing backend worktrees untouched.
- Uncommitted work: none after this commit.
- Exact next step: lead routes this Auth change to security review before merge; coordinate safe local Auth reload and end-to-end mail/link/code verification with QA. Do not push or open a PR without a new request.
- Commands to re-run: `npm --prefix supabase/tests ci`; `node supabase/tests/auth-email.test.mjs`; `npm --prefix supabase/tests test`; `SUPABASE_TELEMETRY_DISABLED=1 node supabase/tests/gen-types.mjs --check`; `node supabase/scripts/build-seed.mjs --check`; `(cd supabase/functions && deno test -A)`.
- Watch out for: all work was static/unit-only. No Supabase start/stop/reset, deployment, or hosted changes. Run Deno from `supabase/functions` so its config/dependencies are used.

## Doing

- Email sign-in implementation completed; awaiting review and runtime validation.

## Done (since last update)

- Added active `magic_link` and `confirmation` templates, each with a tappable `{{ .ConfirmationURL }}` and visible `{{ .Token }}`.
- Explicitly allow `bonded://auth/callback`; preserved `bonded://**` and both Expo redirects. Six-digit OTP and local confirmations-disabled setting unchanged.
- Added TOML-parsed static verification (four passing tests) to the existing backend `npm test` command, with a pinned test-only parser and lockfile.
- Reveal-rule suite: 23/23 passed. Error-code, private-helper, couple, content, seed, streak, notification, push-ledger, hardening, ended-couple, badge, history/realtime and feedback suites all passed.
- Generated types and seed checks passed; no schema, RPC, contract, or generated-file changes needed. Edge unit tests: 8/8 passed. `git diff --check` passed.

## Blocked

- The full `npm test` run was stopped after over six minutes in the pre-existing `invites-v2` 10,000-code key-space section (last output: “failed accepts joined nobody”); no failures reported before stopping. All remaining suites were run separately and passed. Full suite is not claimed green.
- Email delivery/rendering, actual link consumption and in-app code verification were not tested: shared QA stack must remain untouched.
- Hosted dev/prod Auth settings were not inspected or applied. Local TOML/templates do not by themselves establish hosted parity.

## Needs from

- Lead/security: review this Auth change before merge; identify a safe dev project before any hosted configuration.
- Mobile/QA: email content changed (no DB/API contract change). After an agreed Auth reload, verify existing-user sign-in via link and, with a separate OTP request, six-digit code; verify signup confirmation when enabled. Local confirmations remain disabled, so new-user confirmation mail may be bypassed.
- Hosted operator: copy both templates into hosted Auth email templates, retain a six-digit OTP and explicitly allow `bonded://auth/callback` alongside supported redirects. Verify the app sends that callback as `emailRedirectTo`. No hosted rollout performed here.
