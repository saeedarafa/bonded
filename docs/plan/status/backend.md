# Backend / data developer status

Updated: 2026-11-05 · Branch: `be/BE-18-server-premium-contract` · Task: BE-18/MOB-19 contract alignment

## Resume here

- Current branch `be/BE-18-server-premium-contract`, PR #120; source commit839c024 from latest origin/main `650f3b9`. Lead requested §6 alignment on merged #118 and main's Needs from backend. This PR changes CONTRACTS §2/§6 plus this status only; no runtime/schema/types change.
- Contract now matches merged MOB-19: server entitlement rows for self/current partner, active and unexpired (null = lifetime); former partner excluded; SDK customer info triggers refetch; purchase/restore awaits server confirmation. App checks expiry at fetch, foreground/reconnect refresh; DB enforces exact server-clock boundary. Existing webhook semantics unchanged.
- Source checked against premium api/model/hooks, purchase tests and #118 lead acceptance. Plan/agent-sync/whitespace checks pass; no new test for prose-only correction. #118 had all seven CI checks green and 886 Jest tests per lead.
- Startup authored PR comments/reviews/inline checked for #100/#102/#113/#115/#116. #100 at8fa27cf and #102 atea05a51 remain seven green and await lead merge. No new backend review request there.
- #115 main650f3b9 integration pushed in2a5d63b + status1920a9b, no conflicts; consent migration/tests/functions unchanged. Local consent56/reveal23/generated types/current/static passed; logs `/private/tmp/bonded-resume-{consent,reveal,types}.log`. Initial types invocation lacked scratch SUPABASE_HOME and failed telemetry write; rerun with the command below passed. No shared stack or hosted writes.
- Exact next step: check this contract PR's feedback/CI, then #100/#102 merge status and #115 consumers. Keep #115 draft until MOB-46 sheet-only flag/error handling + mobile ack, QA-16 companion and complete integrated CI. QA-16 companion #119 opened at1c20084: reviewed explicit optional helper flag, six omitted/false/null typed/token refusals with unchanged-state assertions and positive retry/unpaired coverage. QA reports isolated289 pass/1 expected fail/7todo; CI pending. MOB-46 branch absent. #100/#102 remain mergeable. Never integrate unfinished companion branches or edit consumer files. If main moves, integrate without rebase and preserve all suites/allowlists/contracts/types. Migration order240000 (#100) →250000 (#115).
- Re-run: `git fetch`; `git status`; `git log -5 --oneline`; `git pull --ff-only`; `gh pr list --author @me`; `gh pr view <n> --comments`; `gh pr checks 100`; `gh pr checks 102`; `gh pr checks 115`; `export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH SUPABASE_HOME=/private/tmp/bonded-cli-resume SUPABASE_TELEMETRY_DISABLED=1 XDG_CACHE_HOME=/private/tmp/bonded-gh-cache`; `node scripts/plan/generate.mjs --check`; `node scripts/agents/sync.mjs --check`; `git diff --check`.
- BE-35 security source review holds throughba98aad; reviewed implementation unchanged by main integration. Relevant consumer/source deltas need re-review. Existing isolated HTTP/race/reset evidence is in #115 and its branch status. Dev only nyqbrsqqalygydtwvybb, never prod; shared QA stack untouched. Hooks .githooks; no secrets/AI attribution. Uncommitted none after push.

## Doing

- BE-18/MOB-19 contract wording requested by lead, separate docs PR from latest main.
- BE-35 backend complete; consumer integration pending on draft #115.

## Done

- #100/#102 requested integrations pushed and seven checks green.
- #115 main650f3b9 integration; consent56/reveal23/types/static green.

## Next

- Lead merges contract correction and green #100/#102; MOB-46/QA-16 integration then lead deploy250000 after240000.

## Blocked

- #115 needs mobile consent/error adoption + ack, QA-16 and green integrated CI. #100/#102 await lead merges. BE-31 needs PO go, BE-22 approved milestone, BE-13 after launch. Hosted Auth/device/function configuration evidence needs PO/QA. D28 local-day3 interpretation needs lead confirmation. No other unblocked BE backlog task.

## Needs from

- Lead: review §6 correction; merge/deploy #100 (240000 before updated daily-reminder), merge #102 docs; BE-35 companion integration250000 after240000; D28/partner ritual-time/J5 privacy decisions.
- Mobile: MOB-46 ack and sheet-only `p_archive_own:true`; `CONFIRM_ARCHIVE` handling including stale pending approvals.
- QA: QA-16 solo consent fixtures/refusal coverage.
- Security: re-review relevant consumer/source changes before #115 integration.
