# Backend / data developer status

Updated: 2026-11-05 · Branch: `be/BE-14-weekly-recap` · Task: BE-14 integration after #90

## Resume here

- Current branch `be/BE-14-weekly-recap`, PR #100. This checkpoint merges origin/main `3fbdd92` without rewriting reviewed history. CONTRACTS retains D21 and D39 semantics/log rows; test command retains every main suite plus weekly recap. Reviewed migration240000, tests, daily-reminder and types unchanged.
- Exact next step: verify seven latest-head CI checks, then lead merges/deploys240000 after #97/230000; deploy migration before updated daily-reminder. Local recap55/reveal23/onboarding37/expired26/types/functions54+QA10/static passed after integration `e1da592`, handoff `e3fc5db`. This checkpoint also merges main `2d76a75` (release/planning only, no backend source changes); no full local repeat needed. Latest cross-task handoff on #102. Lead alone merges main.
- Commands: `export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH`; `export SUPABASE_HOME=/private/tmp/bonded-cli-resume SUPABASE_TELEMETRY_DISABLED=1`; `node supabase/tests/weekly-recap.test.mjs`; `node supabase/tests/rls.test.mjs`; `node supabase/tests/onboarding-answers.test.mjs`; `node supabase/tests/expired-invite.test.mjs`; `npm --prefix supabase/tests run check:types`; `bash qa/ci/functions.sh`; `node supabase/scripts/build-seed.mjs --check`; `node scripts/plan/generate.mjs --check`; `node scripts/agents/sync.mjs --check`; `git diff --check`; `gh pr checks 100`.
- #97 integrated main in `f6bbf61`/`87eba8d`, handoff `78d48d5` pushed. Local offers46/reveal23/onboarding37/expired26/types/seed/static pass; refreshed CI pending. Log `/private/tmp/bonded-be17-after90-focused.log`.
- #91 integrated main in `cf6d720`, all seven CI checks pass (run42025123136); local complete DB suite and saver46/type/functions52+QA10/seed/static also passed. Handoff `22b15d4` pushed, refresh status-only CI. Logs `/private/tmp/bonded-be11-after90-{db,saver,types,functions}.log`.
- Startup authored PR comments/inline reviewed; no new source requests. Lead accepted #100 at `9dfdd6d`; focused security acceptance `ad8845d` and confirmed D21 semantics remain applicable. #90 merged/deployed successfully (lead), superseding #83 stuck deployment check. Migration order220000 →230000 →240000, then updated daily-reminder. No hosted writes/shared-stack reset.
- #102 hosted Auth evidence: redirect/OTP6 match, Site URL localhost differs, subjects differ, HTML bodies unverified. Lead says dashboard settings/templates are PO-owned, leave dev templates without custom SMTP, and docs/status PR can be marked ready when finished. No rejected credential/UI attempts to repeat.
- Dev only `nyqbrsqqalygydtwvybb`; never prod `nciyrepyphvksusoigzx`. Hooks `.githooks`; no secrets or AI attribution.

## Doing

- Refreshing #100 after #90; #91 integration green, #97 focused checks pass.

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
