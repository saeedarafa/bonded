# Backend / data developer status

Updated: 2026-11-04 · Branch: `be/BE-34-expired-invite` · Task: BE-34 main integration

## Resume here

- Current branch `be/BE-34-expired-invite`, PR #90: https://github.com/saeedarafa/bonded/pull/90 . Merged latest origin/main `6f8b851` without rebase in `9cad48d`, resolving only test-script/backend-status conflicts. Every main suite (including dev-content/revenuecat) plus expired-invite is retained. BE-34 migration/function/test source unchanged from security-reviewed `b927f70`. Checkpoint = commit containing this file; uncommitted work none after commit/push.
- Exact next step: check #90 CI (`gh pr checks 90`, `gh pr view 90 --comments`) and all backend PR feedback first. Integration run `41916312598` pending at this checkpoint; require all seven checks green before lead merge. Once green, #90 waits for lead in migration order below. Do not merge main. Then retry BE-27 only if an authorized read-only body interface becomes available; do not repeat rejected Safari/keychain attempts or hosted writes.
- This session: fetched/pulled clean BE-27 `6f93195`, startup auth4/plan/sync/whitespace pass. All 11 authored PR discussions/reviews/inline comments checked; no new backend source requests. Found #90 DIRTY and completed this integration. Local full DB command exit0, reveal23, focused expired26, generated types current, functions52+QA10, seed/plan/sync/whitespace all pass. Logs `/private/tmp/bonded-be34-integrated-{db,expired,functions}.log`. No hosted writes or shared-stack resets.
- Commands: `export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH`; `export SUPABASE_HOME=/private/tmp/bonded-cli-resume SUPABASE_TELEMETRY_DISABLED=1`; `node supabase/tests/expired-invite.test.mjs`; `npm --prefix supabase/tests test`; `npm --prefix supabase/tests run check:types`; `bash qa/ci/functions.sh`; `node supabase/scripts/build-seed.mjs --check`; `node scripts/plan/generate.mjs --check`; `node scripts/agents/sync.mjs --check`; `git diff --check`. Full DB suite's 10,000-invite fixture can take several minutes; this run completed successfully. For status-only changes do not repeat full suites without new code/failures.
- BE-27 draft #102 remains on `be/BE-27-hosted-auth-check`, latest `6f93195`, seven checks green `41911186841`. Evidence `ea1b6b0`, `supabase/AUTH_DEV_CHECK.md` on that branch. Dev callback allow-list/OTP6 confirmed; Site URL `http://localhost:3000` differs from local `bonded://`; confirmations enabled; subjects differ; template bodies unverified. CLI authentication works without exported token, but `config pull` does not retrieve HTML bodies. Browser inventory retried: no browsers, `The browser access host is unavailable`. Prior Safari automatic review rejected access; keychain lookup timed out. No repeat rejected access, credential output or hosted settings changes. Scratch `/private/tmp/bonded-be27-{config,bare}`, raw config log stays outside repo. Keep #102 draft until body/link/token parity verified; Site URL decision needs lead/PO.
- Other reviewed heads remain green: #83 `eede10f`; #91 `8237117` (security `e7c98cb`); #97 `2dee13c` (security `17b6c47`); #100 `70f2d78` (security `ad8845d`, handoff #101 now `7840530`). #90 security source sign-off at `b927f70` retained; integration changes no BE-34 source. Security owns #89/#96/#98/#99/#101.
- Preserve integration order #83/200000 → #90/210000 → #91/220000 → #97/230000 → #100/240000, then updated daily-reminder. Only lead merges main; dev auto-deploys. #90 contains no other unmerged migration. BE-14 isolated stack `/private/tmp/bonded-be11-stack`, project bonded_backend_be11, API58321/DB58322 retains prior reset snapshot; authenticated HTTP privacy/concurrent claims/unpair races passed and fixtures cleaned. Never reset/stop shared bonded.
- Dev only `nyqbrsqqalygydtwvybb`; never prod `nciyrepyphvksusoigzx`. Hooks `.githooks`; no secrets or AI attribution. BE-31 needs PO go, BE-22 approved milestone, BE-13 explicitly after launch.

## Doing

- #90 integrated main and verified locally; refreshed CI pending.
- #102 partial hosted Auth check; body parity/Site URL decision remain open.

## Done

- Restored state and checked every authored PR review; no new backend source requests.
- Resolved #90 merge conflicts, retaining all suites and reviewed BE-34 source; full integrated DB/reveal, focused expiry, function and static checks pass.
- Reconfirmed browser-host blocker for BE-27; no hosted writes or production access.

## Next

- Require green #90 integration CI, then lead merges the reviewed backend PRs in order.
- No new unblocked launch BE implementation remains: #75 loader merged; BE-32 awaits QA-13 workflow/configuration; BE-31 waits PO go; BE-22 awaits milestone; BE-13 is after launch.

## Blocked

- BE-27: authorized read-only template-body view unavailable. CLI cannot retrieve bodies, browser host unavailable, prior Safari access rejected, keychain lookup timed out. Site URL correction needs lead/PO decision beyond GET-only task.
- Lead integration #83/#90/#91/#97/#100; D28 local-day3/D21 Sunday scheduling/semantics confirmation; hosted secrets/Vault/SMTP/device acceptance; QA-13 workflow/configuration; PO/milestone gates above.

## Needs from

- Lead: merge backend PRs in recorded order after green integrated CI; confirm D28/D21 semantics. #90 source unchanged and conflicts resolved; full local checks pass. #100 focused security source gate cleared in #101.
- Lead/PO: review BE-27 evidence on #102, decide intended dev Site URL and provide authorized read-only template-body access. Never put credentials in comments/repository.
- Mobile/QA: D39 optional `error.details.inviter_name` remains token-only and first-name bounded, generic fallback otherwise. Dev callback/OTP6 verified; body parity/device PKCE/SMTP acceptance still pending. #100 additive free days-only/null premium fields/current-member entitlement, #91 saver and #97 offers await integration.
