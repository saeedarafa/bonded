# Backend / data developer status

Updated: 2026-11-04 · Branch: `be/BE-18-revenuecat` · Task: BE-18

## Resume here

- Last AI/date: Codex · 2026-11-04. Worktree `/Users/saeedarafa/dev/bonded-be` only; branch `be/BE-18-revenuecat` at `9ef4d86` (cut-off WIP). Clean checkout switched from parked BE-30. Origin main is `78490f0`, already an ancestor; no rebase needed.
- Verified WIP before changes: RevenueCat SQL **30/30**, reveal **23/23**, hardening **91/91**; backend Deno **41/41**, lint/check pass. `bash qa/ci/functions.sh` reproduces only QA-owned `qa/functions/stubs_test.ts:92`: authenticated empty POST expects 200, implemented handler returns 400. Do not weaken validation or edit QA files. Full DB suite is running; check `/tmp/bonded-be18-db.log`.
- Exact next step: add regression for a subscriber whose paid period ended but RevenueCat grace is still active, fix snapshot expiry to include canonical grace, then run full backend checks and open draft BE-18 PR. Official source: https://www.revenuecat.com/docs/subscription-guidance/how-grace-periods-work and customer-info-model API schema. WIP currently ignores grace despite its contract claim.
- Commands: `node supabase/tests/revenuecat.test.mjs`; `npm --prefix supabase/tests test`; `SUPABASE_TELEMETRY_DISABLED=1 npm --prefix supabase/tests run check:types`; `bash qa/ci/functions.sh`; `deno fmt --check supabase/functions`; `npm run typecheck`; `node supabase/scripts/build-seed.mjs --check`; plan/sync checks.
- Hooks `.githooks`; fetch/push with `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' ...`. Commit/push each completed step, no attribution trailers. Never reset/stop shared stack, test production, rebase reviewed branches or merge main.
- Dev `nyqbrsqqalygydtwvybb`; production `nciyrepyphvksusoigzx`. Main migrations auto-deploy to dev. No hosted changes in this session. Hosted secrets/Vault/device acceptance remain unavailable; BE-18 source needs lead/security review.
- Prior work: BE-19/#64 merged; BE-20b/#69 integration checkpoint `4f4d4c3` on its own branch awaits lead. BE-32/#75 in `/private/tmp/bonded-be32` / `be/BE-32-dev-content`: pending dev-only DB credential/count review fixes; do not switch this session to it. BE-31 waits for PO go.
- Uncommitted work: none after this checkpoint; it records verification only.

## Doing

- BE-18: WIP verified, grace-period regression/fix next. QA fixture and review gates outstanding.

## Done

- BE-18 initial verification: SQL 30, reveal 23, hardening 91, backend Deno 41 pass; stale QA fixture reproduced.
- BE-19/#64, BE-30/#60, BE-29/#55, BE-10/#53, BE-26/#41 (via #54), BE-16/#35 merged.

## Next

- Complete BE-18 backend validation and draft PR handoff; BE-11 after BE-18 merges.
- Separate BE-32/#75 follow-up: dev-only credential and CSV-derived counts; QA-13 after review.

## Blocked

- BE-18 combined function job: QA-owned stale empty-body auth assertion; lead/security review and hosted rollout remain.
- Hosted functions/device acceptance need secrets/Vault; BE-27 hosted Auth GET needs management credential, templates need SMTP.

## Needs from

- Lead/security: BE-18 source review (service-only grants, atomic dedupe/transfer, subscriber refresh, premium push). Only lead merges.
- QA: `qa/functions/stubs_test.ts:92` should assert 400 + BAD_REQUEST for authenticated empty body, or send a valid TEST event and expect 200. No QA files edited. Run real reset/contract validation in approved isolation; never reset shared stack.
- Mobile: BE-18 contract changed; MOB-19 refetch entitlements after purchase/restore/foreground/premium push; no Realtime change.
- PO: configure dev RevenueCat/webhook/internal secrets and Vault for hosted acceptance; dev-only DB credential for BE-32. No production credentials.
