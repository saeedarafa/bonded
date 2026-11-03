# Backend / data developer status

Updated: 2026-11-03 · Branch: `be/BE-30-approval-race` · Task: BE-30/#60 review integration

## Resume here

- Current session: merging origin/main `299eb75` into reviewed #60 without rebase as lead requested. Resolved CONTRACTS by retaining both rows; retained both approval-race and nudge suites in test command; regenerated public types for main’s nudge API. No approval SQL changes. Full verification pending. Next push #60 and reply with evidence, then start independent BE-20b from latest origin/main. #64 must follow #60 merge (160000 before 170000); merge main into #64 afterward and re-run CI.
- Dev update from lead review #64: GitHub auto-deploys main migrations to **bonded-dev `nyqbrsqqalygydtwvybb`**; production disconnected. Hosted reminders need `daily-reminder` deployment and Vault `functions_url` + `internal_function_secret`; runbook documents steps. Never print secrets or use production. Deployment credentials/configuration not yet verified.

- Last session: Codex, 2026-11-03. Authorized worktree `/Users/saeedarafa/dev/codex-backend/bonded`.
- Current task: **BE-19 / PR #64**, https://github.com/saeedarafa/bonded/pull/64 . Branch from `origin/main` `b30573f`; implementation `8b00bc6`. This checkpoint records verification only. All implementation, generated types, tests, CONTRACTS and runbook committed/pushed; no uncommitted work after checkpoint.
- Exact next step: fetch, check open backend PR reviews (#55, #60, #64) and address any comments first. #64 is mergeable and **all seven CI checks pass at `8b00bc6`**, run https://github.com/saeedarafa/bonded/actions/runs/41674219439 (real Supabase reset/QA contracts, DB tests, functions, app, plan, sync). Wait only for lead/security review; do independent work: **BE-20b** is the next unstarted M3/P1 task (valid-token-only short-lived signed inviter avatar URL; private bucket; needs contract + security review). Use a new branch from latest origin/main and its own PR. BE-18 is the next M4/P0 task. Never merge main, rebase reviewed PRs or change other owners' files.
- BE-19: service-only atomic `due_reminders(p_now)` plus RLS `reminder_log`, quarter-hour Vault/pg_net cron dispatcher, ritual reminders and last call at 22:30 couple-local for live streaks ≥3. Shared recipient lock/cap, quiet hours/preferences, persistent retry claims; no answer/message text read or logged. Correct scheduled question day across midnight; one/type/recipient-local-day; DST repeated hour deduped, missing wall time skipped. Body cannot forge clock. Weekly recap remains BE-14. Unknown send outcomes keep claims (possible lost reminder, no duplicate retry).
- Verification: **20 backend suites pass**, reminders **31/31**, hardening **91/91**, reveal-rule **23/23**, nudge **30/30**, join requests **58/58**. Generated types and seed fresh. Deno **23 backend + 9 QA tests**, Deno format, app typecheck/lint/format and plan/agent-sync pass. Resume app suite: **41 suites / 701 tests** pass; final implementation also passes CI app checks. Initial missing RPC allow-list and hardened search-path failures fixed; final suite has zero failures.
- Reviews addressed first: **#55** merged main without rebase in `046468c`, pushed/replied; all seven CI checks pass (run 41672809042). Exact committed stored-body assertion re-run locally using a temporary test file: 91/91. **#60** code accepted and all seven CI checks pass at `0bd4846`; focused independent SEC-04 source sign-off received. QA still owns strict real-stack concurrency assertions. Both await lead integration; no new backend change requested.
- Commands: `npm --prefix supabase/tests ci`; `npm --prefix supabase/tests test`; `SUPABASE_TELEMETRY_DISABLED=1 npm --prefix supabase/tests run check:types`; `node supabase/scripts/build-seed.mjs --check`; `bash qa/ci/functions.sh`; `deno fmt --check supabase/functions`; `npm run typecheck`; `npm run lint`; `npm run format:check`; `npm test -- --runInBand`; `gh pr checks 64`.
- Tooling: Node 24 via `PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH`; hooks `.githooks`. Git fetch/pull/push use `-c credential.helper= -c 'credential.helper=!gh auth git-credential'`. CLI types need `SUPABASE_TELEMETRY_DISABLED=1` to avoid a telemetry write outside sandbox. Never print secrets.
- Shared QA Supabase stack untouched. Isolated PGlite locally; real reset in CI. No hosted deployment: dev project is unidentified. Never use production-labelled `nciyrepyphvksusoigzx`. Merged migrations immutable. Commit/push and refresh this handoff after every step.

## Doing

- BE-19/#64 complete and CI green; ready for lead/security review. Awaiting dev project identity for deployment/device smoke test.
- BE-29/#55 CI green, ready for lead merge; BE-30/#60 source security gate clear, QA/lead integration remains.

## Done

- BE-19 implementation and deterministic SQL/Deno regressions; all seven CI checks green.
- BE-26/#41 via QA-10/#54; MOB-32/#56; D37/#58; BE-10/#53; History/#61 and nudge UI/#62 merged.
- BE-29/#55 stored-body UPDATE regression is mutation-proven; latest requested main merge pushed.
- BE-30/#60 implementation complete, race 56/56 and prior 19 DB suites green; all seven CI checks green.

## Next

- Review comments first, then BE-20b (M3/P1), followed by next unblocked backlog task. One branch/PR per task, lead alone merges.

## Blocked

- BE-27 hosted Auth parity and SEC-04 N4 validation: dev identity now known from lead; credentials/provider/template parity not yet verified. No hosted access/writes performed.

## Needs from

- Lead/security: review BE-19/#64 service-only scheduling/grants and persistent claims. All seven checks pass. Lead: merge #55 when ready; #60 source sign-off received, coordinate QA strict concurrency assertion.
- QA: real-stack reminder retry/concurrency acceptance coverage; #60 strict concurrent loser requires `JOIN_REQUEST_EXPIRED`, expired request and unchanged failures. Backend never edits QA files.
- PO: identify hosted dev project for Auth parity/deployment. Local Auth templates already support confirmation URL + six-digit OTP and callback allow-list `bonded://auth/callback`.
- Mobile: ritual/last-call payloads follow existing `channelId`/`data.type` and `bonded://today`; no app change needed. Weekly recap remains BE-14.
