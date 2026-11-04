# Backend / data developer status

Updated: 2026-11-04 · Branch: `be/BE-14-weekly-recap` · Task: BE-14 / D21

## Resume here

- Exact next step: refresh PR #100 CI after this status checkpoint, mark ready when all seven checks pass, then take the next unblocked BE task from latest origin/main. BE-13 is the remaining decided P2 task (BACKLOG milestone `later`); BE-31 needs PO go and BE-22 needs approved milestone. PR: https://github.com/saeedarafa/bonded/pull/100 . Source: 0c61f28; test allowlist correction: 2348399. Uncommitted work: none (pushed).
- BE-14 full local verification passed: recap 55, reveal 23, hardening 91, error-codes 55, complete DB suite, generated types/check, functions 54 + QA 10, seed/plan/agent-sync/whitespace. Full DB log `/private/tmp/bonded-be14-db2.log`; functions `/private/tmp/bonded-be14-functions-final.log`. First full run caught the two new documented RPCs missing from the existing BE-24 public-definer allowlist; corrected, entire suite rerun green. Types CLI needs the SUPABASE_HOME below to avoid unwritable home telemetry.
- Isolated real reset/seed passed (`/private/tmp/bonded-be14-reset.log`). Authenticated HTTP free/premium, locked/outsider/anon/client-clock authorization, actual overlapping cron calls (one weekly claim per partner), retry and parent-lock unpair race passed. App waiting on unpair returns NOT_PAIRED; cron returns no ended-member claim. Fixture accounts/couples/questions cleaned. Script/log `/private/tmp/bonded-be14-http.{mjs,log}`.
- Branch from origin/main 6f8b851, no stacked source. Migration 240000: weekly_recap uses seven couple-local dates, real both-current-member daily answers (no saver/pack days), revealed pair-period-only aggregates. Free premium fields are null; current-member entitlement is checked at read time. Replies/reactions count events in the week on revealed questions, including old threads; most-loved counts all answer reaction kinds, ties by answer creation time then id. No text returned/logged. Sunday 18:00–18:15 couple-local push, recipient replies toggle/quiet hours/caps, private persistent user/week ledger. No new cron/secret/copy edits. Deploy migration before updated daily-reminder; not deployed here.
- Commands: export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH; export SUPABASE_HOME=/private/tmp/bonded-cli-resume SUPABASE_TELEMETRY_DISABLED=1; node supabase/tests/weekly-recap.test.mjs; npm --prefix supabase/tests test; npm --prefix supabase/tests run check:types; bash qa/ci/functions.sh; node supabase/scripts/build-seed.mjs --check; node scripts/plan/generate.mjs --check; node scripts/agents/sync.mjs --check; git diff --check.
- Review handoffs: #91 ready at 8237117 (cosmetic EOF only after security acceptance e7c98cb), latest seven green 41897645849, reply https://github.com/saeedarafa/bonded/pull/91#issuecomment-6640278964 . #97 ready at 2dee13c (status-only after security acceptance 17b6c47), latest seven green 41897432169, reply https://github.com/saeedarafa/bonded/pull/97#issuecomment-6640279544 . #83/#90 ready/green; no new backend requests. Security owns #89/#96/#98/#99.
- Preserve rollout order #83/200000 → #90/210000 → #91/220000 → #97/230000 → #100/240000. Only lead merges main; dev auto-deploys. Isolated stack `/private/tmp/bonded-be11-stack`, project bonded_backend_be11, API 58321 / DB 58322 now exact BE-14 reset snapshot. Never reset/stop shared bonded. Dev only nyqbrsqqalygydtwvybb; never production. Hooks .githooks; no secrets/AI attribution.

## Doing

- BE-14 PR #100 final CI gates and lead handoff.

## Done

- All open PR comments reviewed. BE-11 cosmetic request fixed/pushed and marked ready; BE-17 marked ready; both latest CI green with security acceptance.
- BE-14 source/types/contracts, full DB/functions/static checks, isolated reset and real authenticated HTTP concurrency/authorization checks pass. Fixtures cleaned.

## Next

- Mark #100 ready after current CI; next unblocked BE task from latest origin/main.

## Blocked

- Hosted dev credentials/secrets/Vault/SMTP/device delivery; BE-31 PO go; BE-22 approved milestone. No production writes.

## Needs from

- Lead: merge #83/#90/#91/#97 in order, then review #100 D21 semantics/Sunday couple-local scheduling and route focused premium/reveal/push-claim security review. Confirm #97 D28 local day-three interpretation. Only lead merges main.
- Mobile/QA: #100 contract changed additively; weekly_recap returns free days-only with null premium fields, current-member premium details and revealed pair-period counts. Sunday deep link uses existing recap route. #91 saver and #97 offers ready for lead integration.
- PO: dev-only hosted credentials/secrets/Vault/SMTP and device acceptance.
