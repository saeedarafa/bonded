# Backend / data developer status

Updated: 2026-11-04 · Branch: `be/BE-32-dev-content` · Task: #75 review

## Resume here

- Last AI/date: Codex · 2026-11-04. Work only in `/Users/saeedarafa/dev/bonded-be`; one branch per task. Integrated origin/main after #69 (`4e7885f`) without rebase; prior integration `c283bab`, source fix `f06c51a`, cwd test fix `dab4e32`. Conflicts only own status and tests/package.json; all main tests plus dev-content retained.
- #75 review fixes implemented in `f06c51a`, CLI cwd regression corrected in `dab4e32`, latest-main/#69 integration `b39bbe1` without rebase. All **23 DB suites pass** including avatar 37, reveal 23, hardening 91 and content-only replay/CSV counts. Backend Deno **32 + QA 9** pass; type/seed/plan/sync/diff checks pass. App **42 suites/729 tests**, typecheck/lint/format pass (no app delta in latest integration). No Management PAT path; actual dev host/user/port/database validated before psql; TLS verify-full; minimal env, credential off argv, SQL on stdin, fixed errors. Runbook updated.
- Independent real local Supabase stack prepared at `supabase/.temp/backend-review-stack` (ignored), project `bonded_backend_review`, API 56321, DB 56322, mail 56324. Fresh reset succeeded; QA contract typecheck passes, suite running (`/tmp/bonded-be75-contract.log`). Shared `bonded` stack untouched. Never use plain `supabase stop/reset`; always `--workdir supabase/.temp/backend-review-stack`. Credentials captured in memory only; startup/status output not printed.
- Exact next step: collect QA contract results, finish #75 review handoff, return to BE-18. Actions billing prevents remote CI jobs from starting; SEC-07 review pending. Keep draft until security and CI gates pass. Stop only isolated stack when this session completes; after switching to BE-18 refresh its copied migrations/seed and reset this separate stack before its contracts.
- #69 review already addressed at `4f4d4c3`: all CI green (41713248011); avatar SQL and handler byte-identical to SEC-01 `26afa86`. Main after #64 already merged in `ca2c8cc`. Lead merged #69 in `6c465cf`; dev migration deployment confirmed by lead. Hosted TTL/cache/device acceptance remains.
- Return to `be/BE-18-revenuecat` after #75. WIP `9ef4d86` verified before edits; checkpoint `a1f73b2` pushed. RevenueCat SQL 30, reveal 23, hardening 91, Deno 41 pass. QA-owned empty webhook assertion at qa/functions/stubs_test.ts:92 fails (expects 200, correct response 400); do not edit QA. Full DB run interrupted intentionally in expensive 10,000-code invite case for this priority review; restart after return. Fix missing canonical grace-period expiry in BE-18 with regression, finish checks and open PR.
- Commands: `node supabase/tests/dev-content.test.mjs`; `npm --prefix supabase/tests test`; type/seed/plan/sync checks; `bash qa/ci/functions.sh`; app typecheck/lint/Jest. Hooks `.githooks`; git per-command credential helper via gh. Never switch branches with tests running. Never reset/stop shared QA stack.
- Dev only `nyqbrsqqalygydtwvybb`; production `nciyrepyphvksusoigzx` prohibited. No hosted calls/writes this session. PO secrets/Vault and dev DB credential still required for hosted acceptance. Only lead merges main. Commit/push each completed step; no AI attribution.
- Uncommitted work: none after integration checkpoint.

## Doing

- #75 review fixes and all 23 DB suites green; isolated real contract validation running before BE-18.

## Done

- #69 merged by lead; dev migration deploy green, accepted avatar source unchanged.
- #75 dev-only psql credential and CSV-count fixes; full DB/Deno/app verification green; real reset green.
- BE-18 WIP verification and stale QA assertion reproduced.
- BE-19/#64, BE-30/#60, BE-29/#55, BE-10/#53, BE-16/#35 merged.

## Next

- Finish #75 fixes/review handoff, then BE-18 regression/validation/PR. BE-11 after BE-18 merges.

## Blocked

- Hosted acceptance needs dev secrets/Vault/DB credential; #75 focused security review and Actions billing; BE-18 QA-owned stale fixture.
- BE-27 hosted Auth GET requires management credential; SMTP pending. BE-31 waits for PO go.

## Needs from

- Lead/security: #75 focused review of credential/process boundary and green CI after PO billing fix; BE-18 review after PR.
- QA: update BE-18 empty POST fixture to 400 BAD_REQUEST or valid TEST event with 200; QA-13 after #75 review (workflow files remain untouched).
- Mobile: MOB-19 refetch entitlements on purchase/restore/foreground/premium push; no Realtime addition.
- PO: dev-only DB credential for #75 and dev function secrets/Vault for hosted acceptance.
