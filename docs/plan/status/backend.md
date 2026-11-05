# Backend / data developer status

Updated: 2026-11-05 · Branch: `be/BE-14-weekly-recap` · Task: BE-14 main integration after BE-33

## Resume here

- Branch `be/BE-14-weekly-recap`, PR #100; integrated origin/main `680b361` after #83 merged. Resolved own status/test-script conflicts only. Task BE-14 source unchanged from reviewed `ad8845d`. All main suites plus this task suite retained; no other unmerged migration added. Checkpoint = commit containing this file.
- Exact next step: require green latest-head CI on this integration. Continue main integration for remaining conflicting backend PRs. Only lead merges main; security branches are outside ownership.
- Session: #90 integration `843f0e0`, #91 `b45af19`, #97 `ea6693a` pushed; full DB (reveal23/expired26/onboarding37), types/functions/static pass. Current task recap55, reveal23/onboarding37, generated types, functions54+QA10 and static checks pass; prior full task DB/isolated HTTP evidence retained in PR history. All authored PR comments reviewed, no new source requests. Current integration logs `/private/tmp/bonded-be-14-main-*.log`.
- Commands: `export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH`; `export SUPABASE_HOME=/private/tmp/bonded-cli-resume SUPABASE_TELEMETRY_DISABLED=1`; `npm --prefix supabase/tests test`; `npm --prefix supabase/tests run check:types`; `bash qa/ci/functions.sh`; `node supabase/scripts/build-seed.mjs --check`; `node scripts/plan/generate.mjs --check`; `node scripts/agents/sync.mjs --check`; `git diff --check`; `gh pr checks 90`; `gh pr view 90 --comments`. Full DB's existing 10,000-invite fixture takes several minutes. For unchanged status-only startup use auth-email/static/CI checks, without repeating full suites. Never reset/stop shared stack. CLI requires the SUPABASE_HOME export even for types (otherwise sandbox telemetry write fails).
- BE-27 draft #102 `be/BE-27-hosted-auth-check` at `6f93195`, prior seven checks green. Evidence `ea1b6b0`, `supabase/AUTH_DEV_CHECK.md` there. Dev callback allow-list/OTP6 confirmed; Site URL `http://localhost:3000` differs from local `bonded://`; confirmations enabled; subjects differ; template bodies unverified. CLI config pull does not retrieve HTML bodies. Prior browser inventory empty/host unavailable; Safari automatic review rejected access; keychain lookup timed out. Do not repeat rejected access or credential output. Keep draft until body/link/token parity verified; Site URL needs lead/PO decision. Raw logs outside repo.
- Reviewed heads #91 `8237117` (security `e7c98cb`), #97 `2dee13c` (security `17b6c47`), #100 `70f2d78` (security `ad8845d`, handoff #101 `7840530`). Preserve migration order #83/200000 (merged) → #90/210000 → #91/220000 → #97/230000 → #100/240000, then updated daily-reminder. Dev auto-deploys main. BE-14 isolated stack `/private/tmp/bonded-be11-stack`, project bonded_backend_be11, API58321/DB58322 retains reset snapshot; prior authenticated HTTP privacy/concurrent claims/unpair races passed and fixtures cleaned.
- Dev only `nyqbrsqqalygydtwvybb`; never prod `nciyrepyphvksusoigzx`. Hooks `.githooks`; no secrets or AI attribution. BE-31 needs PO go; BE-22 approved milestone; BE-13 after launch.

## Doing

- Resolve backend PR integration conflicts after BE-33 merged; refresh CI without changing reviewed feature source.
- #102 partial hosted Auth parity evidence; body access and Site URL decision pending.

## Done

- BE-33 table/types/contracts on main via #83; mobile onboarding sync unblocked.
- Startup and open PR review complete; prior source acceptance remains applicable to unchanged feature source.

## Next

- Integrate #90, #91, #97, #100, #102; green CI; lead merges in migration order.
- No new unblocked launch BE implementation remains: #75 loader merged; BE-32 waits QA-13 workflow/environment configuration; BE-31 PO go; BE-22 milestone; BE-13 after launch.

## Blocked

- BE-27 authorized read-only template-body access unavailable; Site URL decision lead/PO.
- Lead integration/deployment; D28 local-day3 confirmation (D21 confirmed); hosted secrets/Vault/SMTP/device acceptance; QA-13 configuration; PO/milestone gates.

## Needs from

- Lead: merge green backend PRs in migration order; confirm D28 semantics. D21 confirmed and #100 focused security gate cleared.
- Lead/PO: review #102 evidence, decide dev Site URL and provide authorized read-only template-body access; no credentials in comments/repo.
- Mobile/QA: BE-33 types on main; D39 token-only bounded `error.details.inviter_name` after #90, generic fallback otherwise. Dev callback/OTP6 verified; body parity/device PKCE/SMTP pending. #100 free days-only/null premium fields/current-member entitlement, #91 saver and #97 offers await integration.
- Release: BE-10 `send_nudge` already on main; partner ritual-time/J5 summary requests need lead contract/privacy decision before expanding partner preview data.
