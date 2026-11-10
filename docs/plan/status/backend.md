# Backend / data developer status

Updated: 2026-11-10 · Branch: `be/BE-39-pack-notify-links` · Task: BE-39 (MOB-49 follow-up)

## Resume here

- Branch `be/BE-39-pack-notify-links` from origin/main `92439d3`. Commits: `406112e` (regression tests), `b3061dc` (503 AUTH_UNAVAILABLE), plus status commits. **PR #140** `[BE-39] Pack question push links`. Uncommitted work: none.
- Finding (MOB-49): **already worked, no behaviour change for pushes.** `private.notify_after_answer` (migration `20261102260000_notify.sql`, never redefined) fires on every `answers` insert with no `source` filter; it sends `partner_answered` (1 answer) / `both_answered` (2) with the row's `couple_question_id`. `notify` builds `bonded://question/<couple_question_id>` for both types whatever the source. Upsert updates (edits) send nothing.
- Tests added: `supabase/tests/pack-notify.test.mjs` 15/15 (free pack + premium-pack first question via `start_pack_question`; exact §4 payload for both events; edit sends none; no answer text; daily parity), registered in `package.json`. `supabase/functions/notify/links_test.ts` (data `{type, url: bonded://question/<id>}` for both types).
- Small extra (security informational): `requireUser` rethrows `AuthUnavailableError` when Auth answers status 0/5xx or the fetch fails; `delete-account` maps it to `503 AUTH_UNAVAILABLE`. 4xx, missing token and missing env (misconfiguration) stay `401` (QA's `qa/functions/stubs_test.ts` relies on that). Test: `supabase/functions/delete-account/auth_unavailable_test.ts` (real supabase-js against a stubbed fetch). CONTRACTS §3 row + change-log line (additive).
- Checks green locally: DB suite (exit 0, reveal rule included), `bash qa/ci/functions.sh` 60 + 10 ok, types/plan/sync checks. No migration, no type change.
- Exact next step: wait for CI on the PR, mobile ack of the 503 line, security glance at the auth change, then the lead merges. Deploy `delete-account` to dev after merge (main auto-deploys).
- Commands: `export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH`; `npm --prefix supabase/tests test`; `node supabase/tests/pack-notify.test.mjs`; `bash qa/ci/functions.sh`; `node supabase/tests/gen-types.mjs --check`; `node scripts/plan/generate.mjs --check`; `node scripts/agents/sync.mjs --check`. Fetch/push with `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' ...`.
- Dev only `nyqbrsqqalygydtwvybb`; never prod. No hosted writes. Hooks `.githooks`; no AI attribution.

## Doing

- BE-39: PR open, waiting for CI, mobile ack and lead review.

### BACKLOG note for the lead (row BE-39)
| ID | Task | Acceptance |
|---|---|---|
| BE-39 | Pack question push links (MOB-49) + Auth outage 503 | Pack answers send `partner_answered`/`both_answered` with `url` `bonded://question/<couple_question_id>` like daily (regression DB + Deno tests); `delete-account` returns `503 AUTH_UNAVAILABLE` when Auth is unreachable, `401` otherwise unchanged |

## Done

- BE-38 merged (#135).
- BE-37 merged (#130). BE-36 merged (#129). BE-11 #123 and BE-17 #125 merged.
- #100 recap and #122 consent vehicle merged/deployed per lead. Premium wording correction implemented; hosted Auth report accepted. Streak-context backend implemented/tested and source-reviewed.

## Next

- After BE-38: no other unblocked BE row (BE-31 needs the PO's go; BE-22 needs milestone approval; BE-13 waits until after launch).

## Blocked

- BE-31 needs the PO's go; BE-22 needs milestone approval; BE-13 waits until after launch. The D28, partner ritual-time and J5 privacy decisions need the lead.

## Needs from

- Mobile: **contract changed (additive), BE-39**: `delete-account` may answer `503 AUTH_UNAVAILABLE` during an Auth outage: keep the session, show a retry, do not sign out. MOB-49 push links confirmed: no app change needed. Please ack on the PR.
- Security: optional look at `_shared/auth.ts` (503 only for Auth status 0/5xx; everything else still fails closed as 401).
- QA: none required; `qa/functions/stubs_test.ts` passes unchanged. Optional: a 503 case in your stubs.
- Lead: add BACKLOG row BE-39 (above), review/merge.
- PO: none.
