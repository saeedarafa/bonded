# Backend / data developer status

Updated: 2026-11-03 · Branch: `be/BE-18-revenuecat` · Task: BE-18 draft + BE-32 review follow-up

## Resume here

- Worktree `/Users/saeedarafa/dev/codex-backend/bonded`. Node 24: `PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH`; hooks `.githooks`. Fetch/push with `-c credential.helper= -c 'credential.helper=!gh auth git-credential'`. Never switch branches while local test commands run; never reset/stop QA's shared stack.
- BE-19/#64 merged in `a55b32d`; CI 7/7 at `610e436` (41711377428).
- BE-20b/#69 merged main without rebase in `ca2c8cc`, checkpoint `4f4d4c3`, pushed. Four integration conflicts resolved retaining both runbooks, all avatar/race/reminder tests and service helper entries. Avatar SQL/handler byte-identical to accepted + SEC-01 `26afa86`. All 22 local DB suites pass (avatar 37, reveal 23, race 56, reminder 31, hardening 91); Deno 32+9, app 42 suites/729 tests, types/seed/typecheck/lint/format/plan/sync pass. Latest CI 41713248011; lead merges on green. Bounded avatar leases are not immediate revocation; hosted TTL/cache behavior unverified.
- BE-18 starts from latest origin/main `78490f0`. Atomic service-only webhook application + private event metadata ledger; equal/older timestamp and event-ID dedupe; transfer users update together; whole-couple premium transition dispatches once through BE-08. Client entitlement writes revoked. Every supported premium event refreshes canonical RevenueCat subscriber data (REST key needed), so expiry/deferred changes/overlapping products do not incorrectly revoke/grant. Anonymous IDs ignored; fixed/redacted errors; no hosted calls. Premium push uses content copy and Packs URL. Types and §2–§6 contracts updated.
- BE-18 validation: 30 new SQL assertions, reveal 23, error catalogue 73 and helper 74 passed; final hardening rerun after matching required hardened search_path in progress at checkpoint preparation. Backend Deno rerun in progress (prior 40 passed). **QA-owned `qa/functions/stubs_test.ts:92` is stale:** authenticated empty POST expects 200; implemented endpoint correctly returns 400. Do not weaken validation or edit QA files. Ask QA to assert 400 + BAD_REQUEST or send an authenticated TEST event. Keep BE-18 draft pending that fix, fresh full CI/reset, lead/security review and hosted rollout.
- **Exact next step:** checkpoint/push BE-18 draft PR, then prioritize new #75 review requests. BE-32 lives in temporary worktree `/private/tmp/bonded-be32`, branch `be/BE-32-dev-content` (draft #75, old code `6e611a1`, checkpoint `c03ad8d`). Pull --ff-only. Replace account-wide Management API PAT with dev-only `SUPABASE_DEV_DB_URL` + pg/psql, enforcing ref/connection identity before network; update runbook. Derive expected question/pack/badge counts from CSV rather than 153/6/15. Preserve exact replay equality and zero users. Lead accepted approach but requires credential change + focused security review before out-of-draft; QA-13 wires workflow afterward. Do not edit workflows or PO content. See #72/#75 comments.
- Dev is `nyqbrsqqalygydtwvybb`, production is `nciyrepyphvksusoigzx` (never use for testing). Main auto-deploys dev migrations. BE-18 migration 190000 must merge after #69's 180000. PO authorized dev link/push/deploy/test, but function/Vault secrets and hosted Auth config credential remain unavailable. No hosted writes performed. BE-31 still waits for PO go.
- Commands: `node supabase/tests/revenuecat.test.mjs`; `node supabase/tests/rls.test.mjs`; `node supabase/tests/error-codes.test.mjs`; `node supabase/tests/private-helpers.test.mjs`; `node supabase/tests/hardening.test.mjs`; `SUPABASE_TELEMETRY_DISABLED=1 npm --prefix supabase/tests run check:types`; `bash qa/ci/functions.sh` (known QA fixture failure above); `deno fmt --check supabase/functions`; `npm run typecheck`; `node supabase/scripts/build-seed.mjs --check`; plan/sync checks. Full local DB and app already green on #69; status-only changes do not need expensive reruns.
- Uncommitted work: BE-18 implementation awaiting checkpoint commit when this note was prepared. No secrets in files. Temporary draft/validation files in `/private/tmp/bonded-be18-*` are superseded by tracked code here; remove after saving.

## Doing

- BE-18 draft; QA auth fixture and review gates outstanding.
- BE-32/#75 review requests are next priority.
- #69 integrated and awaiting lead merge on green CI.

## Done

- BE-19/#64, BE-30/#60, BE-29/#55, BE-10/#53, BE-26/#41 (via #54), BE-16/#35 merged.

## Next

- BE-32 credential/count review fixes; BE-18 CI and QA handoff; BE-11 after BE-18 merges.

## Blocked

- BE-27 hosted Auth GET requires accessible management credential; templates wait for SMTP.
- Hosted functions/device acceptance need secrets/Vault configuration.
- BE-18 full CI needs QA's stale empty-body auth assertion updated; merge order follows #69.

## Needs from

- Lead/security: BE-18 source review (service-only write/grants, event/timestamp dedupe, subscriber refresh and transactional premium push); #75 focused review after dev-only credential switch.
- QA: update `qa/functions/stubs_test.ts:92` for BE-18; QA-13 deployment wiring after #75 leaves draft. Reminder overlap/retry/device acceptance after deployment.
- Mobile: contract changed BE-18; MOB-19 refetch entitlements after purchase/restore/foreground/premium push. No Realtime table added. MOB-35 consumes #69 Edge preview for token links with SQL/initial fallback; never log/persist tokens or signed URLs.
- PO: configure dev function secrets/Vault and dev-only DB credential in the bonded-dev GitHub environment; no production credentials.
