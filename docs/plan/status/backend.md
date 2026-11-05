# Backend / data developer status

Updated: 2026-11-05 17:40 Cairo · Branch: `be/BE-35-archive-consent` · Task: BE-35 integration

## Resume here

- Current branch `be/BE-35-archive-consent`, draft PR #115. Integrated origin/main `650f3b9` without rebase in `2a5d63b` (merged QA-15 #117 + MOB-19 #118). No conflicts; consent migration/tests/functions unchanged. No unmerged #100 source included; migration250000 must follow240000.
- Startup fetch/status/log/pull clean; inspected all five authored open PR comments and inline comments (#100/#102/#113/#115/#116), plus #115 reviews. No new backend review request on those PRs. #100 at8fa27cf and #102 atea05a51 still seven green, awaiting lead merges.
- Startup resume commands pass (plan/sync/whitespace); #115 CI42053028075 still fails app and QA consent adoption, while DB/functions/static pass. After main650f3b9 integration: consent56/reveal23 pass (`/private/tmp/bonded-resume-{consent,reveal}.log`); generated type/static verification recorded below. Backend feature sources unchanged.
- Exact next step: check new integrated CI; keep #115 draft for MOB-46 sheet-only consent/error adoption + ack and QA-16 green companion PRs. QA-16 remote branch exists but no PR/ready signal yet; MOB-46 branch absent at fetch. Do not integrate unfinished consumer branches or edit their files. If main advances, merge without rebase, preserving all suites/allowlists/contracts/types.
- New lead request in main650f3b9 / #118: align CONTRACTS §6 with server-only app premium (me + current partner, expiry checked); SDK customer info is a refetch hint. Implement on a separate BE-18 documentation branch from latest main after pushing this checkpoint. No other unblocked backend implementation remains; BE-31 needs PO go, BE-22 approved milestone, BE-13 after launch.
- Consent contract: `accept_invite(p_code,p_token?,p_archive_own=false)` requires true for a valid solo join; `CONFIRM_ARCHIVE` otherwise. Private RLS ledger binds typed approval to exact solo couple; legacy/replacement-space approval requires requester reconfirmation, never inferred from inviter approval. Old public overload removed; private core denied to all API roles.
- Focused security source re-review complete through ba98aad, merged via #103; no new confirmed vulnerability established, reviewer did not execute runtime tests. Relevant consumer/source changes need re-review. Existing isolated reset/HTTP evidence `/private/tmp/bonded-be35-{reset-exact,http}.log`: omitted/false/null refusals, confirmed/unconfirmed race, private archive, stale approval/reconfirmation and anon denial; fixtures cleaned. Shared QA stack untouched.
- Final #115 integrated-source CI42052015742 atcfecf58: complete DB29 suites/functions/plan/agent-sync pass. Real reset succeeds then QA271 pass/10 fail solely CONFIRM_ARCHIVE (1 expected fail,7todo); app only errors.CONFIRM_ARCHIVE missing at errors.ts:115. Failed job logs inspected: `/private/tmp/bonded-integrate115-{app,reset}-ci.log`. MOB-46/QA-16 remain the only adoption failures; do not waive CI. PR body refreshed with validation, accepted security source review and migration order. New authored QA-15 #117 has no review/comments/inline requests.
- Commands to re-run for this status-only checkpoint: export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH; export SUPABASE_HOME=/private/tmp/bonded-cli-resume SUPABASE_TELEMETRY_DISABLED=1 XDG_CACHE_HOME=/private/tmp/bonded-gh-cache; node scripts/plan/generate.mjs --check; node scripts/agents/sync.mjs --check; git diff --check; gh pr checks 100; gh pr checks 102; gh pr checks 115 (expected consumer failures). For relevant source changes rerun consent/reveal/affected suites/types/functions and complete CI; full pre-integration local suite and integrated full CI already passed, so status-only changes do not justify another full local run.
- No hosted writes. Dev only nyqbrsqqalygydtwvybb; no prod. Shared stack never reset/stopped. Hooks .githooks; no secrets/AI attribution. Uncommitted none after commit/push.

## Doing

- #100/#102 requested integrations pushed with all seven required CI checks green; #115 main refresh complete, awaiting consumer adoption.

## Done

- Full startup rerun and integrated full CI DB suite passed; all authored open PR feedback checked. #97 merged/deployed (lead confirmation).
- #100 and #102 post-#97 review conflicts resolved without changing reviewed feature sources.

## Next

- Lead merges green #100/#102; MOB-46/QA-16 integrated adoption, then lead deploys240000 →250000.

## Blocked

- #115 needs mobile sheet-only consent/error map/ack + QA contract adoption and green integrated CI. #100 awaits lead merge/dev deploy; #102 lead docs merge. BE-31 needs PO go; BE-22 approved milestone; BE-13 after launch. Hosted Auth/device/function configuration evidence needs PO/QA. D28 local-day3 interpretation needs lead confirmation.

## Needs from

- Mobile: MOB-46 ack BE-35; pass true only from D37 confirm; map CONFIRM_ARCHIVE including stale pending approvals.
- QA: QA-16 solo token-join consent fixtures and refusal coverage.
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
