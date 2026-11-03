# Backend / data developer status

Updated: 2026-11-03 · Branch: `be/BE-28-invite-link` · Task: BE-28 `invite_link()` (D36)

## Resume here

- Last AI / date: Claude Code · 2026-11-03
- Worktree: `/Users/saeedarafa/dev/bonded-be` (only this one).
- Task: **BE-28 (D36)** `invite_link()`: fresh link token without replacing the code.
- Branch: `be/BE-28-invite-link` from `origin/main` @ `e8079b8`; last code commit "[BE-28] invite_link wrapper: hardened search_path (F12)". PR: #46 (open; needs SEC sign-off, then lead merge).
- Uncommitted work: none after this commit (pushed).
- Done: migration `supabase/migrations/20261103120000_invite_link.sql`: `private.invite_tokens` holds several hashes per invite (new `id` pk, `created_at`, index on `invite_id`, unique `token_hash`); existing rows kept, so links already shared keep working. `private.invite_link_at(p_now)` + `public.invite_link()` (definer, `search_path = pg_catalog, extensions, public, pg_temp`, authenticated only). `resolve_invite` already matched any token with `exists`, so `accept_invite`/`invite_preview` are unchanged (D02: valid token skips limiter, wrong token = `INVALID_CODE`); `create_invite` still revokes the old invite, which kills all its tokens. Tests: `supabase/tests/invite-link.test.mjs` (45 checks, incl. an upgrade test over a pre-migration token), `invite_link` added to private-helpers allowlist and error-codes anon/NOT_AUTHENTICATED checks. Types regenerated. CONTRACTS §2 row + create_invite note + change log.
- Not done: SEC sign-off (D02 token); lead review/merge; not deployed to a hosted project (no dev project identified, BE-27).
- **Contract as built:** `supabase.rpc('invite_link')`, no args. Returns `{code text, expires_at timestamptz, token text}` (composite `invite_created`, same as `create_invite`) for the caller's open invite (caller is inviter, not revoked/accepted, before `expires_at`, of the caller's current couple): same code and expiry, new 192-bit url-safe token (link `/j/BND<code>?t=<token>`). No open invite: SQL null; the app checks `!data?.token` (PostgREST may serialise it as `null` or an all-null object) and then calls `create_invite`. Errors: `NOT_AUTHENTICATED`; `RATE_LIMITED` after 10 `invite_link` tokens per invite (11 incl. create_invite's; the code and existing links keep working). anon: `permission denied` (42501). Never revokes the code or earlier tokens.
- Exact next step: wait for SEC sign-off and the lead's merge; answer review comments on the PR. Then BE-27 once the PO names the dev project ref.
- Commands to re-run: `npm --prefix supabase/tests ci && npm --prefix supabase/tests test` (invites-v2 takes several minutes: 10,000-code key-space section); `node supabase/tests/invite-link.test.mjs`; `node supabase/tests/hardening.test.mjs`; `npm --prefix supabase/tests run check:types`.
- Watch out for: never reset the shared `bonded` local stack (QA, `~/dev/bonded-qa`); never write to `nciyrepyphvksusoigzx` until it is confirmed dev. New definers must use the hardened search_path (hardening F12) and be in the private-helpers allowlist.

### BE-27 hosted parity (QA bug #28): blocked on the PO
- No hosted dev project is identifiable (`supabase projects list`: only `nciyrepyphvksusoigzx` "bonded", labelled production, and the inactive "Core"). Nothing read from or written to any hosted project.
- Next: PO names the dev project ref, then read-only GET `/v1/projects/<ref>/config/auth` and compare with `supabase/templates/magic_link.html`.
- PO operator checklist (dashboard, dev project): Site URL `bonded://`; Redirect URLs `bonded://auth/callback`, `bonded://**` (Expo Go: `exp://127.0.0.1:8081/--/**`); Magic Link and Confirm signup templates use `{{ .ConfirmationURL }}` link + `{{ .Token }}` code (no `{{ .TokenHash }}` links); Email OTP length 6; send a test sign-in email.

## Doing

- BE-28 (D36) `invite_link()`: PR #46 open, needs SEC sign-off (D02 token) and lead review.

## Done (since last update)

- BE-16 delete-account: PR #35 merged on main (6878bad); `be/BE-16-delete-account` is finished.
- BE-28: full `npm test` green on this branch (all 17 suites, 0 failures after the F12 fix), `check:types` up to date.

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
