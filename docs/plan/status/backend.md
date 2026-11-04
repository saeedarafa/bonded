# Backend / data developer status

Updated: 2026-11-04 · Branch: `be/BE-18-revenuecat` · Task: BE-18

## Resume here

- Last AI/date: Codex · 2026-11-04. Work only in `/Users/saeedarafa/dev/bonded-be`, branch `be/BE-18-revenuecat`. Verified cut-off WIP `9ef4d86` before editing; verification checkpoint `a1f73b2`; latest-main/#69 integration without rebase `14ff706`; grace fix `7d553a5`. Verification checkpoint `7278a2d`; PR **#80** https://github.com/saeedarafa/bonded/pull/80 opened as draft. Latest main `1387ce1` integrated without rebase after opening (lead status only; no product delta or new tests required).
- Review update 2026-11-04: #75 lead requests are satisfied; current CI **green**, run 41830450898; keep draft for SEC-07 re-review. #80 lead accepts approach; security + QA companion remain. Actions billing blocker resolved (repo public); no new backend source request. Merged current main without rebase before parking #80. Next unblocked task is **BE-33 (D38, M2/P0)** on a fresh branch from main, not BE-11 while BE-18 is unmerged.
- Exact next step: park #80 for QA companion/source security review and current CI, then build BE-33 in this folder; local implementation/verification and PR handoff complete. Implementation complete; keep draft pending QA-owned stale auth fixture, source security review and green remote CI after PO fixes Actions billing. Only lead merges. Do not edit QA files or deploy an unreviewed migration.
- BE-18: authenticated bounded webhook, canonical RevenueCat premium refresh for all supported fixtures, atomic service-only event ledger/dedupe/timestamp ordering/transfer, client entitlement-write revoke, one whole-couple premium-transition dispatch through BE-08 copy/caps. Fixed a reproduced WIP bug: paid expiry ignored active grace. Effective expiry now includes canonical entitlement/subscription grace; exact boundary/renewal/lifetime/malformed-grace regressions pass. Types/contracts/runbook current; no answer/message/receipt data logged.
- Full verification on final source: **all 23 DB suites pass**, including RevenueCat **30**, reveal **23**, hardening **91**, avatar **37**, race **56**, reminders **31**. Backend Deno **52/52**, lint/check/format pass. QA Deno **8 pass / 1 failure** at `qa/functions/stubs_test.ts:92`: stale authenticated empty POST expects 200, real handler correctly returns **400 BAD_REQUEST**. This is the only failing local check; do not weaken validation. QA should assert 400 + BAD_REQUEST or send a valid TEST event and expect 200.
- App **42 suites/729 tests**, typecheck/lint/format pass. Generated types, seed, plan and agent sync/diff checks pass. Fresh **real Supabase migration reset** and QA contracts/typecheck pass on a separate local stack: **10 files / 281 pass, 1 expected failure, 7 todo; 1 file skipped**. Extra real Postgres smoke verifies service-only grants, duplicate/older events, transfer and couple premium; fixtures rolled back. Logs `/tmp/bonded-be18-{db,functions,app,contract}.log`.
- Isolated stack `bonded_backend_review` was created under ignored `supabase/.temp/backend-review-stack`, ports API 56321 / DB 56322 / mail 56324, and **stopped with --no-backup** after checks. Startup output removed. Shared `bonded` stack untouched. Never run plain `supabase reset/stop` here (root config identifies the shared stack). For a repeat, refresh copied migrations/seed, then use explicit `--workdir supabase/.temp/backend-review-stack` for every stack command; capture local keys in memory, never print them.
- Priorities completed first: **#69** source/integration requests already addressed at `4f4d4c3`, CI 41713248011 green; lead merged in `6c465cf` and confirmed dev migration deployment. **#75** review fixes pushed on `be/BE-32-dev-content`: dev-only psql credential + CSV-derived counts `f06c51a`, cwd fixture fix `dab4e32`, main integration `b39bbe1`, final checkpoint `c5cacad`. All 23 DB suites, Deno 32 + QA 9, app 729, fresh reset/contracts 281 pass on that branch. PR updated/replied; keep draft for SEC-07 re-review and remote CI. Do not copy BE-32 into BE-18. QA-13 starts after its merge.
- Commands: `npm --prefix supabase/tests test`; `SUPABASE_TELEMETRY_DISABLED=1 npm --prefix supabase/tests run check:types`; `bash qa/ci/functions.sh` (known QA assertion above); `deno fmt --check supabase/functions`; `npm run typecheck`; `npm run lint`; `npm run format:check`; `npm test -- --runInBand`; `node supabase/scripts/build-seed.mjs --check`; `node scripts/plan/generate.mjs --check`; `node scripts/agents/sync.mjs --check`.
- Dev only `nyqbrsqqalygydtwvybb`; never production `nciyrepyphvksusoigzx`. No hosted calls/deployments/writes this session. BE-18 hosted rollout waits for reviewed main migration, REST/webhook/internal function secrets + Vault and sandbox/device acceptance. Hooks `.githooks`; git per-command gh credential helper. Commit/push each step; no AI attribution. Uncommitted work: none after checkpoint.

## Doing

- BE-18 / #80: implementation complete, verified and pushed; draft PR and QA/lead/security handoff posted.

## Done

- Verified cut-off WIP before edits; reproduced/fixed billing grace and added regressions.
- BE-18 full DB/backend Deno/app checks and real reset/contracts pass; QA stale fixture isolated; draft #80 opened and handed off.
- #69 review requests verified, merged by lead. #75 review requests fixed/pushed/replied; local checks green.

## Next

- BE-18 QA companion, security/lead review, remote CI after billing fix, then approved dev rollout/sandbox acceptance. BE-11 after BE-18 merges.
- #75 SEC-07 review + CI; QA-13 workflow remains QA-owned. BE-31 awaits PO go.

## Blocked

- BE-18 combined function job: QA-owned stale empty-body assertion; source security review and hosted rollout pending.
- #75 remains draft for SEC-07 re-review; CI run 41830450898 is green. Actions is available again.
- Hosted functions need secrets/Vault; BE-27 hosted Auth GET credential / SMTP acceptance remains separate.

## Needs from

- QA: fix `qa/functions/stubs_test.ts:92` as above; no QA files edited. Existing real contracts pass in isolation.
- Lead/security: review BE-18 service-only grants, canonical refresh, ledger/dedupe/transfer/premium push. #75 needs SEC-07 re-review of psql credential/process boundary. Only lead merges main.
- Mobile: BE-18 contract changed; MOB-19 refetch entitlements after purchase/restore/foreground/premium push. No Realtime addition.
- PO: configure dev RevenueCat REST/webhook/internal secrets + Vault and dev-only DB credential for #75. No production credentials.
