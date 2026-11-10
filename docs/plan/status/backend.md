# Backend / data developer status

Updated: 2026-11-10 · Branch: `be/BE-38-ended-by` · Task: BE-38 (M4 P1, MOB-18 follow-ups)

## Resume here

- Branch `be/BE-38-ended-by` (PR #135). Lead decision 2026-11-10 (D09, data minimisation): nothing of a deleted user is kept. Migration `20261110170000_couple_ended_by.sql` edited in place (unmerged, unapplied anywhere). Commit `[BE-38] No data kept for a deleted account (D09)` follows `1e84120`. Uncommitted work: none after that commit.
- Design now: `couples.ended_by uuid` (unpair caller, no FK) + enum `couple_end_reason` in `ended_reason`. Unpair: caller + `unpaired`. Account deletion trigger: `deleted` + `ended_by` null, and it clears the deleted user's uuid from `ended_by` of couples they unpaired earlier (partial index `couples_ended_by`). Checks: `couples_end_fields_only_when_ended`, `couples_deleted_keeps_no_actor`. Removed: `private.ended_couple_names`, `ended_partner_name` RPC (and from the definer allow-list). App rule: skip 58 when `ended_by = me`; `deleted` → "Your partner"; unpair → former partner's `profiles` row (existing RLS).
- Realtime: no publication change (`couple_members` UPDATE of the remaining member's row, tested).
- Tests: `ended-by.test.mjs` 33/33 (no uuid or name of a deleted user left in couples, later deletion clears ended_by). Full DB suite (33 suites, exit 0, reveal rule included), types/plan/sync checks, functions.sh 10 ok, qa/contract typecheck: all green locally.
- CI run 42870950796 on `3f160ef` fully green (db-reset, db-tests, functions, app, plan, sync). Decision comment posted on #135. Exact next step: wait for security's review of the final head and mobile's ack, then hand to the lead.
- Commands: `export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH`; `npm --prefix supabase/tests test`; `node ended-by.test.mjs` (from supabase/tests); `bash qa/ci/functions.sh`; `node supabase/tests/gen-types.mjs --check`; `node scripts/plan/generate.mjs --check`; `node scripts/agents/sync.mjs --check`. Fetch/push with `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' ...`. QA may push to this branch: fetch and merge (no rebase or force) before every push.
- Dev only `nyqbrsqqalygydtwvybb`; never prod. No hosted writes. Hooks `.githooks`; no AI attribution.

## Doing

- BE-38: PR #135, lead's D09 change pushed (`3f160ef`), CI green; waiting for security review of the final head and mobile ack.

## Done

- BE-37 merged (#130). BE-36 merged (#129). BE-11 #123 and BE-17 #125 merged.
- #100 recap and #122 consent vehicle merged/deployed per lead. Premium wording correction implemented; hosted Auth report accepted. Streak-context backend implemented/tested and source-reviewed.

## Next

- After BE-38: no other unblocked BE row (BE-31 needs the PO's go; BE-22 needs milestone approval; BE-13 waits until after launch).

## Blocked

- BE-31 needs the PO's go; BE-22 needs milestone approval; BE-13 waits until after launch. The D28, partner ritual-time and J5 privacy decisions need the lead.

## Needs from

- Mobile: **contract changed (additive), BE-38**: `couples.ended_by` (unpair caller) / `ended_reason` (`couple_end_reason`). `ended_by = me` → skip 58; `ended_reason = 'deleted'` → "Your partner" (no name kept); otherwise the former partner's profile; null both → "partner ended it". No `ended_partner_name` RPC. Realtime on end arrives through `couple_members`. Please ack on #135.
- Security: review the final head of #135.
- Lead: review/merge #135 after security.
- QA: optional contract test for the new columns.
- PO: none.
