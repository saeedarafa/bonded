# Backend / data developer status

Updated: 2026-11-05 · Branch: `be/BE-17-server-time` · Task: BE-17 server time (#124 follow-up)

## Resume here

- Current branch `be/BE-17-server-time` from latest `origin/main` 0808e30. Implements lead P2 request under Needs from / #124: additive `get_offer.server_now`, same transaction timestamp used for eligibility on every successful response. Private eligibility/ledger logic unchanged. Migration20261105190000; public wrapper retains auth check and existing ACLs, sets search_path=public. CONTRACTS §2/changelog updated. Generated types regenerated with no diff (return remains Json).
- Offers61 tests pass (including timestamp/response shape, eligible/solo/unsupported/premium responses, retry expiry); functions lint/check/tests pass (52 backend +10 QA). Full PGlite DB suite and isolated real reset still running at implementation checkpoint; inspect logs below. No hosted writes; shared QA stack untouched.
- Exact next step: finish full DB and isolated reset/contracts, check types/plan/sync/whitespace, open one BE-17 PR against main and record CI. Then inspect #123 QA companion and lead docs merges. No other unblocked BE row beyond this follow-up: BE-31 needs PO go; BE-22 milestone approval; BE-13 after launch.
- Logs: `/private/tmp/bonded-offer-time-db.log`, `bonded-offer-time-functions.log`, `bonded-offer-time-reset.log`. Isolated workdir pointer `/private/tmp/bonded-offer-time-workdir.txt`, project `bonded_be17_time`, ports613xx. Start log contains local credentials: do not print. Stop only that isolated project when done.
- Prior branch `be/BE-11-streak-context` pushed9589151, draft #123. CI42062183828 app/DB/functions/static pass; real reset succeeds, HTTP288 pass/1 fail solely at `qa/contract/streak.test.ts:112` exact-six-key assertion. QA owns companion response-key/type/helper/HTTP context coverage. No companion yet; keep draft. Focused security review at d9cd2e0 still applies; backend migration/tests unchanged. Prior context28/saver46/reveal23/helpers74/recap55 pass.
- #102/#115/#120 all required CI checks green at354c599/ce79317/6ea75a3; existing review requests addressed, awaiting lead merge. #115 is status-only after #122 carried BE-35+QA-16 (250000 deployed to bonded-dev per lead). #100/240000 merged/deployed. No new review requests on backend PRs this session.
- Commands to re-run: `git fetch`; `git status`; `git log -5 --oneline`; `git pull --ff-only`; `gh pr list --author @me`; `gh pr view 124 --comments`; `gh pr checks 123`; `export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH SUPABASE_HOME=/private/tmp/bonded-cli-resume SUPABASE_TELEMETRY_DISABLED=1 XDG_CACHE_HOME=/private/tmp/bonded-gh-cache`; `node supabase/tests/offers.test.mjs`; `node supabase/tests/gen-types.mjs --check`; `node scripts/plan/generate.mjs --check`; `node scripts/agents/sync.mjs --check`; `git diff --check`.
- Dev only `nyqbrsqqalygydtwvybb`; never prod. Hooks `.githooks`; no AI attribution.

## Doing

- BE-17 additive server-time response implemented; integration validation and PR next.

## Done

- #123 final CI failure isolated to QA response shape; app CI now green. #102/#115/#120 refreshed CI all green. BE-35 merged/deployed via #122.

## Next

- Finish BE-17 follow-up PR; then QA/mobile adoption for #123 and lead docs merges.

## Blocked

- #123 needs QA companion and green integration. BE-31 PO go; BE-22 milestone approval; BE-13 after launch. Hosted Auth/device setup PO/QA-owned. D28/partner ritual-time/J5 privacy decisions need lead.

## Needs from

- Lead: review BE-17 server_now follow-up; merge #102/#120 when ready, #115 status-only closeout. Review #123 with QA companion when green.
- Mobile/QA: additive get_offer.server_now for countdowns: remaining = max(0, expires_at - server_now), then subtract monotonic elapsed time; refresh on resume. Consumer types/helper/HTTP adoption remains owned by mobile/QA.
- QA: #123 exact-key assertion needs nullable saver_reason/previous_streak and HTTP boundary coverage. Premium app CI now passes.
