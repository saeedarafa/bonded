# Backend / data developer status
Updated: 2026-11-02 · Branch: be/BE-02-error-codes · Milestone: M1

## Resume here
<!-- Keep this current after every step: the next AI (Claude, Codex or Copilot) starts from it. -->
- Last AI / date: Claude Code · 2026-11-02 (stopped at usage limit)
- Branch + last commit: be/BE-24-private-helpers @ main 0a627dd (no BE-24 work yet). BE-01 and BE-02 are merged to main.
- Uncommitted work: none
- Exact next step: BE-24 (BACKLOG, M1 P0): new migration moving the 0001 SECURITY DEFINER helpers (is_couple_premium, answer_cq, …) into `private` (or revoking them from anon/authenticated); tests that anon and other couples can't call them; reveal-rule suite green; regenerate types; change-log line if something public disappears. Then BE-03 Couples v2 (D03, D10) on be/BE-03-couples-v2 from main.
- Commands to re-run: `npm --prefix supabase/tests ci && npm --prefix supabase/tests test && node supabase/tests/gen-types.mjs --check`
- Watch out for: git needs DEVELOPER_DIR=/Library/Developer/CommandLineTools. No Docker. No AI attribution in commits.

## Doing
- nothing (BE-02 waiting on lead review)

## Done (since last update)
- [BE-01] Status: merged, types on main (be3ae4e; lead docs follow-up 4ae26b2)
- BE-02 on be/BE-02-error-codes (not merged): migration `20261102170000_error_codes.sql` (enum `error_code`, `private.raise_error`, the 5 live RPCs raise exact codes, RPCs revoked from anon); `supabase/tests/error-codes.test.mjs` 44/44; CONTRACTS §2 + change-log row; types regenerated (enum added, no signature changes)

## Next
- BE-03 (couples v2: solo couple; then create_invite raises NOT_PAIRED), BE-05 (D33: loader skips `age_gate = 18+` unless CONTENT_INCLUDE_AGE_GATED=true), BE-23
- BE-04 adds RATE_LIMITED + the D02 link token (skips the failed-attempt limit); BE-10 NUDGE_LIMIT/PARTNER_ALREADY_ANSWERED; BE-11 SAVER_UNAVAILABLE. Codes already catalogued; error-codes.test.mjs prints TODO lines for them

## Blocked
- BE-01 `dev` project part (link, `db push`, deploy): waiting on LEAD-03
- real `supabase db reset` unverified locally (no Docker); QA's Docker CI job will cover it

## Needs from
- lead: review BE-02. Files outside my ownership: none (CONTRACTS §2 is mine). Flag for SEC-01: 0001's helper functions (`is_couple_premium(uuid)`, `answer_cq`, `message_cq`, `has_answered`, `both_answered`, `is_cq_member`, `my_couple_id`) are SECURITY DEFINER and callable as RPCs by anon/authenticated. `is_couple_premium(any couple id)` and `answer_cq(any answer id)` leak small facts across couples. Proposal: move them to `private` in a later migration (RLS policies keep working). Not changed in BE-02
- mobile: ack the CONTRACTS §2 change in the BE-02 PR. For `src/lib/errors.ts`: map `Database['public']['Enums']['error_code']` exhaustively (runtime list: `Constants.public.Enums.error_code`); new code `QUESTION_UNAVAILABLE`; `unpair` retry → `NOT_PAIRED` = already done; anon RPC calls fail with `42501` permission denied = signed out
- qa: `npm --prefix supabase/tests test` now runs both suites (rls + error-codes); no CI change needed if CI already calls `npm test`. Contract tests can assert each code in error-codes.test.mjs

## Contract changes in flight
- BE-02: §2 codes enum, `QUESTION_UNAVAILABLE`, `unpair` NOT_PAIRED, anon revoked (needs mobile ack)

## Questions for the product owner
- install Docker Desktop (or Podman) on the dev Mac so `supabase start` / `db reset` can run locally
