# Backend / data developer status

Updated: 2026-11-03 · Branch: `be/BE-28-invite-link` · Task: BE-28 `invite_link()` (D36)

## Resume here

- Last AI / date: Claude Code · 2026-11-03
- Worktree: `/Users/saeedarafa/dev/bonded-be` (only this one).
- Branch: `be/BE-28-invite-link` from `origin/main` @ `e8079b8`. PR: see "Doing". `be/BE-16-delete-account` (PR #35) is left as is (fast-forwarded to QA's 99aff69); the lead merges it.
- Uncommitted work: none after this commit.
- State: migration `supabase/migrations/20261103120000_invite_link.sql`: `private.invite_tokens` now allows several hashes per invite (new `id` pk, `created_at`, index on `invite_id`, unique `token_hash`); existing rows kept, so links already shared keep working. `private.invite_link_at(p_now)` + `public.invite_link()` (authenticated only) return `{code, expires_at, token}` for the caller's open invite with a fresh 192-bit token; SQL null when none; 10 invite_link tokens per invite (11 rows incl. create_invite's) then `RATE_LIMITED`. `resolve_invite` already matched any token with `exists`, so accept/preview are unchanged. Tests: `supabase/tests/invite-link.test.mjs` (45 checks, includes an upgrade test applying the migration over a pre-existing token); `invite_link` added to the definer allowlist (private-helpers) and anon/NOT_AUTHENTICATED checks (error-codes). Types regenerated. CONTRACTS §2 row + change log.
- Exact next step: wait for SEC sign-off (D02 token) and lead review/merge of the BE-28 PR; mobile (MOB-33) and QA (QA-12) consume it. Then BE-27 once the PO names the dev project ref.
- Commands to re-run: `npm --prefix supabase/tests test` (invites-v2 takes several minutes: 10,000-code key-space section); `node supabase/tests/invite-link.test.mjs`; `npm --prefix supabase/tests run check:types`.
- Watch out for: PostgREST may serialise a null composite as `null` or as an all-null object, so the contract tells the app to check `!data?.token`. Never reset the shared `bonded` local stack (QA, `~/dev/bonded-qa`); never write to `nciyrepyphvksusoigzx` until it is confirmed dev.

### BE-27 hosted parity (QA bug #28): blocked on the PO
- No hosted dev project is identifiable (`supabase projects list`: only `nciyrepyphvksusoigzx` "bonded", labelled production, and the inactive "Core"). Nothing read from or written to any hosted project.
- Next: PO names the dev project ref, then read-only GET `/v1/projects/<ref>/config/auth` and compare with `supabase/templates/magic_link.html`.
- PO operator checklist (dashboard, dev project): Site URL `bonded://`; Redirect URLs `bonded://auth/callback`, `bonded://**` (Expo Go: `exp://127.0.0.1:8081/--/**`); Magic Link and Confirm signup templates use `{{ .ConfirmationURL }}` link + `{{ .Token }}` code (no `{{ .TokenHash }}` links); Email OTP length 6; send a test sign-in email.

## Doing

- BE-28 (D36) `invite_link()`: PR open, needs SEC sign-off (D02 token) and lead review.

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

- **Contract changed (additive), mobile MOB-33:** `supabase.rpc('invite_link')` (no args) returns `{code, expires_at, token}` for your open invite with a new link token, or no invite (`!data?.token`) → call `create_invite`. It never replaces the code. Errors: `NOT_AUTHENTICATED`, `RATE_LIMITED` (after 10 per invite; keep sharing the code text). See CONTRACTS §2.
- **QA QA-12:** contract tests for `invite_link()` (CONTRACTS §2 row).
- **Security:** review BE-28 (several valid link tokens per invite, D02).
- Lead: review/merge BE-28 and #35.
- PO: name the hosted dev project ref (BE-27).
