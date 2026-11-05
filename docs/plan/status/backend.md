# Backend / data developer status

Updated: 2026-11-04 · Branch: `be/BE-33-onboarding-answers` · Task: BE-33 / D38 / PR #83

## Resume here

- Exact next step: push the validated merge of origin/main `6f8b851` into #83 requested by lead. Package script retains dev-content, revenuecat and onboarding suites. Product implementation `28c44ed` unchanged. Full DB suite (including onboarding37), types/functions/seed/plan/skill-sync/whitespace all passed; refresh CI and reply on #83 after push. Only lead merges main.
- Branch pulled ff-only, clean before merge. Conflict resolution affects own status and test script only. Logs `/private/tmp/bonded-be33-integrated-{db,types,functions}.log`.
- BE-33: owner-only onboarding answer table/upsert; partner/anon denied, retry idempotent, two versions coexist, account cascade; generated types and CONTRACTS ready. Prior focused37/reveal23, real reset/contracts281 + actual SDK privacy/retry/cascade smoke passed. Main integration adds RevenueCat and dev-content tests.
- Other branches: #90 BE-34 `b927f70` marked ready this run: scoped SEC-01 sign-off and all seven checks green (41851696577). #91 BE-11 `e7c98cb`: full DB/types/functions/static passed this run, prior head3d66344 CI seven green (41890283890), still draft pending focused security. Startup logs `/private/tmp/bonded-loop2-{db,functions,types}.log`.
- Migration order #83/200000 → #90/210000 → #91/220000; BE-18/190000 already merged via #81 and deployed dev. Do not renumber reviewed source without review. Next unblocked task BE-14 or BE-17, from latest origin/main, one branch/PR per task.
- Commands: export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH; export SUPABASE_HOME=/private/tmp/bonded-cli-resume SUPABASE_TELEMETRY_DISABLED=1; npm --prefix supabase/tests test; npm --prefix supabase/tests run check:types; bash qa/ci/functions.sh; node supabase/scripts/build-seed.mjs --check; node scripts/plan/generate.mjs --check; node scripts/agents/sync.mjs --check; git diff --check.
- Never reset/stop shared stack. Isolated BE-11 stack `/private/tmp/bonded-be11-stack`, API58321/DB58322. No hosted calls/writes this session; dev only nyqbrsqqalygydtwvybb; never production. Hooks `.githooks`; no secrets or AI attribution.

## Doing

- BE-33/#83: resolve lead-requested main integration and verify.

## Done

- Startup fetch/pull/status/log, backend skills and role references, current PR comments/CI and full BE-11 handoff verification.
- BE-34/#90 source gate cleared and marked ready.

## Next

- Push #83 integration; obtain green CI, then lead merges. Next BE-14 or BE-17.

## Blocked

- BE-11/#91 focused security sign-off pending.
- Hosted credentials/secrets/Vault/SMTP acceptance; BE-31 PO go; BE-22 approved milestone.

## Needs from

- Lead: #83 accepted source integrated with main; preserve migration200000→210000→220000. #90 ready.
- Security: focused BE-11 premium/current-member checks, shared monthly quota and replay/free denial on #91.
- Mobile/QA: BE-33 private onboarding sync contract/types on #83; original timestamp on retry/new version row. BE-34 additive token-gated expired first name on #90. BE-11 saver contract/types on #91.
- PO: dev-only hosted credentials/secrets/Vault/SMTP.
