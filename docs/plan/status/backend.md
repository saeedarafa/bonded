# Backend / data developer status

Updated: 2026-11-04 · Branch: `be/BE-17-couple-offers` · Task: BE-17 / D28

## Resume here

- Exact next step: validate BE-17 implementation: generate types, full DB/function/static checks, isolated real reset/HTTP partner race, then one PR. Branch starts latest origin/main6f8b851, no stacked source. Focused offers42 passed. Public get_offer(p_kind) has no client clock; shared once-per-kind 24-hour ledger; current-member premium check, read-only own clocks; winback first shown local day3 since pairing (pairing day1), existing clock may cross midnight. This literal D28 timing interpretation is documented for lead review.
- Implementation checkpoint: migration20261103230000, offers.test.mjs42; RPC/ledger contract and allowlist updated. Generate types before final verification. No entitlement grant/prices/content edits. All writes parent-locked and membership rechecked; clients cannot create/extend/delete clocks or call clock helper.
- Commands: export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH; export SUPABASE_HOME=/private/tmp/bonded-cli-resume SUPABASE_TELEMETRY_DISABLED=1; node supabase/tests/offers.test.mjs; node supabase/tests/gen-types.mjs; npm --prefix supabase/tests test; npm --prefix supabase/tests run check:types; bash qa/ci/functions.sh; node supabase/scripts/build-seed.mjs --check; node scripts/plan/generate.mjs --check; node scripts/agents/sync.mjs --check; git diff --check.
- This run: #83 lead-requested main merge committed/pushed eede10f; all DB suites (onboarding37), types/functions/static pass; replied https://github.com/saeedarafa/bonded/pull/83#issuecomment-6639455855 . Refresh current CI. BE-33 source unchanged, package retains dev-content/revenuecat/onboarding.
- #90 BE-34 b927f70 marked ready: scoped SEC-01 sign-off and all seven checks green41851696577. #91 BE-11 e7c98cb still draft awaiting focused security; full DB/types/functions/static pass, previous3d66344 CI seven green41890283890. #89/#96 security-owned; #89 lead requests only security status conflict fix, no backend request.
- Merge order must preserve 200000(#83)→210000(#90)→220000(#91)→230000(BE-17) on auto-deploy dev. Only lead merges main. BE-18/190000 already merged/deployed. Next backend BE-14.
- Isolated stack `/private/tmp/bonded-be11-stack`, project bonded_backend_be11 API58321/DB58322; can replace its migration snapshot for BE-17 verification. Never reset/stop shared bonded. No hosted writes; dev only nyqbrsqqalygydtwvybb; never production. Hooks `.githooks`; no secrets/AI attribution.

## Doing

- BE-17 offers implementation and verification, one branch/PR.

## Done

- Startup verification and PR comments first. BE-33 main integration pushed; BE-34 marked ready after security/green CI.
- BE-17 focused42 green.

## Next

- Finish BE-17 verification and PR; BE-14 next from latest origin/main.

## Blocked

- BE-11/#91 focused security sign-off pending; reviewed migration rollout order.
- Hosted credentials/secrets/Vault/SMTP; BE-31 PO go; BE-22 approved milestone.

## Needs from

- Lead: #83 integrated eede10f, green local suite; #90 ready. Preserve migration200000→210000→220000→230000.
- Security: focused BE-11 premium/shared-quota/replay review on #91.
- Mobile/QA: BE-17 contract changed; get_offer server expiry and eligibility, no client writes or prices. BE-33 private onboarding on #83; BE-34 token expired name on #90; BE-11 saver on #91.
- PO: dev-only hosted credentials/secrets/Vault/SMTP.
