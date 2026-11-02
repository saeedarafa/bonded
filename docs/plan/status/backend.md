# Backend / data developer status
Updated: 2026-11-02 · Branch: be/BE-03-couples-v2 · Milestone: M1

## Resume here
<!-- Keep this current after every step: the next AI (Claude, Codex or Copilot) starts from it. -->
- Last AI / date: Claude Code · 2026-11-02
- Branch + last commit: be/BE-03-couples-v2 @ b1e2f31 "[BE-03] Couples v2: create_couple, key_dates, couple status; tests, types, contract" (+ this status commit). **Branched from be/BE-24-private-helpers** (BE-24 not merged yet; BE-03 SQL calls `private.my_couple_id()`), with origin/main merged in. Merge BE-24 first, then BE-03. Pushed.
- Uncommitted work: none
- Exact next step: wait for lead review of BE-24 and BE-03. Next task BE-04 Invites v2 (D01, D02, D04, D05, D06) on be/BE-04-invites from BE-03 (or main once merged): BND+4 digits, 48 h, one active invite, D04 solo caller joins (delete their solo couple), rate limits, `invite_preview` (anon), link token.
- Commands to re-run: `npm --prefix supabase/tests ci && npm --prefix supabase/tests test && node supabase/tests/gen-types.mjs --check`
- Watch out for: git needs DEVELOPER_DIR=/Library/Developer/CommandLineTools; push with `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push`. No Docker. No AI attribution in commits. Helpers are `private.*` (BE-24): call them schema-qualified.

## Doing
- nothing (BE-24 and BE-03 waiting on lead review)

## Done (since last update)
- BE-01, BE-02 merged to main
- BE-24 on be/BE-24-private-helpers @ 51779d3 (not merged): migration `20261102180000_private_helpers.sql` moves the 7 RLS helpers to `private` (policies keep their OIDs; anon EXECUTE revoked; authenticated keeps EXECUTE without schema USAGE). `private-helpers.test.mjs` 74/74; types regenerated (7 helper entries gone); CONTRACTS §2 note + change-log row
- BE-03 on be/BE-03-couples-v2 @ b1e2f31 (not merged): migration `20261102190000_couples_v2.sql`: enums `couple_stage`, `couple_status`, `key_date_kind`; `couples.stage/goals/partner_name/status/ended_at`; `couple_members.left_at`; `pair_invites.couple_id/partner_name`; `key_dates` (RLS; birthdays own-only; unique nulls not distinct for upsert); `create_couple` (solo, idempotent while solo); `create_invite` NOT_PAIRED/COUPLE_FULL; `accept_invite` joins the inviter's couple (locks the couple row); couple UPDATE limited to settings columns. `couples-v2.test.mjs` 55/55 (solo couple gets a daily question; joiner inherits stage/goals/timezone/dates; reveal rule across the join; other couple/anon denied). rls 22, error-codes 49, private-helpers 74. Types regenerated. CONTRACTS §2 rows + change-log row

## Next
- BE-04 (invites v2, incl. D04), BE-05 (D33 loader, D11 500 chars, D12 first_day), BE-23
- BE-09 sets `status = ended`, `ended_at`, `left_at` and relaxes the one-couple-per-user index to active memberships

## Blocked
- BE-01 `dev` project part (link, `db push`, deploy): waiting on LEAD-03
- real `supabase db reset` unverified locally (no Docker); QA's Docker CI job will cover it

## Needs from
- lead: review/merge BE-24 then BE-03 (BE-03 contains BE-24's commits); route BE-24 and BE-03 (create_couple, accept_invite joining an existing couple) to SEC-01. Mark D03 and D10 `done (BE-03)` in DESIGN_DELTA. Your skill `.github/skills/bonded-db-change/SKILL.md` §1 names the helpers without `private.`. Conflict to note: design spec 05 says stage `married`, D10 says `engaged_married`; I built D10 (DESIGN_DELTA wins). Files outside my ownership: none
- mobile: ack BE-24 (helpers gone from `Functions` types; nothing in `src/` used them) and BE-03 (**breaking**: `create_invite` raises `NOT_PAIRED` until `create_couple` has run; call `create_couple(p_stage, p_goals?, p_partner_name?)` at the end of onboarding; `couples` `status`/`ended_at`/ids are not client-writable; new enums `couple_stage`, `couple_status`, `key_date_kind` in the types; key dates upsert with `onConflict: 'couple_id,kind,user_id'`)
- qa: ack BE-24/BE-03 rows; `npm --prefix supabase/tests test` runs four suites now (rls, error-codes, private-helpers, couples-v2); personas `maya_sam`/`lea_solo` can now be seeded through `create_couple` + `create_invite` + `accept_invite`

## Contract changes in flight
- BE-24: RLS helpers moved to `private` (mobile + qa ack)
- BE-03: `create_couple` live; `create_invite` NOT_PAIRED without a couple; `accept_invite` joins the inviter's couple; couples v2 columns; `key_dates` (mobile ack, breaking for create_invite)

## Questions for the product owner
- install Docker Desktop (or Podman) on the dev Mac so `supabase start` / `db reset` can run locally
