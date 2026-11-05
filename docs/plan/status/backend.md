# Backend / data developer status

Updated: 2026-11-05 · Branch: `be/BE-11-streak-saver` · Task: BE-11 integration after #90

## Resume here

- Current branch `be/BE-11-streak-saver`, PR #91. This checkpoint merges origin/main `3fbdd92` without rewriting reviewed history, as requested by the lead. Resolved CONTRACTS by preserving D18 and D39 descriptions/log rows; test command retains every main suite plus saver. No changes to reviewed migration220000, saver tests or generated types.
- Exact next step: local full DB validation is still running (log `/private/tmp/bonded-be11-after90-db.log`); finish it, then integrate latest main into #97/#100. All seven CI checks passed on `cf6d720` (run42025123136), including complete DB and real Supabase reset/contracts; #91 is CLEAN. Lead alone merges; migration220000 must deploy after #90/210000. Then integrate latest main into #97/#100 and refresh #102 per its lead comment.
- Commands: `export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH`; `export SUPABASE_HOME=/private/tmp/bonded-cli-resume SUPABASE_TELEMETRY_DISABLED=1`; `npm --prefix supabase/tests test`; `npm --prefix supabase/tests run check:types`; `bash qa/ci/functions.sh`; `node supabase/scripts/build-seed.mjs --check`; `node scripts/plan/generate.mjs --check`; `node scripts/agents/sync.mjs --check`; `git diff --check`; `gh pr checks 91`.
- Startup fetched/pulled clean branch. Authored open PR comments and inline comments reviewed (#91/#97/#100/#102); inline comments empty. New lead request: #90 merged (`3baa484`) and dev deployment successful; #83 stuck check is a GitHub-side hang superseded by successful later deploys including200000. Preserve migration order220000 →230000 →240000, then updated daily-reminder.
- Local validation: saver46, generated types, functions52+QA10, seed/plan/agent-sync/whitespace pass. Full suite in progress; no failures reported. Logs `/private/tmp/bonded-be11-after90-{db,saver,types,functions}.log`.
- Focused security source acceptance at `e7c98cb` retained; only cosmetic EOF change since. Prior saver46/reveal23/onboarding37/type/static, isolated reset/seed and authenticated HTTP partner retry + answer/saver race passed. Shared stack must never be reset/stopped. No hosted writes this run.
- #102 hosted Auth evidence: redirect/OTP6 match, Site URL localhost differs, subjects differ, HTML bodies unverified. Lead says dashboard settings/templates are PO-owned, leave dev templates without custom SMTP, and docs/status PR can be marked ready when finished. No rejected credential/UI attempts to repeat.
- Dev only `nyqbrsqqalygydtwvybb`; never prod `nciyrepyphvksusoigzx`. Hooks `.githooks`; no secrets or AI attribution.

## Doing

- Refreshing integrated backend PRs after #90; #91 first.

## Done

- BE-33 and BE-34 on main. #90/210000 dev deployment confirmed by lead.
- Startup review complete; no new source/security fixes requested.

## Next

- #91 → #97 → #100 in migration order, with latest-main integration and green CI. Lead merges.
- #102 docs/evidence handoff after lead clarification.

## Blocked

- BE-31 PO go; BE-22 approved milestone; BE-13 after launch. BE-32 loader merged; QA-13 environment/workflow configuration remains QA/PO-owned.
- Hosted Auth template body parity, Site URL, SMTP/device acceptance and function secrets require PO/lead action. D28 local-day3 needs lead confirmation.

## Needs from

- Lead: merge green backend PRs in migration order and confirm dev deployments/D28.
- PO: hosted Auth Site URL/template/SMTP settings; QA-13 environment. No credentials in comments or repo.
- Mobile/QA: BE-34 token-only bounded `error.details.inviter_name` now on main; generic fallback otherwise. BE-11/17/14 pending integration.
