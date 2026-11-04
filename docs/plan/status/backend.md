# Backend / data developer status

Updated: 2026-11-04 · Branch: `be/BE-14-weekly-recap` · Task: BE-14 / D21

## Resume here

- Exact next step: finish full BE-14 DB/functions rerun /private/tmp/bonded-be14-db2.log, then refresh draft PR CI; mark ready only after all gates pass. Isolated real reset/seed and authenticated HTTP premium/privacy, simultaneous cron claims and parent-lock unpair race pass; dummy accounts/content cleaned. Implementation below passes focused55, reveal23, hardening91, error-codes55, Deno54+QA10, types/check and seed/plan/sync/whitespace. First full run caught BE-24 public-definer allowlist missing the two new documented RPCs; fixed in private-helpers.test.mjs, full rerun db2 running. Reset /private/tmp/bonded-be14-reset.log passed. HTTP script/log /private/tmp/bonded-be14-http.{mjs,log}. Branch created from latest origin/main6f8b851; no stacked source. Not deployed. Implementation0c61f28 migration240000, generated types and CONTRACTS; follow-up allowlist/real-HTTP evidence checkpoint.
- Uncommitted work: none at checkpoint; all source pushed. Decisions: seven couple-local dates from p_week_start, days = daily questions actually answered by both current members, no saver-only days; only revealed pair-period data can contribute. Free returns days only (premium fields null); paid aggregation never returns text. Sunday18:00 couple-local push uses replies toggle and recipient quiet hours/caps; persistent weekly claim, no retries after uncertain send.
- Review work complete: #97 ready; security source accepted17b6c47, seven green41896464658, status-only2dee13c refresh pending. #91 source accepted e7c98cb, cosmetic EOF fix8237117, focused saver46 and all seven CI41897645849 pass; marked ready. #97 status head2dee13c all seven CI41897432169 pass. #83/#90 already ready/green; no further backend requests. #89/#96/#98/#99 security-owned.
- Startup reran all BE-17 handoff commands: focused offers46, full DB suite, generated types/check, functions52+QA10, seed/plan/sync/whitespace pass. Logs /private/tmp/bonded-resume-{offers,db,types,types-check,functions}.log. BE-11 cosmetic check /private/tmp/bonded-be11-review-cleanup.log.
- Commands: export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH; export SUPABASE_HOME=/private/tmp/bonded-cli-resume SUPABASE_TELEMETRY_DISABLED=1; npm --prefix supabase/tests test; node supabase/tests/gen-types.mjs; npm --prefix supabase/tests run check:types; bash qa/ci/functions.sh; node supabase/scripts/build-seed.mjs --check; node scripts/plan/generate.mjs --check; node scripts/agents/sync.mjs --check; git diff --check.
- Isolated stack /private/tmp/bonded-be11-stack, project bonded_backend_be11 API58321/DB58322 currently BE-17 snapshot. Never reset/stop shared bonded. Dev only nyqbrsqqalygydtwvybb; never production. Hooks .githooks; no secrets/AI attribution.
- Migration rollout order: #83/200000 → #90/210000 → #91/220000 → #97/230000 → BE-14/240000. Only lead merges main; dev auto-deploy.

## Doing

- BE-14 source, focused and real Postgres/HTTP checks complete; full rerun and PR CI remain.

## Done

- Startup verification; all open PR comments read. BE-17/BE-11 ready with security acceptance and latest green CI. BE-14 focused55, reveal23, hardening91, functions54+QA10, types/static pass.

## Next

- Finish BE-14 full rerun and PR gates. #91/#97 ready, latest CI green.

## Blocked

- Hosted credentials/secrets/Vault/SMTP; BE-31 PO go; BE-22 approved milestone.

## Needs from

- Lead: merge accepted #83/#90, then #91/#97 after current green gates. Confirm #97 D28 local day3 interpretation. Keep migration order above.
- Mobile/QA: BE-14 in progress; premium fields server-gated, revealed pair-period aggregates only. #97 get_offer and #91 saver awaiting lead integration.
- PO: dev-only hosted credentials/secrets/Vault/SMTP.
