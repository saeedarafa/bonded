# Backend / data developer status

Updated: 2026-11-03 · Branch: `be/BE-26-typed-code-approval` · Task: BE-26 (#41, D02 typed-code approval); BE-28 (#46) awaiting merge

## Resume here

- Last AI / date: Claude Code · 2026-11-03
- Worktree: `/Users/saeedarafa/dev/bonded-be` (only this one).
- **Current task: BE-26 (D02), PR #41**, branch `be/BE-26-typed-code-approval` (now based on `main`; `gh pr edit 41 --base main` done). Local branch was stale (2 pre-rebase commits); kept as local `backup/BE-26-local-stale`, local branch moved to `origin/be/BE-26-typed-code-approval` (c72c7d0), then `git merge origin/main` (no rebase).
- BE-26 progress: merge conflicts resolved (CONTRACTS, types, package.json, private-helpers allowlist, this file). Migrations renamed to `20261103130000_typed_code_approval.sql` / `20261103140000_typed_code_approval_complete.sql` (after `invite_link`). Fix: `approve_join` now completes exactly the request's invite (`accept_invite_at(..., p_approved_invite uuid)`), and a revoked/used/expired invite voids the request (`JOIN_REQUEST_EXPIRED`, not counted); before, approval re-resolved by the 4 digits and could pair into another inviter's reissued code. CONTRACTS: `accept_invite` row rewritten (pending shape), Error format restored with the new codes, change log `breaking: yes`.
- BE-26 tests added in `supabase/tests/join-requests.test.mjs` (20 pass; +2 BE-28 checks that run once `invite_link` is on the base, verified locally with BE-28's migration: 22 pass; BE-28's `invite-link.test.mjs` also passes with BE-26 applied, 45/45). Full `npm test` green, `check:types` up to date. Pushed; review reply posted on #41.
- BE-26 still open: mobile ack (breaking `accept_invite` typed-code response), SEC-02 sign-off, lead merge. When #46 merges first, #41 will conflict in `private-helpers.test.mjs` (allowlist), `supabase/tests/package.json` (test list), CONTRACTS change log and `src/types/database.ts`: merge `origin/main` again, keep both entries, regenerate types.
- **BE-28 (D36), PR #46**: SEC-03 signed off; main merged in (head `b68739a`), full suite green; awaiting the lead's merge.
- Done: migration `supabase/migrations/20261103120000_invite_link.sql` (sorts after `20261103110000_delete_account.sql`): `private.invite_tokens` holds several hashes per invite (new `id` pk, `created_at`, index on `invite_id`, unique `token_hash`); existing rows kept, so links already shared keep working. `private.invite_link_at(p_now)` + `public.invite_link()` (definer, `search_path = pg_catalog, extensions, public, pg_temp`, authenticated only). `resolve_invite` already matched any token with `exists`, so `accept_invite`/`invite_preview` are unchanged (D02: valid token skips limiter, wrong token = `INVALID_CODE`); `create_invite` still revokes the old invite, which kills all its tokens. Tests: `supabase/tests/invite-link.test.mjs` (45 checks, incl. an upgrade test over a pre-migration token); `invite_link` in the private-helpers allowlist and error-codes anon/NOT_AUTHENTICATED checks. Types regenerated. CONTRACTS §2 row + create_invite note + change log (after the BE-16 row).
- Not done: lead merge of #46; not deployed to a hosted project (no dev project identified, BE-27).
- **Contract as built:** `supabase.rpc('invite_link')`, no args. Returns `{code text, expires_at timestamptz, token text}` (composite `invite_created`, same as `create_invite`) for the caller's open invite (caller is inviter, not revoked/accepted, before `expires_at`, of the caller's current couple): same code and expiry, new 192-bit url-safe token (link `/j/BND<code>?t=<token>`). No open invite: SQL null; the app checks `!data?.token` (PostgREST may serialise it as `null` or an all-null object) and then calls `create_invite`. Errors: `NOT_AUTHENTICATED`; `RATE_LIMITED` after 10 `invite_link` tokens per invite (11 incl. create_invite's; the code and existing links keep working). anon: `permission denied` (42501). Never revokes the code or earlier tokens.
- Exact next step: wait for the lead (#46 merge, #41 review), mobile ack and SEC-02 on #41. After #46 lands: on `be/BE-26-typed-code-approval` run `git merge origin/main`, resolve as above, `node supabase/tests/gen-types.mjs`, full suite (the BE-28 block in join-requests must PASS, not SKIP), push. Then BE-10 / BE-27 when unblocked.
- Commands to re-run: `npm --prefix supabase/tests ci && npm --prefix supabase/tests test` (invites-v2 takes several minutes: 10,000-code key-space section); `node supabase/tests/invite-link.test.mjs`; `node supabase/tests/hardening.test.mjs`; `npm --prefix supabase/tests run check:types`; `bash qa/ci/functions.sh`; `deno fmt --check supabase/functions`.
- Watch out for: never reset the shared `bonded` local stack (QA, `~/dev/bonded-qa`); never write to `nciyrepyphvksusoigzx` until it is confirmed dev. New definers must use the hardened search_path (hardening F12) and be in the private-helpers allowlist. `feedback.user_id` cascades on profile delete (accepted, D09).

### BE-27 hosted parity (QA bug #28): blocked on the PO
- No hosted dev project is identifiable (`supabase projects list`: only `nciyrepyphvksusoigzx` "bonded", labelled production, and the inactive "Core"). Nothing read from or written to any hosted project.
- Next: PO names the dev project ref, then read-only GET `/v1/projects/<ref>/config/auth` and compare with `supabase/templates/magic_link.html`.
- PO operator checklist (dashboard, dev project): Site URL `bonded://`; Redirect URLs `bonded://auth/callback`, `bonded://**` (Expo Go: `exp://127.0.0.1:8081/--/**`); Magic Link and Confirm signup templates use `{{ .ConfirmationURL }}` link + `{{ .Token }}` code (no `{{ .TokenHash }}` links); Email OTP length 6; send a test sign-in email.

## Doing

- BE-28 (D36) `invite_link()`: PR #46 (head b68739a), SEC signed off, awaiting lead merge.
- BE-26 (#41) typed-code approval: main merged in, review items in progress (see Resume here).

## Done

- BE-16 delete-account: PR #35 merged on main (6878bad); `be/BE-16-delete-account` is finished. delete-account removes `avatars/{uid}/avatar.jpg` before `auth.admin.deleteUser`; failure = `500 DELETE_FAILED`; 404/`USER_NOT_FOUND` = `200`.
- BE-28: full `npm test` green on the branch (0 failures), `check:types` up to date; SEC-03 signed off.
- #44 email sign-in (templates, `bonded://auth/callback` allow-list, `auth-email.test.mjs`) merged to main.
- PR #34 / BE-06 fixes `completed_today`.

## Blocked

- BE-27 and any dev deployment: no unambiguous dev project.
- BE-10 and BE-19 wait for BE-08 to merge.
- Email delivery and real link/code consumption untested (shared QA stack must stay untouched).

## Needs from

- **Contract changed (additive), mobile MOB-33:** `supabase.rpc('invite_link')` (no args) returns `{code, expires_at, token}` for your open invite with a new link token, or no invite (`!data?.token`) → call `create_invite`. It never replaces the code. Errors: `NOT_AUTHENTICATED`, `RATE_LIMITED` (after 10 per invite; keep sharing the code text). See CONTRACTS §2.
- **QA QA-12:** contract tests for `invite_link()` (CONTRACTS §2 row).
- Lead: merge #46 when CI is green; review #41 after BE-26 updates; review/merge #17, #21, #25.
- PO: name the hosted dev project ref (BE-27, BE-08 deployment).
- Mobile / QA: BE-16 `delete-account` is live (`{ok:true}`; retry after failure is safe).
