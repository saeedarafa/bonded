# Backend / data developer status

Updated: 2026-11-03 · Branch: `be/BE-27-status` · Task: BE-27 hosted parity (#28)

## Resume here

- Last session: 2026-11-03 (BE-27 hosted-parity check, QA bug #28).
- Branch + last commit: `be/BE-27-status` from `origin/lead/MOB-auth-email` @ `2b349c4`; this status-only commit. Template work stays in #44 (`afab10a`). No code change needed, so no `be/BE-27-hosted-parity` branch.
- Worktree: `/Users/saeedarafa/dev/bonded-be`.
- Uncommitted work: none after this commit.
- BE-27 finding: **no hosted dev project is identifiable.** `supabase projects list` (read-only) shows only `nciyrepyphvksusoigzx` "bonded" (linked; the lead labels it production) and `urkqzkrceetonljagzfk` "Core" (INACTIVE, unrelated). No `bonded-dev` exists (ACCOUNTS row 2 still open), yet PO_ANSWERS says the template was edited "on the Supabase dev project". Hosted auth config was therefore **not read**; nothing was written to any hosted project. The repo template stays as is (`{{ .ConfirmationURL }}` link + `{{ .Token }}` code).
- Exact next step: PO names the dev project ref (or confirms `nciyrepyphvksusoigzx` is dev, not prod), then run the checklist below read-only (GET `/v1/projects/<ref>/config/auth`) and compare the hosted template with `supabase/templates/magic_link.html`.
- PO operator checklist (dashboard, dev project):
  1. Auth -> URL Configuration -> Site URL: `bonded://` (if left at `http://localhost:3000`, a rejected redirect falls back there and the link fails).
  2. Auth -> URL Configuration -> Redirect URLs: add `bonded://auth/callback` (and `bonded://**`; for Expo Go dev also `exp://127.0.0.1:8081/--/**`).
  3. Auth -> Email Templates -> Magic Link (and Confirm signup): the link must be `<a href="{{ .ConfirmationURL }}">`; show the code with `{{ .Token }}`. Do **not** build a custom link with `{{ .TokenHash }}` or `token=`: the app accepts only `?code=` (PKCE) and rejects token parameters.
  4. Auth -> Providers -> Email: Email OTP length 6.
  5. Send yourself a test sign-in email: it contains a 6-digit code and a link; the link opens Bonded on the same phone that requested it.
- Commands to re-run: `node supabase/tests/auth-email.test.mjs`; `supabase projects list`.
- Watch out for: never write to `nciyrepyphvksusoigzx` until it is confirmed dev; never reset the shared `bonded` local stack (QA, `~/dev/bonded-qa`).

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
