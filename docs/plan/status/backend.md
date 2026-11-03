# Backend / data developer status

Updated: 2026-11-03 · Branch: `be/BE-20b-invite-avatar` · Task: BE-20b (M3/P1)

## Resume here

- Current task: **BE-20b** on `be/BE-20b-invite-avatar`, based on origin/main `299eb75`, independent of #60/#64. New migration 180000 (merge after lower pending migration numbers). Edge token-only minimal preview, canonical private avatar signing ≤60 seconds, expiry bounded, no cache/logging, initials on missing avatar/sign failure. SQL typed-code preview unchanged. Focused tests: **36 DB + 9 Deno pass**; full verification next, then own PR/security review. No hosted deployment.
- Last session: Codex, 2026-11-03. Authorized worktree `/Users/saeedarafa/dev/codex-backend/bonded`.
- BE-30/#60: merged origin/main `299eb75` without rebase in `4ddd3d3` as lead requested. Only conflicts: backend status, CONTRACTS change-log rows (both retained), test command (approval-race + nudge both retained). Regenerated public types to include main’s `send_nudge`. Approval SQL unchanged. Branch is mergeable; independent SEC-04 source sign-off received at `0bd4846`.
- Verification at merged code head: **19 DB suites pass**, approval race **56/56**, reveal **23/23**, hardening **91/91**, nudge **30/30**, join requests **58/58**. Types/seed fresh; Deno **17 backend + 9 QA tests**, lint/check/format pass. App typecheck/lint/format, **41 suites / 706 tests**, plan and agent sync pass. Fresh CI run **41696007560**: app/functions/plan/sync pass; db-tests/db-reset pending at checkpoint. Shared Supabase stack untouched; real reset/contracts run in CI.
- Exact next step: finish BE-20b full verification/types and open its own PR with security review request. Check #60 fresh CI and lead merge. #64 BE-19 must merge **after #60** (migration 160000 before 170000, dev enforces migration order); after #60 lands, merge origin/main into #64 without rebase, resolve only integration conflicts, regenerate types and re-run full CI. #64 lead accepted code; independent security review still required. Next M4/P0 is BE-18. Never merge main or change another owner’s files.
- BE-19/#64 branch `be/BE-19-daily-reminders`, implementation `8b00bc6`, checkpoint `9e9cabc`; prior seven CI checks green (41674219439). Service-only atomic `due_reminders`, RLS reminder log, 15-minute Vault/pg_net cron, ritual/22:30 last-call reminders, shared recipient lock/caps and persistent retry claims. 20 DB suites, 31 reminder checks, 23 backend + 9 QA Deno checks passed on that branch. Unknown send outcomes retain claims; no duplicate retries. Weekly recap is BE-14.
- Dev: lead identified **bonded-dev `nyqbrsqqalygydtwvybb`**, confirmed by CLI projects list. Main auto-deploys migrations there; production integration disconnected. BE-27 allows Auth config **GET only**. No management token in environment/plaintext fallback or the attempted native CLI keychain entries; CLI projects list itself works. Read-only Auth config retrieval remains unverified. No hosted writes performed. Function deployment/secrets still need PO setup, per lead.
- Dev reminder rollout after merge: deploy `daily-reminder` to the explicit dev ref; configure function `INTERNAL_FUNCTION_SECRET`, Vault `functions_url` + matching `internal_function_secret` per `supabase/functions/README.md` on #64. Cron safely no-ops until configured. Never print secrets; never use production `nciyrepyphvksusoigzx`.
- Commands: `npm --prefix supabase/tests ci`; `npm --prefix supabase/tests test`; `SUPABASE_TELEMETRY_DISABLED=1 npm --prefix supabase/tests run check:types`; `node supabase/scripts/build-seed.mjs --check`; `bash qa/ci/functions.sh`; `deno fmt --check supabase/functions`; `npm run typecheck`; `npm run lint`; `npm run format:check`; `npm test -- --runInBand`; `gh pr checks 60`; `gh pr checks 64`.
- Tooling: Node 24 `PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH`; hooks `.githooks`. Git fetch/pull/push: `-c credential.helper= -c 'credential.helper=!gh auth git-credential'`. CLI always `SUPABASE_TELEMETRY_DISABLED=1` (avoids sandboxed telemetry writes). Isolated PGlite only; never reset/stop QA’s shared stack. Commit/push after every step and refresh this handoff.
- Uncommitted work: none after checkpoint commit/push.

## Doing

- BE-30/#60 merged-main verification complete; fresh CI and lead integration pending.
- BE-19/#64 complete; waiting for #60 migration order and security/lead review.

## Done

- BE-29/#55, BE-10/#53, History/#61 and nudge UI/#62 merged.
- BE-26/#41 via QA-10/#54; MOB-32/#56; D37/#58 merged.
- #60 latest review integration request addressed without SQL changes.

## Next

- Finish BE-20b verification/review; then BE-18 (M4/P0). Review comments first; one branch/PR per task.

## Blocked

- BE-27 Auth parity GET: dev identified, management credential retrieval not verified. Function deployment/secrets need PO configuration.
- #64 integration waits for #60 merge, then fresh main merge and CI; security source verdict still required.

## Needs from

- Lead: merge #60 once merged-head CI passes; then #63, then #64 after backend integrates main. No backend SQL change requested.
- Security: #64 service scheduling/grants, Vault secret, persistent claims and shared push-cap review.
- QA: tighten #60 real-stack concurrent loser to `JOIN_REQUEST_EXPIRED`, expired request and unchanged failures; backend never edits QA files. Add reminder retry/concurrency acceptance.
- PO/lead: configure dev deployment secrets/Vault. Auth templates wait for SMTP (prod before release); dev uses local mail or admin-generated test codes per ACCOUNTS 16.
- Mobile/QA/security: **contract changed (BE-20b)**: opt into `functions.invoke('invite-preview', {body:{p_code,p_token}})` for token links only. Same four preview fields; signed avatar ≤60s, initial fallback. SQL preview stays null-avatar. Security review required before merge. #64 payloads keep existing channels/`bonded://today`.
