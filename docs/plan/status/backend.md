# Backend / data developer status

Updated: 2026-11-10 · Branch: `be/BE-38-ended-by` · Task: BE-38 (M4 P1, MOB-18 follow-ups)

## Resume here

- Branch `be/BE-38-ended-by` from origin/main `2781889`. Commits: `30a90d2` (migration `20261110170000_couple_ended_by.sql`, `ended-by.test.mjs` 42/42, types, definer allow-list), `00d0ae0` (CONTRACTS §2/§3 + change log). Uncommitted work: none. PR #135.
- Design: `couples.ended_by uuid` (no FK, survives the account deletion until the D08 purge) + enum `couple_end_reason` (`unpaired`|`deleted`) in `ended_reason`; check `couples_end_fields_only_when_ended`. Set by `unpair()` (caller) and `private.archive_couple_before_profile_delete()` (deleted user). Not client-writable (column UPDATE grant unchanged). Older and solo-archive (D04/D37) ends stay null.
- Name: after unpair the profile is already readable (`private.can_read_profile`). After delete the trigger stores only the first name (first word, <=30) in `private.ended_couple_names` (RLS on, no grants, FK cascade with the couple). `public.ended_partner_name(p_couple)` (definer, authenticated only) returns the other former member's first name for an ended couple within the window, else null (never an error except NOT_AUTHENTICATED). A partner who deletes after an unpair leaves no name (no snapshot; erasure wins).
- Realtime: no publication change. `couple_members` (BE-20) already gets the remaining member's `left_at` UPDATE on unpair and delete; RLS admits it; tested.
- delete-account function unchanged (the trigger does it); functions.sh 10 ok.
- Local: 33 DB suites green, types/plan/sync check, qa/contract typecheck pass.
- CI run 42868990708 on `47ff351` fully green (db-reset, db-tests, functions, app, plan, sync). Exact next step: answer security's review (#135 issuecomment-6774843026) and mobile's ack, then hand to the lead.
- Commands: `export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH`; `npm --prefix supabase/tests test`; `node ended-by.test.mjs` (from supabase/tests); `bash qa/ci/functions.sh`; `node supabase/tests/gen-types.mjs --check`; `node scripts/plan/generate.mjs --check`; `node scripts/agents/sync.mjs --check`. Fetch/push with `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' ...`. QA may push to this branch: fetch and merge (no rebase or force) before every push.
- Dev only `nyqbrsqqalygydtwvybb`; never prod. No hosted writes. Hooks `.githooks`; no AI attribution.

## Doing

- BE-38: PR #135 open, CI green; waiting for security review and mobile ack.

## Done

- BE-37 merged (#130). BE-36 merged (#129). BE-11 #123 and BE-17 #125 merged.
- #100 recap and #122 consent vehicle merged/deployed per lead. Premium wording correction implemented; hosted Auth report accepted. Streak-context backend implemented/tested and source-reviewed.

## Next

- After BE-38: no other unblocked BE row (BE-31 needs the PO's go; BE-22 needs milestone approval; BE-13 waits until after launch).

## Blocked

- BE-31 needs the PO's go; BE-22 needs milestone approval; BE-13 waits until after launch. The D28, partner ritual-time and J5 privacy decisions need the lead.

## Needs from

- Mobile: **contract changed (additive), BE-38**: `couples.ended_by` / `ended_reason` (`couple_end_reason`), RPC `ended_partner_name(p_couple)` (first name or null). `ended_by = me` → skip 58; null → "partner ended it". Realtime on end arrives through `couple_members` (already subscribed). Please ack on the BE-38 PR.
- Security: review BE-38 (deleted user's first-name snapshot for 30 days; no-FK `ended_by`; definer RPC scope).
- Lead: confirm keeping the deleted partner's first name for the 30-day window is acceptable under D09 ("yours disappear"); review/merge the BE-38 PR.
- QA: optional contract test for `ended_partner_name` and the new columns.
- PO: none.
