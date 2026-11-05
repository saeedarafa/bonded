# Backend / data developer status

Updated: 2026-11-05 · Branch: `be/BE-35-archive-consent` · Task: BE-35 integration

## Resume here

- Current branch `be/BE-35-archive-consent`, draft PR #115. Clean startup at6eecd40; fetch/status/log/pull ff-only and all five authored open PR comments/reviews/inline inspected. Lead accepts BE-35 approach, requests MOB-46 + QA-16 companion integration. No backend feature request remains.
- Integrated origin/main `581783b` after #97 merged (`586424e`, migration230000 deployed to dev per lead). Retained every main DB suite plus consent, both RPC allowlists, all CONTRACTS descriptions/log entries and generated types. Migration250000/consent implementation unchanged. No unmerged #100 source included;250000 must follow240000.
- Verification: startup exact pre-integration tree passed consent56, full DB28 suites, types/functions52+QA10 and seed/plan/sync/whitespace. Logs `/private/tmp/bonded-loop-{consent,db,types,functions}.log`. Integrated consent56/offers46/reveal23/helpers74/hardening91/types/current check and seed/plan/sync/whitespace pass; logs `/private/tmp/bonded-integrate115-*.log`. Reviewed consent migration/tests/functions unchanged.
- Review-requested #100 main integration `8fa27cf` pushed: preserved offers/recap suites/allowlists/contracts/types; recap55/offers46/reveal23/helpers74/types/functions54+QA10/static pass. Reviewed migration240000/tests/daily-reminder unchanged. Refreshed CI pending. Lead applies240000 before updated daily-reminder on dev.
- Review-requested #102 main integration `ea05a51` pushed; only status conflicted. Auth4/static pass, report unchanged; only report/status differ from main. Ready under lead docs acceptance once CI green. Partial Auth evidence: Site URL/subjects differ, bodies/SMTP/native parity unverified; PO owns settings. Review replies posted on #100/#102.
- Exact next step: check refreshed #100/#102 CI and fix backend failures; inspect #115 MOB-46/QA-16 companion feedback, ack and relevant source deltas for security review. Keep #115 draft until integrated CI green. Do not edit mobile/QA consumer files. If main advances, integrate without rebase, preserving every suite/allowlist/contract/type. No other unblocked backend implementation remains.
- Consent contract: `accept_invite(p_code,p_token?,p_archive_own=false)` requires true for a valid solo join; `CONFIRM_ARCHIVE` otherwise. Private RLS ledger binds typed approval to exact solo couple; legacy/replacement-space approval requires requester reconfirmation, never inferred from inviter approval. Old public overload removed; private core denied to all API roles.
- Focused security source re-review complete through ba98aad, merged via #103; no new confirmed vulnerability established, reviewer did not execute runtime tests. Relevant consumer/source changes need re-review. Existing isolated reset/HTTP evidence `/private/tmp/bonded-be35-{reset-exact,http}.log`: omitted/false/null refusals, confirmed/unconfirmed race, private archive, stale approval/reconfirmation and anon denial; fixtures cleaned. Shared QA stack untouched.
- Prior #115 CI at5be2d78: full DB/functions/static pass; actual reset succeeds then QA271 pass/10 fail solely CONFIRM_ARCHIVE (1 expected fail,7todo); app only missing errors.CONFIRM_ARCHIVE. MOB-46 maps error, sends true only from D37 sheet and acks; QA-16 adopts intended solo token joins and adds refusal coverage. See `/private/tmp/bonded-loop-ci-failed.log`.
- Commands: export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH; export SUPABASE_HOME=/private/tmp/bonded-cli-resume SUPABASE_TELEMETRY_DISABLED=1 XDG_CACHE_HOME=/private/tmp/bonded-gh-cache; node supabase/tests/archive-consent.test.mjs; npm --prefix supabase/tests test; node supabase/tests/gen-types.mjs --check; bash qa/ci/functions.sh; node supabase/scripts/build-seed.mjs --check; node scripts/plan/generate.mjs --check; node scripts/agents/sync.mjs --check; git diff --check; gh pr checks 100; gh pr checks 102; gh pr checks 115. For status-only deltas, inspect existing evidence instead of repeating full local suites.
- No hosted writes. Dev only nyqbrsqqalygydtwvybb; no prod. Shared stack never reset/stopped. Hooks .githooks; no secrets/AI attribution. Uncommitted none after commit/push.

## Doing

- #100/#102 requested integrations pushed, awaiting refreshed CI. #115 main refresh and consumer handoff.

## Done

- Full startup rerun passed; all authored open PR feedback checked. #97 merged/deployed (lead confirmation).
- #100 and #102 post-#97 review conflicts resolved without changing reviewed feature sources.

## Next

- Green #100/#102, MOB-46/QA-16 integrated adoption, then lead merges/deploys240000 →250000.

## Blocked

- #115 needs mobile sheet-only consent/error map/ack + QA contract adoption and green integrated CI. #100 awaits lead merge/dev deploy; #102 lead docs merge. BE-31 needs PO go; BE-22 approved milestone; BE-13 after launch. Hosted Auth/device/function configuration evidence needs PO/QA. D28 local-day3 interpretation needs lead confirmation.

## Needs from

- Mobile: MOB-46 ack BE-35; pass true only from D37 confirm; map CONFIRM_ARCHIVE including stale pending approvals.
- QA: QA-16 solo token-join consent fixtures and refusal coverage.
- Security: re-review relevant implementation/consumer changes; backend reviewed sources unchanged by main integration.
- Lead: green #100 merge/dev240000 before daily-reminder; #102 docs merge; BE-35 companion integration/deploy250000 after240000; D28 and partner ritual-time/J5 preview privacy decisions.
