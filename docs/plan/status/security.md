# Security reviewer status
Updated: 2026-11-02 · Branch: security/SEC-01-pairing-review · Milestone: M1

## Resume here
<!-- Keep this current after every step: the next AI (Claude, Codex or Copilot) starts from it. -->
- Last AI / date: Codex · 2026-11-02
- Branch + review commit: security/SEC-01-pairing-review @ 5de5c7a `[SEC-01] Pairing guidance review`
- Uncommitted work: none after this resume-record commit (push both commits)
- Exact next step: lead/backend triage the confirmed findings below; independently review the next BE-04c revision, especially the historical thread/reaction RLS gap.
- Commands to re-run: source-only: `git diff --check main...be/BE-04c-hardening` (passed); do not run target tests without the security-audit sandbox controls. Backend/QA should run `npm --prefix supabase/tests test` and a real-stack concurrent-RPC regression in their approved environment.
- Watch out for: this was guidance mode, source-only. `main` reviewed at `5becc34`; read-only hardening review at `e01f8e7` (`be/BE-04c-hardening`).

## Doing
- SEC-01 pairing guidance review complete; handoff awaiting lead/backend action.

## Done (since last update)
- Reviewed BE-04 invites v2 and BE-05 on `main` (`5becc34`), scoped to D02/D06, anon preview, token, rate limits, and solo/ended-couple RLS. No target-controlled build, test, local stack, or live service was run.
- Read-only review of `be/BE-04c-hardening` at `e01f8e7`; Git whitespace check passed.
- Confirmed findings (source evidence, prerequisite, impact, smallest fix):
  - **F8 — High: concurrent requests bypass the D02 five-failure limit.** `private.accept_invite_at` / `invite_preview_at` check `private.invite_limited` before calling `private.invite_fail` (`supabase/migrations/20261102200000_invites_v2.sql:242-246`, `291-295`); the check is a plain count and the insert has no unique constraint or lock (`95-119`). Concurrent requests by one authenticated actor (or one anon actor) can all observe fewer than five rows, then each record a failure. A valid 4-digit code lets the caller join the stranger's couple and unlock the pairing-day answer. Smallest fix: serialize check+failure insert per actor (transaction advisory lock) and add a concurrent regression. BE-04c implements the lock at `20261102215000_pairing_hardening.sql:184-211`, `258-276`.
  - **F2 — Medium: joining exposes and permits answers to the inviter's solo-period questions, not just the pairing-day daily question.** A solo couple can receive questions (`20261102210000_content_model.sql:63-103`); `accept_invite` adds the joiner to that same couple (`20261102200000_invites_v2.sql:263-266`); answer RLS allows any member who writes their own answer to read the partner's answer, with no pairing-time condition (`0001_mvp.sql:394-406`). An accepted-code holder can answer historic solo questions and reveal the inviter's private pre-pairing answers. Smallest fix: record `paired_at` and require a question to be in the pair period for answer/reveal (with the documented pairing-day daily exception), plus tests. BE-04c adds this at `20261102215000_pairing_hardening.sql:15-62`.
  - **F5 — Medium: D04 can delete a solo couple after it gained a second member.** `accept_invite` obtains `v_mine` and checks its member count before locking only the invite and inviter couple (`20261102200000_invites_v2.sql:237-256`), then unconditionally deletes `v_mine` (`263-265`). In a crossing accept, another transaction can add a member to the caller's solo couple between those steps; the cascade then deletes that new member's couple history. Smallest fix: lock both couple rows in a fixed order and re-check that the caller's is still active and solo immediately before deletion. BE-04c does this at `20261102215000_pairing_hardening.sql:178-253`.
  - **BE-04c R1 — Medium residual: pair-period RLS is incomplete for already-created data.** BE-04c restricts only `answers` (`20261102215000_pairing_hardening.sql:50-62`). Existing policies still allow a member to read/post thread messages once two historical answers exist and to read/react based only on membership/own answer (`0001_mvp.sql:408-424`). A joiner who supplied a solo-period answer before the hardening migration (or any pre-existing two-answer row) can still access that question's thread/reaction metadata after migration. Smallest fix: add `private.cq_in_pair_period(...)` to thread-message, reaction, and read-marker policies (including updates/deletes as appropriate), and migrate/regression-test a pre-hardening paired row.

## Next
- SEC-01: verify the backend's fixes on the revised branch; do not approve until F8, F2, F5 and BE-04c R1 are resolved and backend/QA provide real-stack evidence for the HTTP-400-body contract.

## Blocked
- No blocker for guidance review. The following are `needs_validation`, not confirmed vulnerabilities: production gateway/header behavior; production signup/CAPTCHA controls; real PostgREST handling of the `response.status` body; and the BE-09 ended-couple lifecycle (not yet implemented).

## Needs from
- lead: triage F8, F2, F5 and BE-04c R1 before merging BE-04c; D02's typed-code fallback remains a product/security decision.
- backend: add the BE-04c R1 policy/data-migration regression; retain BE-04c's F8/F2/F5 fixes. Confirm the configured Storage host fails closed before enabling avatars in anon preview.
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
