# Backend / data developer status

Updated: 2026-11-05 · Branch: `be/BE-27-hosted-auth-check` · Task: hosted Auth / integrated backend PR handoff

## Resume here

- Startup verification 2026-11-05: fetched `origin/main` `23ffc7b` (lead stop checkpoint only); current task branch pulled ff-only, already current, clean. Reviewed all six authored PR comments/reviews/inline comments: no new source requests; #90/#91/#97/#100/#101/#102 CLEAN, all seven required checks SUCCESS; #102 verified at `b0dce13` (run 42012014694). Auth-email4, seed freshness, plan, agent sync and whitespace pass. This checkpoint changes only backend status; refresh #102 CI after push. No unblocked BE task found; do not repeat full suites or rejected credential/UI attempts while gates remain unchanged.
- Deployment distinction verified through the commits API: **#83 merge commit `afa8370` still has Supabase Preview `in_progress` with null conclusion** (dev dashboard link). The skipped PR-head Preview checks below do not describe this merge deployment. Latest lead checkpoint `23ffc7b` explicitly waits for PO dashboard confirmation before #90 → #91; backend must preserve that gate. No hosted writes or shared-stack reset performed. Auth template access/Site URL, QA-13 environment, D28 and PO/milestone gates remain pending.

- Branch `be/BE-27-hosted-auth-check`, draft PR #102 https://github.com/saeedarafa/bonded/pull/102 . Integrated latest origin/main `caa9198` (D41/MOB-43 planning only since `680b361`); backend feature source unchanged. Own status conflict only; evidence `ea1b6b0`/`supabase/AUTH_DEV_CHECK.md` unchanged. Checkpoint = commit containing this file; no uncommitted work after commit/push.
- Exact next step: fetch/status/log/pull ff-only, review authored PR feedback and latest-head CI (#90/#91/#97/#100/#102). All five backend PRs are CLEAN; #101 security handoff is also CLEAN and green. Closed security handoffs need no further integration. No new backend source request. If checks fail, fix the affected task branch; if no gates change, report BLOCKED without rerunning full suites or rejected credential/UI attempts. Keep #102 draft until actual HTML parity verified. Only lead merges main.
- Completed integrations: #90 `843f0e0`, #91 `b45af19`, #97 `ea6693a`, #100 `9dfdd6d`; #102 this checkpoint. Reviewed task migrations/tests/functions unchanged; contracts retain both task and BE-33 log rows; test scripts retain all main suites plus respective task. No earlier unmerged migrations added. All seven required checks pass on each of #90/#91/#97/#100/#102 at startup (including #102 c689732); check refreshed #102 CI next run.
- Validation: #90 full integrated DB (reveal23, expired26, onboarding37), types/functions52+QA10/seed/static pass. #91 saver46, #97 offers46, #100 recap55 each plus reveal23/onboarding37/types/static pass; #100 functions54+QA10 also pass. Logs `/private/tmp/bonded-be34-main-{db,types,functions}.log` and `/private/tmp/bonded-be-{11,17,14}-main-*.log`. #102 auth4/plan/sync/whitespace rechecked. No shared-stack reset or hosted writes. All six currently authored open PR comments/reviews checked; backend inline comments empty, no new source requests. Auth4/seed freshness/plan/sync/whitespace passed again this run. Fetched/pulled ff-only (already current), checked six authored PR comments/reviews and inline threads (no new requests), backlog and role handoffs; no new unblocked backend task. Open backend issues #9/#57 are prior implementation handoffs; #72 waits QA-13. Required checks green on all six open authored PRs, Supabase Preview skipped on each.
- Commands: `export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH`; `export SUPABASE_HOME=/private/tmp/bonded-cli-resume SUPABASE_TELEMETRY_DISABLED=1`; `npm --prefix supabase/tests test`; `npm --prefix supabase/tests run check:types`; `bash qa/ci/functions.sh`; `node supabase/scripts/build-seed.mjs --check`; `node scripts/plan/generate.mjs --check`; `node scripts/agents/sync.mjs --check`; `git diff --check`; `gh pr checks 102`; `gh pr view 102 --comments`. Full DB's existing 10,000-invite fixture takes several minutes. For unchanged status-only startup use auth-email/static/CI checks, without repeating full suites. Never reset/stop shared stack. CLI requires the SUPABASE_HOME export even for types (otherwise sandbox telemetry write fails).
- BE-27 draft #102 `be/BE-27-hosted-auth-check`, integrated main this checkpoint, prior seven checks green. Evidence `ea1b6b0`, `supabase/AUTH_DEV_CHECK.md` there. Dev callback allow-list/OTP6 confirmed; Site URL `http://localhost:3000` differs from local `bonded://`; confirmations enabled; subjects differ; template bodies unverified. CLI config pull does not retrieve HTML bodies. Prior browser inventory empty/host unavailable; Safari automatic review rejected access; keychain lookup timed out. Do not repeat rejected access or credential output. Keep draft until body/link/token parity verified; Site URL needs lead/PO decision. Raw logs outside repo.
- Source acceptance: #90 `b927f70`, #91 `e7c98cb` (cosmetic EOF fix retained), #97 `17b6c47`, #100 `ad8845d` (security handoff #101 `7840530`). Preserve migration order #83/200000 (merged) → #90/210000 → #91/220000 → #97/230000 → #100/240000, then updated daily-reminder. Dev auto-deploys main. #83 is merged and all seven required checks pass; its PR-head Supabase Preview is COMPLETED/SKIPPED, while merge commit `afa8370` remains IN_PROGRESS (verified directly). This supplies no successful dev deployment evidence. Do not bypass the lead deployment gate. BE-14 isolated stack `/private/tmp/bonded-be11-stack`, project bonded_backend_be11, API58321/DB58322 retains reset snapshot; prior authenticated HTTP privacy/concurrent claims/unpair races passed and fixtures cleaned.
- Dev only `nyqbrsqqalygydtwvybb`; never prod `nciyrepyphvksusoigzx`. Hooks `.githooks`; no secrets or AI attribution. BE-31 needs PO go; BE-22 approved milestone; BE-13 after launch.

## Doing

- Backend PR integrations pushed after BE-33 merged; required CI green on all five PRs before this handoff. Lead deployment gate/merges remain.
- #102 partial hosted Auth parity evidence; body access and Site URL decision pending.

## Done

- BE-33 table/types/contracts on main via #83; mobile onboarding sync unblocked.
- Startup and open PR review complete; prior source acceptance remains applicable to unchanged feature source.

## Next

- Lead merges reviewed ready #90/#91/#97/#100 in migration order once #83 dev deployment is confirmed. All required checks green at startup; refresh #102 checks after this status-only push. #83 PR-head Preview is skipped, but its merge-commit deploy remains in progress; lead/PO must confirm successful dev migration deployment separately. #101 security handoff is CLEAN/green.
- No new unblocked launch BE implementation remains: #75 loader merged; BE-32 waits QA-13 workflow/environment configuration; BE-31 PO go; BE-22 milestone; BE-13 after launch.

## Blocked

- BE-27 authorized read-only template-body access unavailable; Site URL decision lead/PO.
- Lead integration/deployment; D28 local-day3 confirmation (D21 confirmed); hosted secrets/Vault/SMTP/device acceptance; QA-13 configuration; PO/milestone gates.

## Needs from

- Lead: merge green backend PRs in migration order; confirm D28 semantics. D21 confirmed and #100 focused security gate cleared.
- Lead/PO: review #102 evidence, decide dev Site URL and provide authorized read-only template-body access; no credentials in comments/repo.
- Mobile/QA: BE-33 types on main; D39 token-only bounded `error.details.inviter_name` after #90, generic fallback otherwise. Dev callback/OTP6 verified; body parity/device PKCE/SMTP pending. #100 free days-only/null premium fields/current-member entitlement, #91 saver and #97 offers await integration.
- Release: BE-10 `send_nudge` already on main; partner ritual-time/J5 summary requests need lead contract/privacy decision before expanding partner preview data.
