# Backend / data developer status

Updated: 2026-11-03 · Branch: `be/BE-16-delete-account` · Milestone: M4

## Resume here

- Last AI / date: Claude Code · 2026-11-03
- Branch + last commit: `be/BE-16-delete-account`; merged `origin/main` again after #44 (d9db934, 25fe7ee) landed; no rebase or force-push. Lead accepted #35, including the migration rename and feedback cascade (D09).
- Uncommitted work: none (pushed).
- State: delete-account removes `avatars/{uid}/avatar.jpg` before `auth.admin.deleteUser`; storage or delete failure = `500 DELETE_FAILED` (fixed message, no user data); 404/`USER_NOT_FOUND` = `200`. Migration is `20261103110000_delete_account.sql` (sorts after main's feedback migration).
- Exact next step: wait for CI on PR #35 and the lead's merge. Then BE-27 (below) once the PO names the dev project ref.
- Commands to re-run: `bash qa/ci/functions.sh`; `deno fmt --check supabase/functions`; `npm --prefix supabase/tests ci && npm --prefix supabase/tests test`; `npm --prefix supabase/tests run check:types`; `node supabase/tests/auth-email.test.mjs`.
- Watch out for: never reset the shared `bonded` local stack (QA, `~/dev/bonded-qa`); never write to `nciyrepyphvksusoigzx` until it is confirmed dev. `feedback.user_id` cascades on profile delete (accepted, D09).

### BE-27 hosted parity (QA bug #28): blocked on the PO
- **No hosted dev project is identifiable.** `supabase projects list` (read-only) shows only `nciyrepyphvksusoigzx` "bonded" (linked; the lead labels it production) and `urkqzkrceetonljagzfk` "Core" (INACTIVE, unrelated). No `bonded-dev` exists (ACCOUNTS row 2 still open). Hosted auth config was not read; nothing was written to any hosted project. Repo templates stay as is (`{{ .ConfirmationURL }}` link + `{{ .Token }}` code; merged in #44).
- Next: PO names the dev project ref (or confirms `nciyrepyphvksusoigzx` is dev), then read-only GET `/v1/projects/<ref>/config/auth` and compare with `supabase/templates/magic_link.html`.
- PO operator checklist (dashboard, dev project):
  1. Auth -> URL Configuration -> Site URL: `bonded://`.
  2. Redirect URLs: `bonded://auth/callback` (and `bonded://**`; for Expo Go dev also `exp://127.0.0.1:8081/--/**`).
  3. Email Templates -> Magic Link and Confirm signup: link `<a href="{{ .ConfirmationURL }}">`, code `{{ .Token }}`. No custom `{{ .TokenHash }}` / `token=` links: the app accepts only `?code=` (PKCE).
  4. Providers -> Email: OTP length 6.
  5. Send a test sign-in email: 6-digit code plus a link that opens Bonded on the same phone.

## Doing

- BE-16 delete-account / PR #35: lead-accepted; merged with main after #44; awaiting CI and merge.

## Done

- #44 email sign-in (templates, `bonded://auth/callback` allow-list, `auth-email.test.mjs`) merged to main.
- PR #17 / BE-08 and PR #21 / BE-25 green, awaiting lead merge. PR #25 / BE-20 green, awaiting lead review.
- PR #34 / BE-06 fixes `completed_today`.

## Next

- Monitor PR #35. BE-27 once the PO names the dev project.

## Blocked

- BE-27 and any dev deployment: no unambiguous dev project.
- BE-10 and BE-19 wait for BE-08 to merge.
- Email delivery and real link/code consumption untested (shared QA stack must stay untouched).

## Needs from

- Lead: merge #35 when CI is green; review/merge #17, #21, #25.
- PO: name the dev project ref for BE-27 and BE-08 deployment.
- Mobile / QA: BE-16 makes `delete-account` live (`{ok:true}`; retry after failure is safe; the partner keeps only their own 30-day archive). Email content changed in #44 (no DB/API contract change): verify link and 6-digit code sign-in after an agreed Auth reload.
