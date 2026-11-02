# Backend / data developer status
Updated: 2026-11-02 · Branch: be/BE-24-private-helpers · Milestone: M1

## Resume here
<!-- Keep this current after every step: the next AI (Claude, Codex or Copilot) starts from it. -->
- Last AI / date: Claude Code · 2026-11-02
- Branch + last commit: be/BE-24-private-helpers @ 8b43395 "[BE-24] Move RLS helpers to private schema; tests, types, contract" (main merged in first, 53f6bb3). Pushed.
- Uncommitted work: none
- Exact next step: BE-03 Couples v2 (D03, D10) on be/BE-03-couples-v2, branched from be/BE-24-private-helpers (BE-24 not merged yet; its migration is needed because BE-03 calls `private.my_couple_id()`).
- Commands to re-run: `npm --prefix supabase/tests ci && npm --prefix supabase/tests test && node supabase/tests/gen-types.mjs --check`
- Watch out for: git needs DEVELOPER_DIR=/Library/Developer/CommandLineTools; push with `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push`. No Docker. No AI attribution in commits. Helpers are now `private.*`: call them schema-qualified from new SQL.

## Doing
- nothing on BE-24 (waiting on lead review + SEC-01)

## Done (since last update)
- BE-01, BE-02 merged to main
- BE-24 on be/BE-24-private-helpers (not merged): migration `20261102180000_private_helpers.sql` moves `my_couple_id`, `is_cq_member`, `has_answered`, `both_answered`, `answer_cq`, `message_cq`, `is_couple_premium` to `private` (policies keep their OIDs; bodies and the 4 RPCs that call them re-created with qualified names); anon EXECUTE revoked, authenticated keeps EXECUTE without schema USAGE. New `supabase/tests/private-helpers.test.mjs` 74/74 (anon, other couple and unpaired user can't call private.* or public.*; policies for answers/threads/reactions/profiles/couples still work; no stray public SECURITY DEFINER). rls 22/22, error-codes 44/44. Types regenerated (7 helper entries removed). CONTRACTS §2 note + change-log row

## Next
- BE-03 (couples v2), BE-05 (D33 loader), BE-23
- BE-04 adds RATE_LIMITED + the D02 link token; BE-10 NUDGE_LIMIT/PARTNER_ALREADY_ANSWERED; BE-11 SAVER_UNAVAILABLE

## Blocked
- BE-01 `dev` project part (link, `db push`, deploy): waiting on LEAD-03
- real `supabase db reset` unverified locally (no Docker); QA's Docker CI job will cover it

## Needs from
- lead: review BE-24; route to SEC-01 (it closes the helper exposure I flagged in BE-02). Files outside my ownership: none. Your skill `.github/skills/bonded-db-change/SKILL.md` §1 still names the helpers without the `private.` prefix: please update
- mobile: ack the BE-24 change-log row (helpers gone from `Database['public']['Functions']`; nothing in `src/` used them)
- qa: ack the BE-24 row; `npm --prefix supabase/tests test` now runs three suites (rls, error-codes, private-helpers)

## Contract changes in flight
- BE-24: RLS helpers moved to `private` (removal of undocumented functions; mobile + qa ack)

## Questions for the product owner
- install Docker Desktop (or Podman) on the dev Mac so `supabase start` / `db reset` can run locally
