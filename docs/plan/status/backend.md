# Backend / data developer status

Updated: 2026-11-03 · Branch: `be/BE-19-daily-reminders` · Task: BE-19 (M3)

## Resume here

- Worktree: `/Users/saeedarafa/dev/codex-backend/bonded` (current authorized backend worktree).
- Task: BE-19 daily reminders, new branch from `origin/main` `b30573f`. No implementation yet. Next: add service-only atomic `due_reminders(p_now)` selection/claims + RLS reminder ledger, 15-minute cron dispatch, ritual/last-call delivery and deterministic tests; generate types and update CONTRACTS/runbook. Weekly recap belongs to BE-14.
- Review requests handled first: #55 main merged without rebase at `046468c`, pushed and replied to lead. Only status conflict; stored-body regression assertion retained. #60 BE-30 code accepted, all seven CI checks pass at `0bd4846`; waits on independent security review and QA-owned strict race assertions. Do not alter its reviewed code or merge main.
- Verification in progress: original Resume commands for full DB/app checks are running (DB log `/tmp/bonded-backend-db.log`, app `/tmp/bonded-backend-app.log`). Deno 17 function + 9 QA tests, format, plan and agent-sync pass. Re-run #55 hardening on its branch after these complete; branch switched before that suite began. No schema changes until ongoing verification completes.
- Commands: `npm --prefix supabase/tests test`; `SUPABASE_TELEMETRY_DISABLED=1 npm --prefix supabase/tests run check:types`; `node supabase/scripts/build-seed.mjs --check`; `bash qa/ci/functions.sh`; `deno fmt --check supabase/functions`; `npm run typecheck`; `npm run lint`; `npm run format:check`; `npm test -- --runInBand`; `gh pr checks 55`; `gh pr view 60 --comments`.
- Tooling: Node 24 via `PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH`; hooks `.githooks`; git fetch/pull/push use `-c credential.helper= -c 'credential.helper=!gh auth git-credential'`. Never print secrets.
- No shared Supabase reset/stop; isolated PGlite only, real reset in CI. Never deploy to unidentified dev or production. Merged migrations immutable. Commit/push and refresh this handoff after every step.

## Doing

- BE-19 starting; #55 ready for lead merge on green CI; #60 awaiting security/QA gates.

## Done

- BE-26/#41 via QA-10/#54; MOB-32/#56; D37/#58; BE-10/#53; History/#61 merged.
- BE-29/#55 non-vacuous answer UPDATE assertion implemented and mutation-proven; latest main merged at `046468c`.
- BE-30/#60 implementation complete, prior 19 DB suites green, race 56/56, join requests 58/58, reveal 23/23; all seven CI checks green.

## Next

- Finish BE-19, then next unblocked BE backlog task (BE-20b is M3/P1; BE-18 is M4/P0). One branch/PR per task, lead alone merges.

## Blocked

- BE-27 hosted parity, dev deployments and SEC-04 N4 validation: no unambiguous dev project. `nciyrepyphvksusoigzx` is labelled production; do not use it.

## Needs from

- Lead: merge #55 on green; coordinate #60 security review and QA strict concurrency assertion.
- PO: identify hosted dev project for Auth parity and deployment. Existing local Auth templates support confirmation URL + six-digit OTP, callback allow-list `bonded://auth/callback`.
- Mobile: BE-10 types now on main; nudge enablement is in #62. No BE-19 app change planned.
