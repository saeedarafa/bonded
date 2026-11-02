# Security reviewer status
Updated: 2026-11-02 · Branch: security/SEC-01-pairing-review · Milestone: M1

## Resume here
<!-- Keep this current after every step: the next AI (Claude, Codex or Copilot) starts from it. -->
- Last AI / date: Codex · 2026-11-02
- Branch + review commit: security/SEC-01-pairing-review @ 211c41f `[SEC-01] Re-review pairing hardening`
- Uncommitted work: none after this resume-record commit (push both commits)
- Exact next step: backend must close BE-04c R1 (pair-period RLS for historical threads/reactions), then request a final SEC-01 source review and approved-environment test evidence.
- Commands to re-run: source-only: `git diff --check main...be/BE-04c-hardening` (passed); do not run target tests without the security-audit sandbox controls. Backend/QA should run `npm --prefix supabase/tests test` and a real-stack concurrent-RPC regression in their approved environment.
- Watch out for: guidance mode, source-only. Original `main` review: `5becc34`; latest read-only PR #1 review: `234d228` (`origin/be/BE-04c-hardening`).

## Doing
- SEC-01 re-review of PR #1 complete at `234d228`; not approved while BE-04c R1 is open.

## Done (since last update)
- Reviewed BE-04 invites v2 and BE-05 on `main` (`5becc34`), scoped to D02/D06, anon preview, token, rate limits, and solo/ended-couple RLS. No target-controlled build, test, local stack, or live service was run.
- Read-only review of `be/BE-04c-hardening` at `e01f8e7`; Git whitespace check passed.
- Re-reviewed PR #1 at `234d228` after fetching. The only change since `e01f8e7` is QA's merge `b205cc7` (counter-reset/test seeding in `qa/contract/helpers.ts` and `qa/contract/invites.test.ts`); no hardening migration or product-policy change was made. `git diff --check e01f8e7..234d228` passed. No target-controlled test was run.
- Confirmed findings (source evidence, prerequisite, impact, smallest fix):
  - **F8 — Fixed in PR #1 source; execution evidence pending.** The original concurrent-request bypass came from an unlocked count-then-insert (`supabase/migrations/20261102200000_invites_v2.sql:242-246`, `291-295`, `95-119`). PR #1 serializes each actor before the limiter check in both accept and anon preview (`20261102215000_pairing_hardening.sql:184-211`, `258-276`) and includes a focused hardening regression. Backend/QA still need to execute a real concurrent-RPC check in an approved local/Docker environment.
  - **F2 — Fixed in PR #1 source; execution evidence pending.** The original RLS allowed a new member to answer/reveal historic solo questions (`0001_mvp.sql:394-406`). PR #1 records `paired_at`, preserves only the documented pairing-day daily exception, and requires the pair period for answer insertion/reveal (`20261102215000_pairing_hardening.sql:15-62`).
  - **F5 — Fixed in PR #1 source; execution evidence pending.** The original D04 path deleted the caller's former solo couple without locking/re-checking it (`20261102200000_invites_v2.sql:237-265`). PR #1 locks both couples in stable order and re-checks the caller's row immediately before deletion (`20261102215000_pairing_hardening.sql:178-253`).
  - **BE-04c R1 — Medium residual: pair-period RLS is incomplete for already-created data.** BE-04c restricts only `answers` (`20261102215000_pairing_hardening.sql:50-62`). Existing policies still allow a member to read/post thread messages once two historical answers exist and to read/react based only on membership/own answer (`0001_mvp.sql:408-424`). A joiner who supplied a solo-period answer before the hardening migration (or any pre-existing two-answer row) can still access that question's thread/reaction metadata after migration. Smallest fix: add `private.cq_in_pair_period(...)` to thread-message, reaction, and read-marker policies (including updates/deletes as appropriate), and migrate/regression-test a pre-hardening paired row.

## Next
- Do not approve PR #1 yet: resolve BE-04c R1, then verify its regression and F8/F2/F5 on an approved local/Docker stack. Also retain the HTTP-400-body validation requirement.

## Blocked
- No blocker for guidance review. The following are `needs_validation`, not confirmed vulnerabilities: production gateway/header behavior; production signup/CAPTCHA controls; real PostgREST handling of the `response.status` body; and the BE-09 ended-couple lifecycle (not yet implemented).

## Needs from
- lead: PR #1 has source-level fixes for F8/F2/F5, but must not merge with BE-04c R1 open; D02's typed-code fallback remains a product/security decision.
- backend: add the BE-04c R1 policy/data-migration regression; retain the F8/F2/F5 fixes. Confirm the configured Storage host fails closed before enabling avatars in anon preview.
- qa: in an approved local/Docker environment, test concurrent `accept_invite` and `invite_preview`, and confirm counted errors are HTTP 400 while their attempt records persist.
- product owner / lead: decide whether a manually typed 4-digit code requires inviter approval. Even with the per-actor limiter, the global control is alert-only (`20261102200000_invites_v2.sql:104-118`) and the code space is 10,000; BE-04c intentionally leaves this as a PO decision.

## Contract changes in flight
- BE-04c proposes `couples.paired_at` and a 10/hour `create_invite` throttle. It is not on `main`.

## Questions for the product owner
- D02: should a typed code create a pending join that the inviter approves, while a tokenized link joins immediately? This is the smallest durable defence against distributed 4-digit-code guessing.
- D04: should deletion of the joiner's solo couple be recoverable under the D08 30-day ended-couple window?

## Needs-validation detail
- **Anon actor identity:** `private.invite_actor` trusts `cf-connecting-ip`, then the first `x-forwarded-for`, and otherwise uses a single `unknown` bucket (`supabase/migrations/20261102200000_invites_v2.sql:81-93`). Verify on the deployed Supabase gateway that client-supplied values cannot spoof/replace the trusted header and that it is always present; otherwise anon preview throttling can be bypassed or can deny all headerless users together.
- **Token / link handling:** token generation is 24 random bytes and only a SHA-256 hash is stored (`20261102200000_invites_v2.sql:171-211`); grants expose only `invite_preview` to anon (`319-341`). No source flaw found here. Validate the eventual `/j/{code}?t=` site/app flow uses HTTPS, avoids logging query strings, and sends a restrictive referrer policy.
- **Anon preview payload:** it returns only the documented fields (`20261102200000_invites_v2.sql:307-316`), but `avatar_url` is caller-controlled by the inviter and unrestricted on `main`. Validate the mobile renderer and Storage policy; BE-04c's allowlist/fail-closed approach at `20261102215000_pairing_hardening.sql:255-303` is preferred.
- **Ended couples:** D08's 30-day read window is BE-09 work. Current RLS is membership-only (`0001_mvp.sql:379-435`) and `private.my_couple_id` does not consult `status`, `ended_at`, or `left_at` (`20261102180000_private_helpers.sql:26-29`), so an ended row would remain readable indefinitely. `unpair()` still deletes rather than ends (`0001_mvp.sql:298-304`); verify BE-09 changes every dependent policy/helper before an ended-couple writer lands.
- **Definer search path:** current security-definer functions use `search_path = public` (for example `20261102200000_invites_v2.sql:215-219`, `319-323`). Whether untrusted roles can create shadowing objects in this deployment is not established from source; verify schema privileges. BE-04c defensively sets a safe path and revokes public-schema CREATE (`20261102215000_pairing_hardening.sql:371-389`).
