# Backend / data developer status

Updated: 2026-11-05 · Branch: `be/BE-17-couple-offers` · Task: BE-17 integration after #90

## Resume here

- Current branch `be/BE-17-couple-offers`, PR #97. This checkpoint merges origin/main `3fbdd92` without rewriting reviewed history. CONTRACTS merged automatically retaining D28 and D39; test command retains every main suite plus offers. Reviewed migration230000, offer tests and types unchanged.
- Exact next step: verify seven latest-head CI checks, then lead merges/deploys230000 after #91/220000. Local offers46/reveal23/onboarding37/expired26/types/static passed after integration `f6bbf61`/`87eba8d`; handoff `78d48d5` pushed. This checkpoint additionally merges main `2d76a75` (release/planning only, no backend source changes); no full local repeat needed. Latest cross-task handoff is on #102. Lead alone merges main.
- Commands: `export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH`; `export SUPABASE_HOME=/private/tmp/bonded-cli-resume SUPABASE_TELEMETRY_DISABLED=1`; `node supabase/tests/offers.test.mjs`; `node supabase/tests/rls.test.mjs`; `node supabase/tests/onboarding-answers.test.mjs`; `node supabase/tests/expired-invite.test.mjs`; `npm --prefix supabase/tests run check:types`; `node supabase/scripts/build-seed.mjs --check`; `node scripts/plan/generate.mjs --check`; `node scripts/agents/sync.mjs --check`; `git diff --check`; `gh pr checks 97`.
- #91 integrated main in `cf6d720`, all seven CI checks pass (run42025123136); local complete DB suite and saver46/type/functions52+QA10/seed/static also passed. Handoff `22b15d4` pushed, refresh status-only CI. Logs `/private/tmp/bonded-be11-after90-{db,saver,types,functions}.log`.
- Startup authored PR comments/inline reviewed; no new source requests. Lead accepted #97 at `ea6693a`; focused security acceptance `17b6c47` remains applicable. #90 merged/deployed successfully (lead), superseding #83 stuck deployment check. Migration order220000 →230000 →240000, then updated daily-reminder. No hosted writes/shared-stack reset.
- #102 hosted Auth evidence: redirect/OTP6 match, Site URL localhost differs, subjects differ, HTML bodies unverified. Lead says dashboard settings/templates are PO-owned, leave dev templates without custom SMTP, and docs/status PR can be marked ready when finished. No rejected credential/UI attempts to repeat.
- Dev only `nyqbrsqqalygydtwvybb`; never prod `nciyrepyphvksusoigzx`. Hooks `.githooks`; no secrets or AI attribution.

## Doing

- Refreshing #97 and #100 after #90; #91 integration green.

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
