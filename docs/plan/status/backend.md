# Backend / data developer status

Updated: 2026-11-05 · Branch: `be/BE-27-hosted-auth-check` · Task: BE-27 integration

## Resume here

- Branch `be/BE-27-hosted-auth-check`, PR #102. Integrated origin/main `581783b` without rebase per lead review; only backend status conflicted. Auth report is unchanged; only report/status differ from main. Ready for lead docs merge after green refreshed CI.
- #100 integrated main in `8fa27cf`, pushed. Retained offers + recap suites/allowlists/contracts/types; recap55/offers46/reveal23/helpers74/types/functions54+QA10/static pass. Latest CI pending; reviewed recap migration/tests/daily-reminder unchanged. Lead merges/deploys240000 before daily-reminder.
- Local #102 verification: auth4, seed/plan/agent-sync/whitespace pass (rerun below). No hosted writes or shared-stack reset.
- Exact next step: refresh #115 against main581783b (preserve every suite/allowlist/contract/type), then check #100/#102 refreshed CI. #115 stays draft for MOB-46 + QA-16. Only lead merges main.
- BE-35 draft #115 at `666aab9`: startup consent56, full DB28 suites, types/functions52+QA10/static pass; logs `/private/tmp/bonded-loop-{consent,db,types,functions}.log`. Focused security source review complete through ba98aad. Lead accepts approach; MOB-46 must ack/map CONFIRM_ARCHIVE/pass true only from D37 sheet; QA-16 adopts ten contract cases. Keep draft until companion integration and green CI. Migration250000 follows240000; no unmerged #100 source is included in #115.
- #102 remains documentation-only partial Auth evidence; Site URL/subjects differ, template bodies/SMTP/native parity unverified. PO owns settings; no hosted changes.
- Commands on #102: node supabase/tests/auth-email.test.mjs; node supabase/scripts/build-seed.mjs --check; node scripts/plan/generate.mjs --check; node scripts/agents/sync.mjs --check; git diff --check; gh pr checks 102. Feature commands on #100: export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH; export SUPABASE_HOME=/private/tmp/bonded-cli-resume SUPABASE_TELEMETRY_DISABLED=1 XDG_CACHE_HOME=/private/tmp/bonded-gh-cache; node supabase/tests/weekly-recap.test.mjs; node supabase/tests/offers.test.mjs; node supabase/tests/rls.test.mjs; node supabase/tests/private-helpers.test.mjs; node supabase/tests/gen-types.mjs --check; bash qa/ci/functions.sh; node supabase/scripts/build-seed.mjs --check; node scripts/plan/generate.mjs --check; node scripts/agents/sync.mjs --check; git diff --check; gh pr checks 100.
- Dev only nyqbrsqqalygydtwvybb; no prod. Shared QA stack untouched. Hooks .githooks; no secrets/AI attribution.

## Doing

- Review-requested #100/#102 main integration pushed; #115 refresh next.

## Done

- #97 merged/deployed (lead confirmation). Startup complete rerun passed on #115; all authored PR feedback checked.

## Next

- Green #100/#102 integration, BE-35 consumer adoption/ack, lead merge/dev deployment.

## Blocked

- #115 requires MOB-46 + QA-16 and green combined CI. BE-31 needs PO go; BE-22 approved milestone; BE-13 after launch. Hosted Auth/device/function configuration evidence needs PO/QA. D28 local-day3 interpretation needs lead confirmation.

## Needs from

- Lead: green #100 merge/dev deploy240000 before daily-reminder; #102 docs merge; D28 confirmation.
- Mobile/QA: MOB-46 ack and sheet-only consent, QA-16 contract fixtures on #115; no backend consumer edits.
- Security: re-review relevant implementation/consumer deltas; backend reviewed feature sources unchanged.
