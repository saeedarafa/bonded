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

Implemented in mobile commit `b6001c7a353b0e27ac491f9dc644b59e725710e2`
on `mobile/MOB-auth-email-links-final`. The implicit callback variant and production
`setSession` path have been removed. The parser rejects token-bearing parameters
in queries and fragments, including mixed callbacks and empty token values.
The callback API accepts only the PKCE variant before exchanging a code.
The lead inspected the production diff to confirm these changes.
The backend and mobile commits are combined on the lead integration branch.
Integration is tracked in [PR #44](https://github.com/saeedarafa/bonded/pull/44);
GitHub is authoritative for its merge state. Hosted Auth deployment is separate
and has not been performed.

## Independent source-merge verification

A focused, read-only Security Reviewer independently inspected the remediation
at `b6001c7` and backend configuration at `afab10a` on 2026-11-03.
The decision was **ACCEPT for source merge**, with no remaining findings in
that scope. The reviewer confirmed removal of the production `setSession` path,
PKCE-only exchange, token-bearing callback rejection, and regression coverage
for existing-session preservation, manual OTP and recovery.
The reviewer did not execute tests. This acceptance is not release readiness.

## Validation and limitations

Before remediation, the mobile branch passed 560 Jest tests, TypeScript and lint;
the backend branch passed four static Auth template/configuration tests.
These results do not validate the remediation.

The mobile owner ran these post-remediation checks at `b6001c7`; all passed:

| Command | Result |
|---|---|
| `npm test -- --runInBand src/features/auth/__tests__ src/__tests__/routes.test.tsx` | 6 suites, 236 tests passed |
| `npm test -- --runInBand` | 40 suites, 613 tests passed |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npx prettier --check src/features/auth/emailLinks.ts src/features/auth/api.ts src/features/auth/__tests__/emailLinks.test.ts src/features/auth/__tests__/api.test.ts src/features/auth/__tests__/session.test.tsx src/__tests__/routes.test.tsx docs/plan/status/mobile.md` | Passed |
| `git diff --check` | Passed |
| `npx engram hook-rebuild` | Exit 0; non-fatal `doc_ref` graph warning |

Regressions cover rejected token-only and mixed callbacks, no token-based session
establishment, preservation of an existing session on rejection, successful PKCE
callbacks and unchanged manual OTP behavior. These are mocked unit/router tests,
not reproduction or validation against native Auth services.

Native iOS/Android email round-trips and hosted Supabase Auth configuration remain
unverified. Local templates do not configure hosted Auth automatically. Hosted
projects must separately allow `bonded://auth/callback`, provide both
`{{ .ConfirmationURL }}` and `{{ .Token }}` in the relevant email templates, and
use six-digit OTPs. The shared QA Supabase stack has not been restarted or reset.

The lead independently reran the combined integration candidate: all 613 Jest
tests, typecheck, lint, repository formatting, four static Auth tests, 23
reveal-rule/RLS tests, generated-type freshness, seed freshness, plan generation,
agent sync and diff checks passed.

[CI run 41614175672](https://github.com/saeedarafa/bonded/actions/runs/41614175672)
passed all seven checks at integration commit `12986d9`: `app`, `db-tests`,
`db-reset`, `functions`, `plan-check`, `agents-sync-check` and `ci-ok`.
This includes the full database suite and clean-stack contract tests in CI,
without restarting the local shared QA stack.
