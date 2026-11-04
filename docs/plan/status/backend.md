# Backend / data developer status

Updated: 2026-11-04 · Branch: `be/BE-17-couple-offers` · Task: BE-17 / D28

## Resume here

- Exact next step: finish this startup verification (full DB run still in progress in /private/tmp/bonded-resume-db.log), then remove the cosmetic trailing blank line on #91, verify/push and mark ready after refreshed CI. Take BE-14 from latest origin/main next (one branch/PR). #97 is ready: all seven checks green41896464658 and focused security source sign-off at17b6c47. PR #97 https://github.com/saeedarafa/bonded/pull/97; implementation89930dc. Full DB rerun exit0, offers46, hardening91, generated types current, functions52+QA10, seed/plan/agent-sync/whitespace pass. Isolated real reset/seed and authenticated HTTP intro/winback partner races pass on corrected source; one86400second claim per kind, outsider/anon/extension denied, premium suppressed, expired retry stable. Fixture accounts/couples removed. Logs `/private/tmp/bonded-be17-{db2,focused3,hardening,types-final,functions,reset2,http2}.log`; HTTP script `/private/tmp/bonded-be17-http.mjs`.
- Branch from origin/main6f8b851, no stacked source. BE-17 server-clock get_offer(p_kind), immutable shared24hour ledger, current-member premium check, read-only current-couple clocks. Winback first display local day3 since pairing (pairing day1), existing clock may cross midnight. Literal D28 timing interpretation documented for lead review. No entitlement grant/prices/content edits; no caller clock or clock-helper grants. Parent lock plus membership recheck; hardened search_path.
- Initial full DB run caught F12 search_path convention on get_offer; corrected in89930dc. Entire corrected suite/reset/HTTP rerun passes. CI41895893678 had app/functions/plan/sync green and DB jobs running before final docs checkpoint; do not treat pending CI as green. Public migration230000 is unmerged and was corrected in place.
- Commands: export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH; export SUPABASE_HOME=/private/tmp/bonded-cli-resume SUPABASE_TELEMETRY_DISABLED=1; node supabase/tests/offers.test.mjs; node supabase/tests/gen-types.mjs; npm --prefix supabase/tests test; npm --prefix supabase/tests run check:types; bash qa/ci/functions.sh; node supabase/scripts/build-seed.mjs --check; node scripts/plan/generate.mjs --check; node scripts/agents/sync.mjs --check; git diff --check.
- This run: #83 lead-requested main merge committed/pushed eede10f; all DB suites (onboarding37), types/functions/static pass; replied https://github.com/saeedarafa/bonded/pull/83#issuecomment-6639455855 . All seven current CI checks green41893112177; mergeable. BE-33 source unchanged, package retains dev-content/revenuecat/onboarding.
- #90 BE-34 b927f70 marked ready: scoped SEC-01 sign-off and all seven checks green41851696577. #91 BE-11 e7c98cb has focused security source sign-off, cosmetic migration EOF cleanup requested (not a security hold); full DB/types/functions/static pass, previous3d66344 CI seven green41890283890. #89/#96 security-owned; #89 lead requests only security status conflict fix, no backend request.
- Merge order must preserve 200000(#83)→210000(#90)→220000(#91)→230000(BE-17) on auto-deploy dev. Only lead merges main. BE-18/190000 already merged/deployed. Next backend BE-14.
- Isolated stack `/private/tmp/bonded-be11-stack`, project bonded_backend_be11 API58321/DB58322; now contains exact BE-17 branch migration/seed snapshot after reset. Never reset/stop shared bonded. No hosted writes; dev only nyqbrsqqalygydtwvybb; never production. Hooks `.githooks`; no secrets/AI attribution.

## Doing

- BE-17 offers implementation and verification, one branch/PR.

## Done

- Startup verification and PR comments first. BE-33 main integration pushed; BE-34 marked ready after security/green CI.
- BE-17 full DB, focused46/hardening91, generated types, real reset/HTTP and functions/static green; #97 ready with security sign-off and seven green CI41896464658. Startup focused offers46/type generation pass; full rerun underway.

## Next

- Finish startup rerun; #91 cosmetic cleanup/readiness; BE-14 next from latest origin/main.

## Blocked

- BE-11/#91 security sign-off received; cosmetic cleanup and refreshed CI next. Migration rollout order remains required.
- Hosted credentials/secrets/Vault/SMTP; BE-31 PO go; BE-22 approved milestone.

## Needs from

- Lead: #83 integrated eede10f and all seven CI green41893112177; #90 ready. Review #97 D28 timing and route scoped server premium/offer-clock review as needed. Preserve migration200000→210000→220000→230000.
- Security: #91 and #97 focused source sign-offs received; retain isolated runtime race evidence.
- Mobile/QA: BE-17 contract changed; get_offer server expiry and eligibility, no client writes or prices. BE-33 private onboarding on #83; BE-34 token expired name on #90; BE-11 saver on #91.
- PO: dev-only hosted credentials/secrets/Vault/SMTP.
