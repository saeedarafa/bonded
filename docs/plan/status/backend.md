# Backend / data developer status

Updated: 2026-11-03 · Branch: `be/BE-19-daily-reminders` · Task: BE-19 / PR #64 (M3)

## Resume here

- Worktree: `/Users/saeedarafa/dev/codex-backend/bonded` (current authorized backend worktree).
- Task: BE-19 daily reminders, branch from `origin/main` `b30573f`. Implementation added: service-only atomic `due_reminders(p_now)` + RLS ledger, quarter-hour cron, content-backed ritual/last-call delivery, SQL/Deno tests and contract/runbook. Focused SQL 29/29, hardening 91/91, reveal-rule 23/23 and Deno 6/6 pass after hardened search paths and one/type/local-day enforcement. Types generated successfully with telemetry disabled. PR #64: https://github.com/saeedarafa/bonded/pull/64 . Next: finish full verification and follow CI. Weekly recap stays BE-14.
- Review requests handled first: #55 main merged without rebase at `046468c`, pushed and replied to lead. Only status conflict; stored-body regression assertion retained. #60 BE-30 code accepted; all seven CI checks pass at `0bd4846`; focused independent security sign-off is now received. Waits on lead integration and QA-owned strict race assertions. Do not alter its reviewed code or merge main.
- Resume verification: app typecheck/lint/format pass; Jest 41 suites / 701 tests pass. Initial full DB run reached hardening and found the new reminder functions needed hardened search paths; fixed. Re-running focused/full checks. Types must run with `SUPABASE_TELEMETRY_DISABLED=1` because CLI telemetry writes outside the sandbox. #55 committed hardening assertion re-run from its exact source (temporary test file in this checkout): 91/91 pass. #55 at `046468c` is mergeable and all seven CI checks green (run 41672809042).
- Commands: `npm --prefix supabase/tests test`; `SUPABASE_TELEMETRY_DISABLED=1 npm --prefix supabase/tests run check:types`; `node supabase/scripts/build-seed.mjs --check`; `bash qa/ci/functions.sh`; `deno fmt --check supabase/functions`; `npm run typecheck`; `npm run lint`; `npm run format:check`; `npm test -- --runInBand`; `gh pr checks 55`; `gh pr view 60 --comments`.
- Tooling: Node 24 via `PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH`; hooks `.githooks`; git fetch/pull/push use `-c credential.helper= -c 'credential.helper=!gh auth git-credential'`. Never print secrets.
- No shared Supabase reset/stop; isolated PGlite only, real reset in CI. Never deploy to unidentified dev or production. Merged migrations immutable. Commit/push and refresh this handoff after every step.

## Doing

- BE-19/#64 implemented, final full verification running. Initial CI caught missing `due_reminders` in the public service-RPC allow-list; added it, preserving explicit anon/authenticated denial tests. Function suite passes (23 backend + 9 QA tests); README Deno format corrected. #55 ready for lead merge, #60 security source gate clear.

## Done

- BE-26/#41 via QA-10/#54; MOB-32/#56; D37/#58; BE-10/#53; History/#61 merged.
- BE-29/#55 non-vacuous answer UPDATE assertion implemented and mutation-proven; latest main merged at `046468c`.
- BE-30/#60 implementation complete, prior 19 DB suites green, race 56/56, join requests 58/58, reveal 23/23; all seven CI checks green.

## Next

- Finish BE-19, then next unblocked BE backlog task (BE-20b is M3/P1; BE-18 is M4/P0). One branch/PR per task, lead alone merges.

## Blocked

- BE-27 hosted parity, dev deployments and SEC-04 N4 validation: no unambiguous dev project. `nciyrepyphvksusoigzx` is labelled production; do not use it.

## Needs from

- Lead: #55 all seven checks green; merge when ready. #60 source security sign-off received; coordinate QA strict concurrency assertion. Review BE-19/#64 service-only scheduling and persistent claim behavior; dev deployment still blocked.
- PO: identify hosted dev project for Auth parity and deployment. Existing local Auth templates support confirmation URL + six-digit OTP, callback allow-list `bonded://auth/callback`.
- Mobile: BE-10 types now on main; nudge enablement is in #62. No BE-19 app change planned.
