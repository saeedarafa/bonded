# Backend / data developer status

Updated: 2026-11-04 · Branch: `be/BE-27-hosted-auth-check` · Task: BE-27 hosted verification

## Resume here

- Draft PR #102: https://github.com/saeedarafa/bonded/pull/102 . Evidence commit `ea1b6b0`; initial CI queued at checkpoint, local auth4/plan/sync/whitespace pass. Branch from latest origin/main `6f8b851`; one BE-27 evidence PR, no stacked dependency. Last step is the commit containing this handoff; uncommitted work none after commit/push. No product code/configuration changes.
- Exact next step: check #102 CI/reviews (`gh pr view 102 --comments`, `gh pr checks 102`) and all other backend PR reviews first. #102 remains draft until the outstanding hosted body check is possible; do not mark BE-27 complete from partial CLI evidence. Finish BE-27 by obtaining an authorized read-only view of dev email template bodies, comparing both with local HTML and recording token/link parity. CLI authentication **is available** despite no exported token; `config pull --dry-run --remote=nyqbrsqqalygydtwvybb` worked. It does not retrieve HTML bodies. Browser host unavailable; automatic review rejected Safari; keychain lookup timed out. Never wait for a human reply or expose credentials.
- BE-27 verified hosted settings: Site URL `http://localhost:3000` (local `bonded://`); callback allow-list includes `bonded://auth/callback` and existing Expo redirects; email OTP6; confirmations enabled. Subjects differ from local, bodies unverified. Evidence/procedure: `supabase/AUTH_DEV_CHECK.md`. Local scratch `/private/tmp/bonded-be27-{config,bare}`, raw comparison `/private/tmp/bonded-be27-hosted-config.log`. Do not commit raw config/logs. No hosted writes or production calls.
- BE-14 checkpoint `70f2d78` pushed on `be/BE-14-weekly-recap`, PR #100. Focused security source accepted at `ad8845d`: https://github.com/saeedarafa/bonded/pull/100#issuecomment-6640700293 ; status handoff #101. Prior seven checks green41900229881; source `0c61f28` plus allowlist correction `2348399` unchanged. This session reran recap55, full DB suite/reveal23, current types, functions54+QA10, seed/plan/sync/whitespace successfully; logs `/private/tmp/bonded-resume-{recap,db,types,functions}.log`.
- All ten open authored PR comment histories read; backend inline comments empty. #83/#90/#91/#97/#100 have no new code requests and seven green required checks at reviewed heads. #91 security acceptance `e7c98cb` plus cosmetic EOF fix `8237117`; #97 acceptance `17b6c47`, status head `2dee13c`. Security owns #89/#96/#98/#99/#101.
- Preserve integration order #83/200000 → #90/210000 → #91/220000 → #97/230000 → #100/240000, then updated daily-reminder. Only lead merges main; dev auto-deploys. BE-14 branch contains no earlier unmerged migration. Isolated stack `/private/tmp/bonded-be11-stack`, project bonded_backend_be11, API58321/DB58322 remains BE-14 reset snapshot; prior authenticated HTTP privacy/concurrent claims/unpair races passed and fixtures cleaned. Never reset/stop shared bonded.
- Commands: `export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH`; `export SUPABASE_HOME=/private/tmp/bonded-cli-resume SUPABASE_TELEMETRY_DISABLED=1`; `node supabase/tests/auth-email.test.mjs`; `node scripts/plan/generate.mjs --check`; `node scripts/agents/sync.mjs --check`; `git diff --check`. Full BE-14 recheck requires switching back to its branch before running its saved commands. For documentation-only changes do not repeat the full suite without new code/failures.
- Dev only `nyqbrsqqalygydtwvybb`; never production. Hooks `.githooks`; no secrets or AI attribution. Remaining launch backend work is external-gated; BE-13 explicitly after launch, BE-31 waits PO go, BE-22 approved milestone.

## Doing

- BE-27 partial hosted check recorded in draft #102 for lead review; HTML body parity and Site URL decision remain open. Source documentation unchanged after evidence commit; latest checkpoint updates this status only.

## Done

- Full prior BE-14 verification rerun green, focused security acceptance recorded/pushed.
- Open PR reviews and inline comments checked; no new backend code requests.
- Authenticated CLI dev GET check confirmed redirects/OTP and exposed localhost Site URL plus different subjects; no settings changed.

## Next

- Read-only template-body verification when an authorized interface is available; monitor integration/reviews.

## Blocked

- BE-27: CLI does not retrieve bodies; browser host unavailable, Safari access rejected, keychain lookup times out. Need an authorized read-only template view. Site URL correction requires lead/PO decision and explicit authorization beyond GET-only task.
- Lead ordered integration #83/#90/#91/#97/#100 and D28 local-day3/D21 Sunday timing confirmation; hosted function secrets/Vault/SMTP/device acceptance; BE-32 QA-13 workflow/configuration; BE-31 PO go; BE-22 approved milestone. BE-13 deferred after launch.

## Needs from

- Lead/PO: review `supabase/AUTH_DEV_CHECK.md`, decide the intended dev Site URL, provide an authorized read-only template view. Merge backend migrations in the recorded order; #100 security source gate cleared in #101, scheduling/semantics decision remains.
- Mobile/QA: callback/OTP6 verified on dev; body parity/device PKCE/SMTP still unverified. #100 contract is additive with free days-only, null premium fields and current-member server entitlement; #91 saver/#97 offers ready for integration.
- PO: dev-only hosted configuration and device acceptance; no secrets in comments/repository.
