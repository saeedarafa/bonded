# Backend / data developer status

Updated: 2026-11-05 17:40 Cairo · Branch: `be/BE-35-archive-consent` · Task: BE-35 integration

## Resume here

- Branch `be/BE-35-archive-consent`, draft #115. Integrated ready mobile #122/fba7a50 and QA-16 #119/adb2612 without rebase, after latest main65d014d. No conflicts. Server consent source unchanged; consumer commits retained with ownership intact. Mobile ack is on #115; SEC-01 focused mobile review is on #122 atfba7a50, QA review on #119 atadb2612. Backend sign-off throughba98aad remains applicable.
- Combined local validation **passes**: consent56/reveal23/generated types/current, full app48 suites/899 tests + typecheck/lint/prettier/flow lint, real isolated reset/seed and HTTP contracts289 pass/1 expected fail/7todo. Logs `/private/tmp/bonded-combined-{consent,reveal,app,reset,contract}.log`. Isolated project `bonded_be35_combined`603xx stopped successfully; no shared stack or hosted writes.
- Exact next step: check final-head #115 CI after this status commit. When all seven green, mark ready (if still draft) and await lead #100/240000 → combined #115/250000 merge/deploy. Lead closes carried companions #119/#122 after merging this vehicle. Relevant backend/consumer source is already reviewed and unchanged; no #100 or BE-11-context source included. Do not waive CI.
- Prior main refresh at0f6ee1a passed consent56/reveal23/types/static. Source grant/clock/consent semantics unchanged: true only from D37 sheet; default calls omit; typed approval binds exact solo space; stale approvals require requester reconfirmation. #122 reopens sheet on refusal, maps inviter/waiting errors; #119 adds all six omitted/false/null refusals with unchanged-state checks and explicit positive fixtures.
- Separate BE-11 P2 follow-up draft #123 on `be/BE-11-streak-context` (latest head via gh). Migration20261105180000 appends nullable saver_reason/previous_streak; focused context28/saver46, full DB29 scripts, generated types/current, seed/static/app tsc and isolated real reset pass. HTTP280 pass/1 expected fail/7todo/**one failure only**: QA's exact old six-key list in streak.test.ts:112. QA companion requested in PR body/status; do not edit QA files. No push/Realtime changes. Its isolated bonded_be11_context stack was stopped successfully, shared stack untouched. #123 stays draft until QA adoption + green CI; migration order after #100/#115.
- #100 at8fa27cf and #102 atea05a51 remain seven green/mergeable, await lead. #120 source wording is complete, latest integrated head6f4b284 pushed. No unanswered backend requests in startup authored PR comments/reviews/inline.
- Re-run: `git fetch`; `git status`; `git log -5 --oneline`; `git pull --ff-only`; `gh pr list --author @me`; `gh pr view <n> --comments`; `gh pr checks 115`; `gh pr checks 123`; `export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH SUPABASE_HOME=/private/tmp/bonded-cli-resume SUPABASE_TELEMETRY_DISABLED=1 XDG_CACHE_HOME=/private/tmp/bonded-gh-cache`; `node supabase/tests/archive-consent.test.mjs`; `node supabase/tests/rls.test.mjs`; `node supabase/tests/gen-types.mjs --check`; `node scripts/plan/generate.mjs --check`; `node scripts/agents/sync.mjs --check`; `git diff --check`.
- Dev only nyqbrsqqalygydtwvybb; never prod. No hosted writes. Shared QA stack untouched. Hooks .githooks; no secrets/AI attribution.

## Doing

- BE-35 #115 combined validation passes; final CI gates readiness and lead merge.

## Done

- Full startup rerun and integrated full CI DB suite passed; all authored open PR feedback checked. #97 merged/deployed (lead confirmation).
- #100 and #102 post-#97 review conflicts resolved without changing reviewed feature sources.

## Next

- Lead merges green #100/#102; MOB-46/QA-16 integrated adoption, then lead deploys240000 →250000.

## Blocked

- #115 final CI/lead merge after #100; #123 needs QA companion and green CI. #100 awaits lead merge/dev deploy; #102 lead docs merge. BE-31 needs PO go; BE-22 approved milestone; BE-13 after launch. Hosted Auth/device/function configuration evidence needs PO/QA. D28 local-day3 interpretation needs lead confirmation.

## Needs from

- Mobile: ack/consent/error adoption complete in integrated #122; retain native acceptance and optional direct API true-payload/stale-approval UI regressions noted by security.
- QA: QA-16 integrated; new #123 needs streak response-key/type/helper adoption and HTTP context coverage (one exact old-key assertion currently fails).
- Security: re-review relevant implementation/consumer changes; backend reviewed sources unchanged by main integration.
- Lead: green #100 merge/dev240000 before daily-reminder; #102 docs merge; BE-35 companion integration/deploy250000 after240000; D28 and partner ritual-time/J5 preview privacy decisions.

## Kept from main (BE-14 integration status)

Updated: 2026-11-05 · Branch: `be/BE-14-weekly-recap` · Task: BE-14 integration

### (from main, BE-14) Resume here

- Branch `be/BE-14-weekly-recap`, PR #100. Integrated origin/main `581783b` without rebase per lead review after #97 merged (`586424e`, migration230000 deployed to dev). Retained both offers/recap suites, both public RPC allowlists and both CONTRACTS descriptions/log entries; generated types combined. Reviewed migration240000, recap tests and daily-reminder source unchanged.
- Verification: recap55/offers46/reveal23/helpers74, generated types/current check, functions54+QA10 and seed/plan/agent-sync/whitespace pass. Logs `/private/tmp/bonded-integrate100-*.log`. No hosted writes or shared-stack reset.
- Exact next step: require seven refreshed #100 CI checks, then lead merges/deploys240000 before updated daily-reminder. Integrate main into #102 (status-only conflict), then refresh #115. Only lead merges main.
- BE-35 draft #115 at `666aab9`: startup consent56, full DB28 suites, types/functions52+QA10/static pass; logs `/private/tmp/bonded-loop-{consent,db,types,functions}.log`. Focused security source review complete through ba98aad. Lead accepts approach; MOB-46 must ack/map CONFIRM_ARCHIVE/pass true only from D37 sheet; QA-16 adopts ten contract cases. Keep draft until companion integration and green CI. Migration250000 follows240000; no unmerged #100 source is included in #115.
- #102 remains documentation-only partial Auth evidence; Site URL/subjects differ, template bodies/SMTP/native parity unverified. PO owns settings; no hosted changes.
- Commands: export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH; export SUPABASE_HOME=/private/tmp/bonded-cli-resume SUPABASE_TELEMETRY_DISABLED=1 XDG_CACHE_HOME=/private/tmp/bonded-gh-cache; node supabase/tests/weekly-recap.test.mjs; node supabase/tests/offers.test.mjs; node supabase/tests/rls.test.mjs; node supabase/tests/private-helpers.test.mjs; node supabase/tests/gen-types.mjs --check; bash qa/ci/functions.sh; node supabase/scripts/build-seed.mjs --check; node scripts/plan/generate.mjs --check; node scripts/agents/sync.mjs --check; git diff --check; gh pr checks 100.
- Dev only nyqbrsqqalygydtwvybb; no prod. Shared QA stack untouched. Hooks .githooks; no secrets/AI attribution.

### (from main, BE-14) Doing

- Review-requested #100 main integration; then #102 and #115.

### (from main, BE-14) Done

- #97 merged/deployed (lead confirmation). Startup complete rerun passed on #115; all authored PR feedback checked.

### (from main, BE-14) Next

- Green #100/#102 integration, BE-35 consumer adoption/ack, lead merge/dev deployment.

### (from main, BE-14) Blocked

- #115 requires MOB-46 + QA-16 and green combined CI. BE-31 needs PO go; BE-22 approved milestone; BE-13 after launch. Hosted Auth/device/function configuration evidence needs PO/QA. D28 local-day3 interpretation needs lead confirmation.

### (from main, BE-14) Needs from

- Lead: green #100 merge/dev deploy240000 before daily-reminder; #102 docs merge; D28 confirmation.
- Mobile/QA: MOB-46 ack and sheet-only consent, QA-16 contract fixtures on #115; no backend consumer edits.
- Security: re-review relevant implementation/consumer deltas; backend reviewed feature sources unchanged.
