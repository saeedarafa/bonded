# Backend / data developer status

Updated: 2026-11-04 · Branch: `be/BE-34-expired-invite` · Task: BE-34 main integration

## Resume here

- Recovery checkpoint 2026-11-04: fetched origin; BE-27 clean at `6f93195`, pull up to date, auth4/plan/sync/whitespace pass. All 11 authored PR conversations/reviews/inline comments checked; no new backend source request. #102 seven checks green run `41911186841`. Discovered #90 merge conflict; switched/pulled `be/BE-34-expired-invite` and merged origin/main `6f8b851` without rebase. Only conflicts are test script and backend status; retained main's dev-content/revenuecat suites plus expired-invite suite. BE-34 migration/function/test source unchanged. Types current; functions52 + QA10, seed/plan/sync/whitespace pass. Full integrated DB suite still running; log `/private/tmp/bonded-be34-integrated-db.log`.
- Exact next step: finish BE-34/#90 full DB verification (`npm --prefix supabase/tests test`), then check pushed CI. Types/functions/seed/plan/sync already pass. Merge checkpoint = commit containing this file. No hosted writes; shared QA stack untouched. Preserve ordered migrations below; backend never merges main. Then return to BE-27 hosted access check if an authorized interface becomes available.
- Draft PR #102: https://github.com/saeedarafa/bonded/pull/102 . Evidence commit `ea1b6b0`; CI green at `e1f776b`, local auth4/plan/sync/whitespace pass. Branch from latest origin/main `6f8b851`; one BE-27 evidence PR, no stacked dependency. Last step is the commit containing this handoff; uncommitted work none after commit/push. No product code/configuration changes.
- BE-27 outstanding: authorized read-only dev email template-body parity with local HTML. CLI authentication works but config pull does not retrieve HTML. Browser host unavailable at prior checkpoint; do not repeat rejected Safari/keychain access or hosted writes. Keep #102 draft and do not mark hosted verification complete from partial evidence.
- BE-27 verified hosted settings: Site URL `http://localhost:3000` (local `bonded://`); callback allow-list includes `bonded://auth/callback` and existing Expo redirects; email OTP6; confirmations enabled. Subjects differ from local, bodies unverified. Evidence/procedure: `supabase/AUTH_DEV_CHECK.md`. Local scratch `/private/tmp/bonded-be27-{config,bare}`, raw comparison `/private/tmp/bonded-be27-hosted-config.log`. Do not commit raw config/logs. No hosted writes or production calls.
- BE-14 checkpoint `70f2d78` pushed on `be/BE-14-weekly-recap`, PR #100. Focused security source accepted at `ad8845d`: https://github.com/saeedarafa/bonded/pull/100#issuecomment-6640700293 ; status handoff #101. Prior seven checks green41900229881; source `0c61f28` plus allowlist correction `2348399` unchanged. This session reran recap55, full DB suite/reveal23, current types, functions54+QA10, seed/plan/sync/whitespace successfully; logs `/private/tmp/bonded-resume-{recap,db,types,functions}.log`.
- All eleven open authored PR comment histories read; backend inline comments empty. #83/#90/#91/#97/#100 have no new code requests and seven green required checks at reviewed heads. #91 security acceptance `e7c98cb` plus cosmetic EOF fix `8237117`; #97 acceptance `17b6c47`, status head `2dee13c`. Security owns #89/#96/#98/#99/#101.
- Preserve integration order #83/200000 → #90/210000 → #91/220000 → #97/230000 → #100/240000, then updated daily-reminder. Only lead merges main; dev auto-deploys. BE-14 branch contains no earlier unmerged migration. Isolated stack `/private/tmp/bonded-be11-stack`, project bonded_backend_be11, API58321/DB58322 remains BE-14 reset snapshot; prior authenticated HTTP privacy/concurrent claims/unpair races passed and fixtures cleaned. Never reset/stop shared bonded.
- Commands: `export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH`; `export SUPABASE_HOME=/private/tmp/bonded-cli-resume SUPABASE_TELEMETRY_DISABLED=1`; `node supabase/tests/auth-email.test.mjs`; `node scripts/plan/generate.mjs --check`; `node scripts/agents/sync.mjs --check`; `git diff --check`. Full BE-14 recheck requires switching back to its branch before running its saved commands. For documentation-only changes do not repeat the full suite without new code/failures.
- Dev only `nyqbrsqqalygydtwvybb`; never production. Hooks `.githooks`; no secrets or AI attribution. Remaining launch backend work is external-gated; BE-13 explicitly after launch, BE-31 waits PO go, BE-22 approved milestone.

## Doing

- BE-34/#90: resolve main integration conflicts and validate retained test suites.
- BE-27 partial hosted check remains draft #102; body parity and Site URL decision open.

## Done

- Full prior BE-14 verification rerun green, focused security acceptance recorded/pushed.
- Open PR reviews and inline comments checked; no new backend code requests.
- Authenticated CLI dev GET check confirmed redirects/OTP and exposed localhost Site URL plus different subjects; no settings changed.
- This checkpoint: #102 seven checks green at `6f93195`; browser inventory still reports no browsers / browser host unavailable. Security #101 checkpoint `7840530` preserves source verdicts; no backend source changes requested. #90 main conflicts resolved with every test retained; migration/source unchanged.

## Next

- Read-only template-body verification when an authorized interface is available; monitor integration/reviews. No unblocked BE task remains in the launch backlog: #75 loader merged, QA-13/hosted configuration external; #83/#90/#91/#97/#100 await lead; BE-31 awaits PO go; BE-22 awaits milestone; BE-13 is after launch.

## Blocked

- BE-27: CLI does not retrieve bodies; browser host unavailable, Safari access rejected, keychain lookup times out. Need an authorized read-only template view. Site URL correction requires lead/PO decision and explicit authorization beyond GET-only task.
- Lead ordered integration #83/#90/#91/#97/#100 and D28 local-day3/D21 Sunday timing confirmation; hosted function secrets/Vault/SMTP/device acceptance; BE-32 QA-13 workflow/configuration; BE-31 PO go; BE-22 approved milestone. BE-13 deferred after launch.

## Needs from

- Lead/PO: review `supabase/AUTH_DEV_CHECK.md`, decide the intended dev Site URL, provide an authorized read-only template view. Merge backend migrations in the recorded order; #100 security source gate cleared in #101, scheduling/semantics decision remains.
- Mobile/QA: callback/OTP6 verified on dev; body parity/device PKCE/SMTP still unverified. #100 contract is additive with free days-only, null premium fields and current-member server entitlement; #91 saver/#97 offers ready for integration.
- PO: dev-only hosted configuration and device acceptance; no secrets in comments/repository.
