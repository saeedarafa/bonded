# Backend / data developer status

Updated: 2026-11-04 · Branch: `be/BE-18-revenuecat` · Task: BE-18

## Resume here

- Last session: 2026-11-04, worktree `/Users/saeedarafa/dev/codex-backend/bonded`, branch `be/BE-18-revenuecat` at `16f08ca` before this status checkpoint. Pulled origin --ff-only; clean on entry. No product changes this session.
- Review priority checked #75/#80/#83 comments and inline reviews. **#75 marked ready**: SEC-07 source sign-off at `c5cacad`, all seven CI jobs green (41830450898). QA-13 workflow/security and hosted credential acceptance remain separate.
- **#80 source signed off** by SEC-08 at `16f08ca`. **#81 is the lead-designated merge vehicle** (not a request to copy QA files into #80); companion source signed off, CI 41834008885 green. Only lead merges; fresh combined CI required on integration. #80 retains its known old QA assertion failure; backend source needs no change.
- **#83 ready** on `be/BE-33-onboarding-answers`, latest current CI 41837637886 all seven green. Preserve migration order #80/190000 before #83/200000; no backend source review requests.
- Exact next step: **continue BE-34 in `/private/tmp/bonded-be34`**, branch `be/BE-34-expired-invite`, implementation `1e1dafe`, draft PR #90 https://github.com/saeedarafa/bonded/pull/90. Fresh from origin/main90264eb; pending migration210000 follows #80/190000 and #83/200000. Focused26/reveal23/hardening91/link45/avatar37/race56/types/seed/plan/sync pass; full DB and isolated reset/HTTP smoke running there. Use its own Resume here, not this parked BE-18 checkout. Security review required before merge.
- Startup verification **completed** here: all23 DB suites passed; generated types/seed/plan/sync, Deno formatting, app typecheck/lint/format pass; app44 suites/771 tests pass. Backend Deno52 passed; QA8 pass/1 known stale authenticated-empty-body assertion (fixed in #81, not copied here). Logs `/private/tmp/bonded-loop-{db,types,functions,fmt,ts,lint,format,app}.log`. No tests running in this checkout. Do not rerun expensive verification for these status-only changes.
- Commands: `npm --prefix supabase/tests test`; `SUPABASE_TELEMETRY_DISABLED=1 npm --prefix supabase/tests run check:types`; `bash qa/ci/functions.sh`; `deno fmt --check supabase/functions`; `npm run typecheck`; `npm run lint`; `npm run format:check`; `npm test -- --runInBand`; `node supabase/scripts/build-seed.mjs --check`; `node scripts/plan/generate.mjs --check`; `node scripts/agents/sync.mjs --check`.
- Node24 PATH `/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin`; hooks `.githooks`; gh git credential helper for push. Temporary BE-32 worktree `/private/tmp/bonded-be32` is stale at c03ad8d; pull --ff-only if needed. Current source is origin branch c5cacad.
- No hosted calls/writes. Dev only `nyqbrsqqalygydtwvybb`; never prod `nciyrepyphvksusoigzx`. Do not reset/stop shared stack; isolated backend stack only. Hosted function secrets/Vault, Auth GET credentials/SMTP still unavailable; BE-31 awaits PO go. Uncommitted work: none after this checkpoint.

## Doing

- BE-18 / #80: verified and source signed off; lead integrates via #81. Active work is BE-34/#90 in `/private/tmp/bonded-be34`.

## Done

- Verified cut-off WIP before edits; reproduced/fixed billing grace and added regressions.
- BE-18 full DB/backend Deno/app checks and real reset/contracts pass; QA stale fixture isolated; draft #80 opened and handed off.
- #69 review requests verified, merged by lead. #75 review requests fixed/pushed/replied; local checks green.

## Next

- BE-34/#90 final verification/security review; BE-18/#81 and BE-33/#83 await lead integration. BE-11 can follow or branch from #80 explicitly.
- #75 ready with source sign-off + green CI; QA-13 workflow remains QA-owned. BE-31 awaits PO go.

## Blocked

- BE-18: lead integrates QA companion #81 with fresh combined CI; source security signed off. Hosted rollout pending.
- #75 ready, SEC-07 signed off and CI green; waits lead merge, QA-13 workflow and hosted acceptance.
- Hosted functions need secrets/Vault; BE-27 hosted Auth GET credential / SMTP acceptance remains separate.

## Needs from

- QA: fix `qa/functions/stubs_test.ts:92` as above; no QA files edited. Existing real contracts pass in isolation.
- Lead/security: review BE-18 service-only grants, canonical refresh, ledger/dedupe/transfer/premium push. #75 needs SEC-07 re-review of psql credential/process boundary. Only lead merges main.
- Mobile: BE-18 contract changed; MOB-19 refetch entitlements after purchase/restore/foreground/premium push. No Realtime addition.
- PO: configure dev RevenueCat REST/webhook/internal secrets + Vault and dev-only DB credential for #75. No production credentials.
