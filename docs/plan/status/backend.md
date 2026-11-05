# Backend / data developer status

Updated: 2026-11-05 · Branch: `be/BE-11-streak-context` · Task: BE-11 / #121 P2 follow-up

## Resume here

- New branch `be/BE-11-streak-context` from latest origin/main `65d014d`; implements lead's explicit P2 Needs from backend / #121. Separate task from BE-35 and premium wording. No pending PR source is included.
- Migration20261105180000 appends nullable enum `saver_reason` and int `previous_streak` to streak_state, updates private get_streak_at only; get_streak/use_streak_saver return new fields. Existing auth/grants/server clock/premium/quota/reveal behaviour preserved. No push/Realtime changes (optional lead suggestion).
- Previous streak = positive expired cached current run, null once current/protected/fresh; no permanent historic-run claim. Reasons describe unrepaired gap first (`too_many_missed`), quota for a repairable gap (`used_this_month`), otherwise null. Premium absence alone has no enum reason. CONTRACTS §2/changelog documents exact semantics.
- PR #123 open draft; original source d9cd2e0. Merged latest main2ea8a95 without rebase after #100 merged/deployed; preserved recap suite/allowlist/types and context source unchanged. Focused context28/saver46 and full pre-main DB29 scripts pass; types regenerated/current, seed/plan/sync/whitespace and app tsc pass. Initial tsc lacked installed RevenueCat dependency; npm ci --ignore-scripts restored dependencies, then tsc passed (no package/lock changes). New tests cover partner identity, outsider/current membership, auth/anon/private seam, retries/no writes, success shape, gap/quota precedence, local midnight/month rollover/DST and new-couple isolation.
- Isolated real reset passes on `bonded_be11_context`,603xx ports, scratch path in `/private/tmp/bonded-context-workdir.txt`. Contract run280 pass/1 expected fail/7todo and **one failure only**: QA `streak.test.ts:112` exact old six-key list rejects new previous_streak/saver_reason. Owner must update QA type/helper/key assertion and add HTTP context coverage in a companion; never edit qa/** here. Draft until consumer assertion + complete CI green. Logs `/private/tmp/bonded-context-{full-db,reset,contract}.log`. Isolated bonded_be11_context was stopped successfully; shared stack untouched.
- Exact next step: verify main-integration types/context/recap/helpers/static, push; ask QA via PR description/status for the #123 response-key companion, then require integrated green CI before readiness. Local backend implementation is complete; deploy migration20261105180000 after #100/240000 and #115/250000. No unmerged migration deployment. Lead selected #122 as merge vehicle; #100/240000 is now merged/deployed. #115 at5453c49 has source/types/contract byte-identical to #122/292b8ac; consent56/reveal23/types/static/full app899/real isolated reset/HTTP289 pass,1 expected fail,7todo. Final #122 CI gates lead merge/deploy250000. Keep #115 parked/draft. Combined isolated stack stopped.
- SEC-01 focused source review of #123 atd9cd2e0 found no new confirmed vulnerability; no reviewer runtime execution. Implementation unchanged by status-only commits; preserve green integrated CI and migration order.
- Previous branches pushed: #115 latest main integrated at0f6ee1a, consent56/reveal23/types/static pass; #120 latest main integrated at6f4b284. Original heads #1008fa27cf/#102ea05a51/#120e2d2fcf all seven green; #120 refreshed head6f4b284 has all seven checks green (run42057728128). No unanswered backend review requests in authored PR comments/reviews/inline.
- #115 remains draft for ready MOB-46 + mobile ack + QA-16 #119 and green integrated CI. QA-16 atadb2612 accepted/security reviewed, db-reset/DB/functions/static pass, app missing CONFIRM_ARCHIVE. MOB-46 #122 now ready atfba7a50; ack and focused security review present. Individual #122 reset still has old QA fixtures; integrate #119 as agreed. Relevant source changes need security re-review.
- Re-run: `git fetch`; `git status`; `git log -5 --oneline`; `git pull --ff-only`; `gh pr list --author @me`; `gh pr view <n> --comments`; `export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH SUPABASE_HOME=/private/tmp/bonded-cli-resume SUPABASE_TELEMETRY_DISABLED=1 XDG_CACHE_HOME=/private/tmp/bonded-gh-cache`; `node supabase/tests/streak-context.test.mjs`; `node supabase/tests/streak-saver.test.mjs`; `node supabase/tests/gen-types.mjs --check`; `node scripts/plan/generate.mjs --check`; `node scripts/agents/sync.mjs --check`; `git diff --check`.
- No hosted writes. Dev only nyqbrsqqalygydtwvybb; never prod. Shared QA stack untouched. Hooks .githooks; no secrets/AI attribution.

## Doing

- BE-11 / #121 P2 streak context: backend validation complete; draft #123 needs QA response-key/HTTP companion.

## Done

- Startup feedback/state/static verification; refreshed #115/#120 with main65d014d and pushed handoffs.

## Next

- QA companion for draft #123; ready BE-35 consumer integration; lead merges/deploys prior migration chain.

## Blocked

- #123 needs QA companion for the additive response fields and complete green CI. #115 needs final CI/lead merge after #100. #100/#102/#120 await lead merges. BE-31 needs PO go; BE-22 approved milestone; BE-13 after launch. Hosted Auth/device/function setup needs PO/QA; D28/partner ritual-time/J5 privacy decisions need lead.

## Needs from

- Lead: review BE-11 P2 semantics; deploy in migration order after #100/#115; merge ready #100/#102/#120.
- QA: #123 needs `qa/contract/streak.test.ts` Streak/helper/keys updated for nullable saver_reason/previous_streak and HTTP boundary coverage; local run has exactly the old key-list failure. Mobile may adopt fields after merge. #122 mobile ack is present for #115.
- Security: relevant BE-35 consumer changes need focused review.
