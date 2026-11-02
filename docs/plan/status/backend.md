# Backend / data developer status
Updated: 2026-11-02 · Branch: be/BE-04-invites · Milestone: M1

## Resume here
<!-- Keep this current after every step: the next AI (Claude, Codex or Copilot) starts from it. -->
- Last AI / date: Claude Code · 2026-11-02
- Branch + last commit: be/BE-04-invites (from main 381cc5c, BE-24 + BE-03 merged); migration `20261102200000_invites_v2.sql`, tests, types, CONTRACTS done. **BE-04 ready for review** (SEC-01 flags below).
- Uncommitted work: none
- Exact next step: BE-05 Content model on be/BE-05-content (D11, D12, D14, D33): answers 1–500, `reactions.kind`, special questions, `first_day`, idempotent loader skipping `age_gate = 18+` unless `CONTENT_INCLUDE_AGE_GATED=true`, `seed.sql` from content + `qa/fixtures/personas.json`.
- Commands to re-run: `npm --prefix supabase/tests ci && npm --prefix supabase/tests test && node supabase/tests/gen-types.mjs --check`
- Watch out for: git needs DEVELOPER_DIR=/Library/Developer/CommandLineTools; push with `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push`. No Docker. No AI attribution in commits. Helpers are `private.*` (BE-24): call them schema-qualified. Invite/clock cores are `private.*_at(…, p_now)`: tests pin time there; the public wrappers pass `now()`. Test guesses must use a code no invite holds (`dead()` in invites-v2.test.mjs), codes are random.

## Doing
- BE-04 ready for review (then BE-05)

## Done (since last update)
- BE-01, BE-02, BE-24, BE-03 merged to main (381cc5c)
- BE-04 on be/BE-04-invites: migration `20261102200000_invites_v2.sql`. `pair_invites` gets `id` PK + `revoked_at`, `code` = 4 digits (check), partial unique indexes (active digits; one active invite per inviter), 48 h default, clients can only SELECT. `private.invite_tokens` (sha256 of a 192-bit token), `private.invite_attempts`, `private.security_alerts`. `create_invite()` → composite `invite_created(code, expires_at, token)`; `accept_invite(p_code, p_token?)` and `invite_preview(p_code, p_token?)` (anon) → `json`. Clock-taking cores `private.create_invite_at / accept_invite_at / invite_preview_at(…, p_now)`. D04: solo caller joins, solo couple deleted (cascade). D02: 5 failures / 15 min per actor (user, or sha256 of `cf-connecting-ip` / first `x-forwarded-for` for anon), shared by both RPCs; valid token skips it; 100 failures/hour globally upserts an `invite_guessing` row in `private.security_alerts` (nothing sends it yet: BE-08/BE-23 to pick up `notified_at is null`). `invites-v2.test.mjs` 128/128 (every code, the limit and its window edges, token, D04 merge, reveal rule across the merge, preview fields/timezone, anon IP limiter, global alert, public wrappers). Other suites updated: rls 23, error-codes 50, private-helpers 74, couples-v2 55. Types regenerated; CONTRACTS §2 rows + error-format exception + change-log row
- **Design decision to review (lead, SEC-01):** a raise rolls back the attempt row, so a limiter can't count failures that raise. For the counted failures (`INVALID_CODE`, `INVITE_EXPIRED`, `COUPLE_FULL`) these two RPCs commit the attempt and return the error as an HTTP 400 body via PostgREST's `response.status` GUC, body `{code:'P0001', message:'<CODE>', details:null, hint:null}`. supabase-js gives the same `error.message`. Cost: both RPCs return `json` (types: `Json`). **Not verifiable without the real stack** (PGlite tests assert the returned body and the GUC, not HTTP): confirm on `dev`/Docker CI that a wrong code gives HTTP 400 and that the attempt row persists. Alternative if rejected: an edge function in front.

## Next
- BE-05 (D33 loader, D11 500 chars, D12 first_day, D14), BE-23
- BE-09 sets `status = ended`, `ended_at`, `left_at` and relaxes the one-couple-per-user index to active memberships (it must also keep `accept_invite`'s `COUPLE_FULL` for ended couples)

## Blocked
- BE-01 `dev` project part (link, `db push`, deploy): waiting on LEAD-03
- real `supabase db reset` unverified locally (no Docker); QA's Docker CI job will cover it

## Needs from
- lead: review/merge BE-04; route to SEC-01 (list below). Mark D01, D02 (token), D04, D05, D06 `done (BE-04)` in DESIGN_DELTA. Files outside my ownership: none
- SEC-01: (1) the 400-body-instead-of-raise design above; (2) anon `invite_preview`: actor = hashed `cf-connecting-ip`, else first `x-forwarded-for` (spoofable if the gateway doesn't overwrite it; if no header, all anon share one `ip:unknown`-hash bucket); (3) 10,000-code space: an attacker with many accounts/IPs can still enumerate, only the global alert (100/h, not yet delivered) notices; (4) accepted-code lookup answers `COUPLE_FULL` for 48 h after use (reveals that a code was used); (5) D04 deletion cascades the caller's solo answers irreversibly; their birthday key date is not carried over; (6) possible deadlock when two solo users accept each other's invites at the same instant (one aborts, no data loss); (7) `create_invite` rotates the token each call, the app can't re-show a link without rotating
- mobile: ack BE-04 (**breaking**): `create_invite` returns `{code, expires_at, token}` (code = 4 digits, show `BND·4827`, link `/j/BND4827?t=<token>`); `accept_invite(p_code, p_token?)` returns the couple id as `Json`; `invite_preview` is callable before sign-in; wrong code, expired and full arrive as `error` with `error.message` = code (HTTP 400 body, not a thrown Postgres error: do not rely on `error.code`); `RATE_LIMITED` after 5 failures in 15 min (skipped by `p_token`); read your invite with explicit columns (`code, expires_at, accepted_at, revoked_at`); regenerate types
- qa: ack BE-04; `npm --prefix supabase/tests test` runs five suites (rls, error-codes, private-helpers, couples-v2, invites-v2); contract tests (QA-03) must expect the 400 body for the three counted codes; Maestro J9/J10/56 map to `INVALID_CODE`/`COUPLE_FULL`/`INVITE_EXPIRED`

## Contract changes in flight
- BE-04: invites v2 (mobile + qa ack, breaking: return types of `create_invite` and `accept_invite`, 6-char codes dead)

## Questions for the product owner
- install Docker Desktop (or Podman) on the dev Mac so `supabase start` / `db reset` can run locally
