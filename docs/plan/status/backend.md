# Backend / data developer status

Updated: 2026-11-04 · Branch: `be/BE-18-revenuecat` · Task: BE-18

## Resume here

- Last AI/date: Codex · 2026-11-04. Worktree `/Users/saeedarafa/dev/bonded-be` only; branch `be/BE-18-revenuecat` at `9ef4d86` (cut-off WIP). Clean checkout switched from parked BE-30. Merged latest origin/main after #69 without rebase; preserved avatar and RevenueCat runbooks/tests/helper entries, regenerated types.
- Verified WIP before changes: RevenueCat SQL **30/30**, reveal **23/23**, hardening **91/91**; backend Deno **41/41**, lint/check pass. `bash qa/ci/functions.sh` reproduces only QA-owned `qa/functions/stubs_test.ts:92`: authenticated empty POST expects 200, implemented handler returns 400. Do not weaken validation or edit QA files. Initial full DB run interrupted intentionally for priority #75 fixes; rerun BE-18 full suite after grace fix.
- #69/#75 priority review completed first: #69 already addressed, merged by lead in `6c465cf` (dev migration deployment green). #75 source fixes `f06c51a`, cwd fixture fix `dab4e32`, main integration `b39bbe1`, final status `c5cacad` pushed on `be/BE-32-dev-content`. All 23 DB suites, Deno 32 + QA 9, app 42 suites/729 tests, real fresh isolated Supabase reset and contracts (281 passed, 1 expected failure, 7 todo) pass. Keep #75 draft pending SEC-07 re-review and green Actions after PO billing fix. No hosted writes.
- Isolated local stack `bonded_backend_review` remains running at `supabase/.temp/backend-review-stack` (ignored), API 56321, DB 56322, mail 56324. Never use plain stop/reset; always `--workdir supabase/.temp/backend-review-stack`. Refresh its copied migrations/seed for BE-18 before reset. Credentials captured in memory only. Shared `bonded` untouched.
- Exact next step: add regression for a subscriber whose paid period ended but RevenueCat grace is still active, fix snapshot expiry to include canonical grace, then run full backend checks and open draft BE-18 PR. Official source: https://www.revenuecat.com/docs/subscription-guidance/how-grace-periods-work and customer-info-model API schema. WIP currently ignores grace despite its contract claim.
- Commands: `node supabase/tests/revenuecat.test.mjs`; `npm --prefix supabase/tests test`; `SUPABASE_TELEMETRY_DISABLED=1 npm --prefix supabase/tests run check:types`; `bash qa/ci/functions.sh`; `deno fmt --check supabase/functions`; `npm run typecheck`; `node supabase/scripts/build-seed.mjs --check`; plan/sync checks.
- Hooks `.githooks`; fetch/push with `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' ...`. Commit/push each completed step, no attribution trailers. Never reset/stop shared stack, test production, rebase reviewed branches or merge main.
- Dev `nyqbrsqqalygydtwvybb`; production `nciyrepyphvksusoigzx`. Main migrations auto-deploy to dev. No hosted changes in this session. Hosted secrets/Vault/device acceptance remain unavailable; BE-18 source needs lead/security review.
- Prior work: BE-19/#64 merged; BE-20b/#69 integration checkpoint `4f4d4c3` on its own branch awaits lead. BE-32/#75 priority review fixes completed in this folder; see checkpoint above. BE-31 waits for PO go.
- Uncommitted work: none after this checkpoint; it records verification only.

## Doing

- BE-18: WIP verified, grace-period regression/fix next. QA fixture and review gates outstanding.

## Done

- BE-18 initial verification: SQL 30, reveal 23, hardening 91, backend Deno 41 pass; stale QA fixture reproduced.
- BE-19/#64, BE-30/#60, BE-29/#55, BE-10/#53, BE-26/#41 (via #54), BE-16/#35 merged.

## Next

- Complete BE-18 backend validation and draft PR handoff; BE-11 after BE-18 merges.
- #75 awaits SEC-07/Actions; QA-13 owned by QA after merge.

## Blocked

- BE-18 combined function job: QA-owned stale empty-body auth assertion; lead/security review and hosted rollout remain.
- Hosted functions/device acceptance need secrets/Vault; BE-27 hosted Auth GET needs management credential, templates need SMTP.

## Needs from

- Lead/security: BE-18 source review (service-only grants, atomic dedupe/transfer, subscriber refresh, premium push). Only lead merges.
- QA: `qa/functions/stubs_test.ts:92` should assert 400 + BAD_REQUEST for authenticated empty body, or send a valid TEST event and expect 200. No QA files edited. Run real reset/contract validation in approved isolation; never reset shared stack.
- Mobile: BE-18 contract changed; MOB-19 refetch entitlements after purchase/restore/foreground/premium push; no Realtime change.
- PO: fix Actions billing; configure dev RevenueCat/webhook/internal secrets and Vault for hosted acceptance; dev-only DB credential for BE-32. No production credentials.
