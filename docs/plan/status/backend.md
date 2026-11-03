# Backend / data developer status

Updated: 2026-11-03 · Branch: `be/BE-26-typed-code-approval` · Task: BE-26 (#41, D02 typed-code approval); BE-28 merged (#46)

## Resume here

- Last AI / date: Codex · 2026-11-03.
- Worktree: `/Users/saeedarafa/dev/codex-backend/bonded` only.
- Task / branch: BE-26, PR #41, `be/BE-26-typed-code-approval`; remote implementation `86895dc` fast-forwarded, then `origin/main` (`1afafb5`) merged without rebase. This merge checkpoint contains the status refresh; working tree clean after commit/push.
- Verified handoff: original lead review fixes are already pushed (token fixtures, pending-answer RLS, breaking contract, invite-id-pinned approval, mandatory BE-28 coverage). Main includes mobile #42 error keys and BE-28 #46.
- Latest review: SEC-04 on #41 requests F1 requester first name visible to inviter only for live pending requests, and F2 sticky declines plus a pending-request cap. D02 is not signed off. Also address N1 obsolete destructive helper, N2 restore JWT subject after approval, N3 table grant hygiene; N4 Realtime DELETE behaviour needs a named dev project.
- Exact next step: implement SEC-04 F1/F2 with behaviour tests and CONTRACTS updates, regenerate types, run all backend suites, commit/push each completed step. Then report evidence on #41 and request security re-review and mobile breaking-contract ack. Never merge the PR.
- Commands to re-run: `npm --prefix supabase/tests ci`; `npm --prefix supabase/tests test`; `npm --prefix supabase/tests run check:types`; `node supabase/scripts/build-seed.mjs --check`; `bash qa/ci/functions.sh`; `deno fmt --check supabase/functions`.
- Watch out for: never reset QA's shared `bonded` stack or deploy to an unidentified hosted project. PGlite isolates test databases. Migration 130000/140000 are unmerged BE-26 files; main's migrations are immutable. Merge main, never rebase/force-push.

### BE-27 hosted parity (QA bug #28): blocked on the PO
- No hosted dev project is identifiable (`supabase projects list`: only `nciyrepyphvksusoigzx` "bonded", labelled production, and the inactive "Core"). Nothing read from or written to any hosted project.
- Next: PO names the dev project ref, then read-only GET `/v1/projects/<ref>/config/auth` and compare with `supabase/templates/magic_link.html`.
- PO operator checklist (dashboard, dev project): Site URL `bonded://`; Redirect URLs `bonded://auth/callback`, `bonded://**` (Expo Go: `exp://127.0.0.1:8081/--/**`); Magic Link and Confirm signup templates use `{{ .ConfirmationURL }}` link + `{{ .Token }}` code (no `{{ .TokenHash }}` links); Email OTP length 6; send a test sign-in email.

## Doing

- BE-26 (#41): addressing SEC-04 F1/F2 after merging main (`1afafb5`).

## Done

- BE-16 delete-account: PR #35 merged on main (6878bad); `be/BE-16-delete-account` is finished. delete-account removes `avatars/{uid}/avatar.jpg` before `auth.admin.deleteUser`; failure = `500 DELETE_FAILED`; 404/`USER_NOT_FOUND` = `200`.
- BE-28 / #46 merged (db6e9e7): `invite_link()`, SEC-03 signed off.
- #44 email sign-in (templates, `bonded://auth/callback` allow-list, `auth-email.test.mjs`) merged to main.
- PR #34 / BE-06 fixes `completed_today`.

## Blocked

- BE-27 and any dev deployment: no unambiguous dev project.
- BE-26 merge waits for SEC-04 re-review / D02 sign-off and mobile ack. BE-08 / #17 is merged; BE-10 is next after BE-26.
- Email delivery and real link/code consumption untested (shared QA stack must stay untouched).

## Needs from

- **Contract changed (additive), mobile MOB-33:** `supabase.rpc('invite_link')` (no args) returns `{code, expires_at, token}` for your open invite with a new link token, or no invite (`!data?.token`) → call `create_invite`. It never replaces the code. Errors: `NOT_AUTHENTICATED`, `RATE_LIMITED` (after 10 per invite; keep sharing the code text). See CONTRACTS §2.
- **QA QA-12:** contract tests for `invite_link()` (CONTRACTS §2 row).
- Lead/security: re-review #41 after the SEC-04 fixes; mobile: ack the breaking typed-code pending response. #17, #21, #25, #35 and #46 are merged.
- PO: name the hosted dev project ref (BE-27, BE-08 deployment).
- Mobile / QA: BE-16 `delete-account` is live (`{ok:true}`; retry after failure is safe).
