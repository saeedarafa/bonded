# Backend / data developer status

Updated: 2026-11-04 · Branch: `be/BE-14-weekly-recap` · Task: BE-14 / D21

## Resume here

- Exact next step: implement BE-14 weekly_recap(p_week_start) plus Sunday push in new migration240000 and daily-reminder, then DB/Deno/grants/reveal tests, types, isolated real reset/HTTP, full checks and one PR. Branch created from latest origin/main6f8b851; no stacked source. Not deployed.
- Uncommitted work: none at checkpoint. Decisions: seven couple-local dates from p_week_start, days = daily questions actually answered by both current members, no saver-only days; only revealed pair-period data can contribute. Free returns days only (premium fields null); paid aggregation never returns text. Sunday18:00 couple-local push uses replies toggle and recipient quiet hours/caps; persistent weekly claim, no retries after uncertain send.
- Review work complete: #97 ready; security source accepted17b6c47, seven green41896464658, status-only2dee13c refresh pending. #91 source accepted e7c98cb, cosmetic EOF fix8237117 pushed, focused saver46 pass; refresh CI then mark ready. #83/#90 already ready/green; no further backend requests. #89/#96/#98/#99 security-owned.
- Startup reran all BE-17 handoff commands: focused offers46, full DB suite, generated types/check, functions52+QA10, seed/plan/sync/whitespace pass. Logs /private/tmp/bonded-resume-{offers,db,types,types-check,functions}.log. BE-11 cosmetic check /private/tmp/bonded-be11-review-cleanup.log.
- Commands: export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH; export SUPABASE_HOME=/private/tmp/bonded-cli-resume SUPABASE_TELEMETRY_DISABLED=1; npm --prefix supabase/tests test; node supabase/tests/gen-types.mjs; npm --prefix supabase/tests run check:types; bash qa/ci/functions.sh; node supabase/scripts/build-seed.mjs --check; node scripts/plan/generate.mjs --check; node scripts/agents/sync.mjs --check; git diff --check.
- Isolated stack /private/tmp/bonded-be11-stack, project bonded_backend_be11 API58321/DB58322 currently BE-17 snapshot. Never reset/stop shared bonded. Dev only nyqbrsqqalygydtwvybb; never production. Hooks .githooks; no secrets/AI attribution.
- Migration rollout order: #83/200000 → #90/210000 → #91/220000 → #97/230000 → BE-14/240000. Only lead merges main; dev auto-deploy.

## Doing

- BE-14 recap RPC, premium boundary and Sunday push.

## Done

- Startup verification; all open PR comments read. BE-17 ready/security accepted; BE-11 cosmetic review request fixed and pushed.

## Next

- Finish BE-14 and PR; monitor #91/#97 refreshed CI.

## Blocked

- Hosted credentials/secrets/Vault/SMTP; BE-31 PO go; BE-22 approved milestone.

## Needs from

- Lead: merge accepted #83/#90, then #91/#97 after current green gates. Confirm #97 D28 local day3 interpretation. Keep migration order above.
- Mobile/QA: BE-14 in progress; premium fields server-gated, revealed pair-period aggregates only. #97 get_offer and #91 saver awaiting lead integration.
- PO: dev-only hosted credentials/secrets/Vault/SMTP.
