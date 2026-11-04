# Backend / data developer status

Updated: 2026-11-04 · Branch: `be/BE-32-dev-content` · Task: #75 review

## Resume here

- Last AI/date: Codex · 2026-11-04. Work only in `/Users/saeedarafa/dev/bonded-be`; one branch per task. Integrating origin/main `78490f0` without rebase into #75. Conflicts only own status and tests/package.json; all main tests plus dev-content retained.
- Exact next step: address #75 review: replace Management API PAT with `SUPABASE_DEV_DB_URL` + guarded psql, validate dev connection identity before any process/network, derive expected catalogue counts from CSV, retain exact replay equality/no users. Run focused/full validation, push and reply; security review remains required before draft removal/merge.
- #69 review already addressed at `4f4d4c3`: all CI green (41713248011); avatar SQL and handler byte-identical to SEC-01 `26afa86`. Main after #64 already merged in `ca2c8cc`. No pending source fix, only lead merge/hosted acceptance.
- Return to `be/BE-18-revenuecat` after #75. WIP `9ef4d86` verified before edits; checkpoint `a1f73b2` pushed. RevenueCat SQL 30, reveal 23, hardening 91, Deno 41 pass. QA-owned empty webhook assertion at qa/functions/stubs_test.ts:92 fails (expects 200, correct response 400); do not edit QA. Full DB run interrupted intentionally in expensive 10,000-code invite case for this priority review; restart after return. Fix missing canonical grace-period expiry in BE-18 with regression, finish checks and open PR.
- Commands: `node supabase/tests/dev-content.test.mjs`; `npm --prefix supabase/tests test`; type/seed/plan/sync checks; `bash qa/ci/functions.sh`; app typecheck/lint/Jest. Hooks `.githooks`; git per-command credential helper via gh. Never switch branches with tests running. Never reset/stop shared QA stack.
- Dev only `nyqbrsqqalygydtwvybb`; production `nciyrepyphvksusoigzx` prohibited. No hosted calls/writes this session. PO secrets/Vault and dev DB credential still required for hosted acceptance. Only lead merges main. Commit/push each completed step; no AI attribution.
- Uncommitted work: none after integration checkpoint.

## Doing

- #75 credential/count review fixes, before resuming BE-18.

## Done

- #69 integrated and CI green; accepted avatar source unchanged.
- BE-18 WIP verification and stale QA assertion reproduced.
- BE-19/#64, BE-30/#60, BE-29/#55, BE-10/#53, BE-16/#35 merged.

## Next

- Finish #75 fixes/review handoff, then BE-18 regression/validation/PR. BE-11 after BE-18 merges.

## Blocked

- Hosted acceptance needs dev secrets/Vault/DB credential; #75 focused security review; BE-18 QA-owned stale fixture.
- BE-27 hosted Auth GET requires management credential; SMTP pending. BE-31 waits for PO go.

## Needs from

- Lead: #69 CI green, ready for merge; #75 focused security review after credential fixes; BE-18 review after PR.
- QA: update BE-18 empty POST fixture to 400 BAD_REQUEST or valid TEST event with 200; QA-13 after #75 review (workflow files remain untouched).
- Mobile: MOB-19 refetch entitlements on purchase/restore/foreground/premium push; no Realtime addition.
- PO: dev-only DB credential for #75 and dev function secrets/Vault for hosted acceptance.
