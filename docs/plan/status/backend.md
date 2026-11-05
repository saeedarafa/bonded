# Backend / data developer status

Updated: 2026-11-05 · Branch: `be/BE-11-streak-context` · Task: BE-11 / #121 P2 follow-up

## Resume here

- New branch `be/BE-11-streak-context` from latest origin/main `65d014d`; implements lead's explicit P2 Needs from backend / #121. Separate task from BE-35 and premium wording. No pending PR source is included.
- Migration20261105180000 appends nullable enum `saver_reason` and int `previous_streak` to streak_state, updates private get_streak_at only; get_streak/use_streak_saver return new fields. Existing auth/grants/server clock/premium/quota/reveal behaviour preserved. No push/Realtime changes (optional lead suggestion).
- Previous streak = positive expired cached current run, null once current/protected/fresh; no permanent historic-run claim. Reasons describe unrepaired gap first (`too_many_missed`), quota for a repairable gap (`used_this_month`), otherwise null. Premium absence alone has no enum reason. CONTRACTS §2/changelog documents exact semantics.
- Focused context28 pass; existing saver46 pass; types regenerated. New tests cover partner identity, outsider/current membership, auth/anon/private seam, retries/no writes, success shape, gap/quota precedence, local midnight/month rollover/DST and new-couple isolation.
- Exact next step: rerun new context suite after longest-vs-current fixture improvement; run full DB suite + generated-types check + app typecheck + static/seed checks; commit/push and open one BE-11 PR. Real reset/contracts/functions CI must be green. Deploy only after earlier queued migrations #100/240000 and #115/250000; only lead merges. No dev deployment of unmerged migration.
- Previous branches pushed: #115 latest main integrated at0f6ee1a, consent56/reveal23/types/static pass; #120 latest main integrated at6f4b284. Original heads #1008fa27cf/#102ea05a51/#120e2d2fcf all seven green; #120 refreshed CI pending. No unanswered backend review requests in authored PR comments/reviews/inline.
- #115 remains draft for ready MOB-46 + mobile ack + QA-16 #119 and green integrated CI. QA-16 atadb2612 accepted/security reviewed, db-reset/DB/functions/static pass, app missing CONFIRM_ARCHIVE. MOB-46 at7c36d21 has WIP source/tests but no ready PR/ack; never integrate unfinished consumers. Relevant source changes need security re-review.
- Re-run: `git fetch`; `git status`; `git log -5 --oneline`; `git pull --ff-only` after upstream is set; `gh pr list --author @me`; `gh pr view <n> --comments`; `export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH SUPABASE_HOME=/private/tmp/bonded-cli-resume SUPABASE_TELEMETRY_DISABLED=1 XDG_CACHE_HOME=/private/tmp/bonded-gh-cache`; `node supabase/tests/streak-context.test.mjs`; `node supabase/tests/streak-saver.test.mjs`; `node supabase/tests/gen-types.mjs --check`; `node scripts/plan/generate.mjs --check`; `node scripts/agents/sync.mjs --check`; `git diff --check`.
- No hosted writes. Dev only nyqbrsqqalygydtwvybb; never prod. Shared QA stack untouched. Hooks .githooks; no secrets/AI attribution.

## Doing

- BE-11 / #121 P2 streak context: implementation and focused coverage ready, validation in progress.

## Done

- Startup feedback/state/static verification; refreshed #115/#120 with main65d014d and pushed handoffs.

## Next

- Finish and open BE-11 context PR; ready BE-35 consumer integration; lead merges/deploys prior migration chain.

## Blocked

- #115 needs ready MOB-46 + ack, QA-16 and green integrated CI. #100/#102/#120 await lead merges. BE-31 needs PO go; BE-22 approved milestone; BE-13 after launch. Hosted Auth/device/function setup needs PO/QA; D28/partner ritual-time/J5 privacy decisions need lead.

## Needs from

- Lead: review BE-11 P2 semantics; deploy in migration order after #100/#115; merge ready #100/#102/#120.
- Mobile/QA: additive streak fields available in this branch; adopt after merge. MOB-46 readiness/ack remains gate for #115.
- Security: relevant BE-35 consumer changes need focused review.
