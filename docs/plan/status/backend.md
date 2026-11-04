# Backend / data developer status

Updated: 2026-11-04 · Branch: `be/BE-11-streak-saver` · Task: BE-11 / D18

## Resume here

- Branch `be/BE-11-streak-saver`; implementation `edb3125`; integrated origin/main `6f8b851` in `07f86b1` (BE-18/#81 now merged). Kept both dev-content and saver tests when resolving package script conflict. One BE-11 PR #91; only lead merges.
- Exact next step: check fresh CI for pushed head; address focused security review requested by lead on #91, then mark ready with green CI. Migration220000 still follows pending #83/190000 and #90/210000. Do not merge main.
- Current verification: focused46 passed; entire DB suite passed before main integration; functions52 + QA10 passed; generated types current; seed/plan/sync/diff clean. Isolated real reset/seed and actual authenticated HTTP partner/saver/answer races passed corrected semantics: protection preserves current6, actual today adds to7, retry one claim, anon denied. Logs `/private/tmp/bonded-resume-{focused,db,functions,types,reset,http,content,integrated-db}.log`. Check integrated-db tail to confirm final run.
- GitHub initially failed DNS/TLS; fetch recovered. Open backend PRs #91, #90, #83; #89 belongs to security. #91 lead asks focused security (premium/server enforcement, shared monthly quota, free/replay denial) and green CI before ready. Review #90/#83 comments and resolve any outstanding integration request before another task.
- Corrected fixture: eleven restores to eleven, no synthetic completed day; real offline D17 completion counts once. SQL tests cover premium expiry/member scope, retries, local month, reveal and late completion. No secrets logged.
- Commands: export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH; export SUPABASE_HOME=/private/tmp/bonded-cli-resume SUPABASE_TELEMETRY_DISABLED=1; npm --prefix supabase/tests test; npm --prefix supabase/tests run check:types; bash qa/ci/functions.sh; node supabase/scripts/build-seed.mjs --check; node scripts/plan/generate.mjs --check; node scripts/agents/sync.mjs --check; git diff --check.
- Isolated stack `/private/tmp/bonded-be11-stack`, project bonded_backend_be11, API58321/DB58322. Never reset/stop shared bonded stack. HTTP script `/private/tmp/bonded-be11-http.mjs`; local state JSON stays private. CLI is supabase/tests/node_modules/.bin/supabase. Stop isolated only with --workdir and --no-backup.
- Next tasks BE-14 or BE-17 from latest origin/main, one branch/PR per task. Dev only nyqbrsqqalygydtwvybb; never production. Hooks .githooks. No uncommitted source work.

## Doing

- BE-11/D18 premium shared streak saver; one task branch/PR.

## Done

- Startup fetch/pull/status/log, backend skills, contracts/backlog/status review and open PR comments.
- BE-34 current CI green; handoff pushed before switching tasks.

## Next

- Final BE-11 fullDB/CI and static verification; mark #91 ready when green.
- Next unblocked BE-14 or BE-17 after this task.

## Blocked

- BE-34 focused security review and ordered dev migration rollout.
- #75 lead merge/QA-13 workflow and configuration; #80/#81 lead integration; #83 migration order.
- Hosted credentials/secrets/Vault/SMTP; BE-31 PO go; BE-22 approved milestone.

## Needs from

- Lead/security: review #90 token-gated expired name. Preserve migration order190000→200000→210000→220000. BE-11 depends on unmerged BE-18/#80/#81.
- Mobile/QA: contract changed BE-11: parameterless use_streak_saver returns streak_state; saver_available now enforces current-member premium, yesterday gap, shared local-month quota. Generated types available here; no reveal/answer writes. BE-34 additive `error.details.inviter_name`; BE-33 private onboarding answers ready on #83. BE-11 forthcoming.
- PO: dev-only hosted credentials/secrets/Vault/SMTP.
