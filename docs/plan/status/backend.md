# Backend / data developer status

Updated: 2026-11-05 · Branch: `be/BE-27-hosted-auth-check` · Task: hosted Auth / integrated backend PR handoff

## Resume here

- Branch `be/BE-27-hosted-auth-check`, draft PR #102 https://github.com/saeedarafa/bonded/pull/102 . Integrated latest origin/main `680b361` after #83 BE-33 and #89 merged. Own status conflict only; evidence `ea1b6b0`/`supabase/AUTH_DEV_CHECK.md` unchanged. Checkpoint = commit containing this file; no uncommitted work after commit/push.
- Exact next step: fetch/status/log/pull ff-only, review authored PR feedback and latest-head CI (#90/#91/#97/#100/#102). All backend conflicts against `680b361` resolved this run; security-owned #96/#98/#99/#101 still need their owner's integration. No new backend source request. If checks fail, fix the affected task branch; if no gates change, report BLOCKED without rerunning full suites or rejected credential/UI attempts. Keep #102 draft until actual HTML parity verified. Only lead merges main.
- Completed integrations: #90 `843f0e0`, #91 `b45af19`, #97 `ea6693a`, #100 `9dfdd6d`; #102 this checkpoint. Reviewed task migrations/tests/functions unchanged; contracts retain both task and BE-33 log rows; test scripts retain all main suites plus respective task. No earlier unmerged migrations added. Prior seven-check heads were green; refreshed CI pending at checkpoint.
- Validation: #90 full integrated DB (reveal23, expired26, onboarding37), types/functions52+QA10/seed/static pass. #91 saver46, #97 offers46, #100 recap55 each plus reveal23/onboarding37/types/static pass; #100 functions54+QA10 also pass. Logs `/private/tmp/bonded-be34-main-{db,types,functions}.log` and `/private/tmp/bonded-be-{11,17,14}-main-*.log`. #102 auth4/plan/sync/whitespace rechecked. No shared-stack reset or hosted writes. All nine authored open PR comments reviewed, backend reviews/inline empty.
- Commands: `export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH`; `export SUPABASE_HOME=/private/tmp/bonded-cli-resume SUPABASE_TELEMETRY_DISABLED=1`; `npm --prefix supabase/tests test`; `npm --prefix supabase/tests run check:types`; `bash qa/ci/functions.sh`; `node supabase/scripts/build-seed.mjs --check`; `node scripts/plan/generate.mjs --check`; `node scripts/agents/sync.mjs --check`; `git diff --check`; `gh pr checks 102`; `gh pr view 102 --comments`. Full DB's existing 10,000-invite fixture takes several minutes. For unchanged status-only startup use auth-email/static/CI checks, without repeating full suites. Never reset/stop shared stack. CLI requires the SUPABASE_HOME export even for types (otherwise sandbox telemetry write fails).
- BE-27 draft #102 `be/BE-27-hosted-auth-check`, integrated main this checkpoint, prior seven checks green. Evidence `ea1b6b0`, `supabase/AUTH_DEV_CHECK.md` there. Dev callback allow-list/OTP6 confirmed; Site URL `http://localhost:3000` differs from local `bonded://`; confirmations enabled; subjects differ; template bodies unverified. CLI config pull does not retrieve HTML bodies. Prior browser inventory empty/host unavailable; Safari automatic review rejected access; keychain lookup timed out. Do not repeat rejected access or credential output. Keep draft until body/link/token parity verified; Site URL needs lead/PO decision. Raw logs outside repo.
- Source acceptance: #90 `b927f70`, #91 `e7c98cb` (cosmetic EOF fix retained), #97 `17b6c47`, #100 `ad8845d` (security handoff #101 `7840530`). Preserve migration order #83/200000 (merged) → #90/210000 → #91/220000 → #97/230000 → #100/240000, then updated daily-reminder. Dev auto-deploys main. BE-14 isolated stack `/private/tmp/bonded-be11-stack`, project bonded_backend_be11, API58321/DB58322 retains reset snapshot; prior authenticated HTTP privacy/concurrent claims/unpair races passed and fixtures cleaned.
- Dev only `nyqbrsqqalygydtwvybb`; never prod `nciyrepyphvksusoigzx`. Hooks `.githooks`; no secrets or AI attribution. BE-31 needs PO go; BE-22 approved milestone; BE-13 after launch.

## Doing

- Backend PR integrations pushed after BE-33 merged; latest-head CI and lead merges remain.
- #102 partial hosted Auth parity evidence; body access and Site URL decision pending.

## Done

- BE-33 table/types/contracts on main via #83; mobile onboarding sync unblocked.
- Startup and open PR review complete; prior source acceptance remains applicable to unchanged feature source.

## Next

- Require green latest-head CI on #90/#91/#97/#100/#102; lead merges reviewed ready PRs in migration order. Security owns integration of #96/#98/#99/#101.
- No new unblocked launch BE implementation remains: #75 loader merged; BE-32 waits QA-13 workflow/environment configuration; BE-31 PO go; BE-22 milestone; BE-13 after launch.

## Blocked

- BE-27 authorized read-only template-body access unavailable; Site URL decision lead/PO.
- Lead integration/deployment; D28 local-day3 confirmation (D21 confirmed); hosted secrets/Vault/SMTP/device acceptance; QA-13 configuration; PO/milestone gates.

## Needs from

- Lead: merge green backend PRs in migration order; confirm D28 semantics. D21 confirmed and #100 focused security gate cleared.
- Lead/PO: review #102 evidence, decide dev Site URL and provide authorized read-only template-body access; no credentials in comments/repo.
- Mobile/QA: BE-33 types on main; D39 token-only bounded `error.details.inviter_name` after #90, generic fallback otherwise. Dev callback/OTP6 verified; body parity/device PKCE/SMTP pending. #100 free days-only/null premium fields/current-member entitlement, #91 saver and #97 offers await integration.
- Release: BE-10 `send_nudge` already on main; partner ritual-time/J5 summary requests need lead contract/privacy decision before expanding partner preview data.
