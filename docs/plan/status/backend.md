# Backend / data developer status

Updated: 2026-11-05 · Branch: `be/BE-34-expired-invite` · Task: BE-34 verified handoff

## Resume here

- Current branch `be/BE-34-expired-invite`, mergeable PR #90: https://github.com/saeedarafa/bonded/pull/90 . Merged latest origin/main `6f8b851` without rebase in `9cad48d`, resolving only test-script/backend-status conflicts. Every main suite (including dev-content/revenuecat) plus expired-invite is retained. BE-34 migration/function/test source unchanged from security-reviewed `b927f70`. Checkpoint = commit containing this file; uncommitted work none after commit/push.
- Exact next step: fetch/status/log/pull, then inspect all authored PR feedback and latest CI. #90 at `efbd96d` passed all seven required checks in run `41916775970`; this status-only checkpoint needs its own green CI before lead merge. No backend source changes requested. Preserve migration order below; do not merge main. If no new requests or gates change, report BLOCKED without repeating full suites or rejected credential/UI attempts.
- This session (2026-11-05): clean startup at `efbd96d`, fetch/pull current. All 11 authored PR discussions checked, plus backend inline comments/reviews (empty); all 11 heads mergeable with seven successful checks. Full integrated DB command exit0 (reveal23, expired26), focused expired26, generated types current, functions/QA, seed/plan/sync/whitespace pass. Logs `/private/tmp/bonded-be34-resume-{db,expired,types,functions}.log`. Browser inventory still empty with `The browser access host is unavailable`; no Safari/keychain retry or hosted writes. Lead's #100 comment confirms D21 timing/semantics; D28 local-day3 still needs confirmation.
- Commands for unchanged status-only startup: `export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH`; `export SUPABASE_HOME=/private/tmp/bonded-cli-resume SUPABASE_TELEMETRY_DISABLED=1`; `node supabase/tests/auth-email.test.mjs`; `node scripts/plan/generate.mjs --check`; `node scripts/agents/sync.mjs --check`; `git diff --check`; `gh pr checks 90`; `gh pr view 90 --comments`. Full source-change verification: `node supabase/tests/expired-invite.test.mjs`; `npm --prefix supabase/tests test`; `npm --prefix supabase/tests run check:types`; `bash qa/ci/functions.sh`; `node supabase/scripts/build-seed.mjs --check`. Full DB suite's existing 10,000-invite fixture takes several minutes; completed successfully this session. Do not reset/stop the shared stack.
- BE-27 draft #102 remains on `be/BE-27-hosted-auth-check`, latest `6f93195`, seven checks green `41911186841`. Evidence `ea1b6b0`, `supabase/AUTH_DEV_CHECK.md` on that branch. Dev callback allow-list/OTP6 confirmed; Site URL `http://localhost:3000` differs from local `bonded://`; confirmations enabled; subjects differ; template bodies unverified. CLI authentication works without exported token, but `config pull` does not retrieve HTML bodies. Browser inventory retried: no browsers, `The browser access host is unavailable`. Prior Safari automatic review rejected access; keychain lookup timed out. No repeat rejected access, credential output or hosted settings changes. Scratch `/private/tmp/bonded-be27-{config,bare}`, raw config log stays outside repo. Keep #102 draft until body/link/token parity verified; Site URL decision needs lead/PO.
- Other reviewed heads remain green: #83 `eede10f`; #91 `8237117` (security `e7c98cb`); #97 `2dee13c` (security `17b6c47`); #100 `70f2d78` (security `ad8845d`, handoff #101 now `7840530`). #90 security source sign-off at `b927f70` retained; integration changes no BE-34 source. Security owns #89/#96/#98/#99/#101.
- Preserve integration order #83/200000 → #90/210000 → #91/220000 → #97/230000 → #100/240000, then updated daily-reminder. Only lead merges main; dev auto-deploys. #90 contains no other unmerged migration. BE-14 isolated stack `/private/tmp/bonded-be11-stack`, project bonded_backend_be11, API58321/DB58322 retains prior reset snapshot; authenticated HTTP privacy/concurrent claims/unpair races passed and fixtures cleaned. Never reset/stop shared bonded.
- Dev only `nyqbrsqqalygydtwvybb`; never prod `nciyrepyphvksusoigzx`. Hooks `.githooks`; no secrets or AI attribution. BE-31 needs PO go, BE-22 approved milestone, BE-13 explicitly after launch.

## Doing

- #90 integrated main, full local verification repeated, seven checks green at `efbd96d`; current status-only checkpoint CI must also pass. Lead notified: https://github.com/saeedarafa/bonded/pull/90#issuecomment-6642606294 .
- #102 partial hosted Auth check; body parity/Site URL decision remain open.

## Done

- Clean fetched/pulled startup; checked all eleven authored PR discussions and backend reviews/inline comments. No new backend source requests; every open head mergeable with seven checks green.
- Resolved #90 merge conflicts, retaining all suites and reviewed BE-34 source; full integrated DB/reveal, focused expiry, function and static checks pass.
- Reconfirmed browser-host blocker for BE-27; no hosted writes or production access.

## Next

- #90 integration CI green at `efbd96d`; require green status-only checkpoint CI, then lead merges the reviewed backend PRs in order.
- No new unblocked launch BE implementation remains: #75 loader merged; BE-32 awaits QA-13 workflow/configuration; BE-31 waits PO go; BE-22 awaits milestone; BE-13 is after launch.

## Blocked

- BE-27: authorized read-only template-body view unavailable. CLI cannot retrieve bodies, browser host unavailable, prior Safari access rejected, keychain lookup timed out. Site URL correction needs lead/PO decision beyond GET-only task.
- Lead integration #83/#90/#91/#97/#100; D28 local-day3 confirmation (D21 confirmed in lead #100 comment); hosted secrets/Vault/SMTP/device acceptance; QA-13 workflow/configuration; PO/milestone gates above.

## Needs from

- Lead: merge backend PRs in recorded order after green integrated CI; confirm D28 semantics (D21 confirmed). #90 source unchanged and conflicts resolved; full local checks pass. #100 focused security source gate cleared in #101.
- Lead/PO: review BE-27 evidence on #102, decide intended dev Site URL and provide authorized read-only template-body access. Never put credentials in comments/repository.
- Mobile/QA: D39 optional `error.details.inviter_name` remains token-only and first-name bounded, generic fallback otherwise. Dev callback/OTP6 verified; body parity/device PKCE/SMTP acceptance still pending. #100 additive free days-only/null premium fields/current-member entitlement, #91 saver and #97 offers await integration.
