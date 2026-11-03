# Email authentication security review summary

Date: 2026-11-03

## Scope and evidence

This summarizes the existing focused, read-only security review of the email
sign-in changes. It is not a comprehensive repository audit or a release approval.

- Base: `9e449839446be0e02f196aeb345c2e0d4b1fbdc1`.
- Mobile reviewed: `4e2ef0523e372c99f6cca5fad12189b719754ce0`
  (`mobile/MOB-auth-email-links-final`).
- Backend reviewed: `afab10a0df7c7d48d47a3a951f7ffb68eeb8a4c5`
  (`be/auth-email-link-code`).
- Reviewed boundaries: callback URI parsing, PKCE/implicit credential handling,
  session transitions, credential persistence/logging, email templates and redirect
  configuration.
- Evidence is static source inspection. No attacker-controlled callback was
  reproduced on a device or against a deployed service.

## Finding EMAIL-AUTH-01

**Potential impact: medium. Evidence status: needs runtime validation.**

At the reviewed mobile revision,
[emailLinks.ts](src/features/auth/emailLinks.ts) lines 4-6 and 41-49 accept an
implicit access/refresh token pair. [api.ts](src/features/auth/api.ts) lines
160-169 pass that pair to `supabase.auth.setSession`.
[hooks.ts](src/features/auth/hooks.ts) processes both initial and incoming URLs,
and [session.tsx](src/features/auth/session.tsx) adopts the resulting user.

A person who controls a valid token pair for their own account and induces another
person to open a crafted callback might switch that person's app to the
attacker-controlled account. Subsequent information entered could be associated
with that account. This is a session-swapping concern, not evidence of takeover
of the recipient's account.

Confidence is high in the source path, but native callback reachability and
downstream impact were not demonstrated. The original review reported no other
actionable issue in this limited scope; this does not establish that the wider
application is vulnerability-free.

## Approved remediation

The product owner approved fixing all reported issues and committing this summary.

- Accept only PKCE authorization-code callbacks and exchange the code through
  `exchangeCodeForSession`, which uses the verifier stored by the initiating app.
- Reject implicit token-only callbacks and callbacks mixing a code with bearer
  tokens, whether the credentials appear in query parameters or fragments.
- Preserve manual six-digit OTP entry, cold/warm PKCE callbacks, pending-invite
  continuation and safe invalid/expired-link recovery.
- Older implicit links intentionally stop working; users can request a fresh
  sign-in email or enter the email's six-digit code.

Implementation and regression validation are in progress on the mobile branch.
No fix is merged or deployed yet.

## Validation and limitations

Before remediation, the mobile branch passed 560 Jest tests, TypeScript and lint;
the backend branch passed four static Auth template/configuration tests.
These results do not validate the remediation.

Required regression coverage includes rejected token-only and mixed callbacks,
no token-based session establishment, preservation of an existing session on
rejection, successful PKCE callbacks and unchanged manual OTP behavior.

Native iOS/Android email round-trips and hosted Supabase Auth configuration remain
unverified. Local templates do not configure hosted Auth automatically. Hosted
projects must separately allow `bonded://auth/callback`, provide both
`{{ .ConfirmationURL }}` and `{{ .Token }}` in the relevant email templates, and
use six-digit OTPs. The shared QA Supabase stack has not been restarted or reset.
