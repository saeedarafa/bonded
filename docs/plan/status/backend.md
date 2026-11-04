# Backend / data developer status

Updated: 2026-11-04 · Branch: `be/BE-33-onboarding-answers` · Task: BE-33 / D38 / PR #83

## Resume here

- Last AI/date: Codex · 2026-11-04; work only `/Users/saeedarafa/dev/bonded-be`. Branch `be/BE-33-onboarding-answers`; implementation `28c44ed`, draft checkpoint `8a67674`, PR **#83** https://github.com/saeedarafa/bonded/pull/83. Latest main `60564eb` integrated without rebase (lead status only; product source unchanged). This checkpoint records final verification; no uncommitted work afterward.
- PR #83 marked **ready for review**, final validation body and mobile/QA/lead handoff posted; evidence checkpoint `9eec337`.
- Exact next step: await lead review on #83 + **merge #80 (migration190000) before #83 (200000)** so auto-deploy does not strand a lower migration. Do not merge main or deploy before review. Mobile MOB-37 consumes the table/types. Next independent task is BE-34 (D39, M2/P1, requires security); one branch/PR per task in this folder.
- BE-33 complete: `onboarding_answers` direct owner-only read/upsert, composite `(user_id,question_id,questionnaire_version)`, structured non-null JSON ≤8192 bytes, stable question ids/positive versions/finite timestamps; no partner/anon access, client delete or Realtime; cascade with account. Contracts document `last_learned`/`stage`/`goals`, questionnaire_version1, original retry timestamp; two versions coexist. Generated types committed. Existing couple settings remain separate. No user content logging.
- **All 7 CI checks green** on `8a676741fc8a776b69e19b80de5612e08f01a425`, run **41836173031** https://github.com/saeedarafa/bonded/actions/runs/41836173031 (full DB suite/types, real reset/contracts, app, functions, plan, sync, ci-ok). Product source is still `28c44ed`; later changes only status/main lead notes. Full DB npm command contains all 23 suites.
- Local focused **37/37**, reveal **23/23**; generated types/seed/plan/sync, app typecheck/lint/format pass; backend Deno **32 + QA9** pass. Initial local app run had four 5-second route timeouts under concurrent load (767/771 passed); reran the entire route file without duplicate DB load: **152/152 pass**. CI app check passed normally. Duplicate local full DB run intentionally stopped in exhaustive invite case after the same source's full CI suite passed; do not call that interrupted local run green. Logs `/tmp/bonded-be33-{db,functions,app,routes}.log`.
- Independent **real local Supabase fresh reset passes**, QA contract typecheck + **281 pass /1 expected failure/7 todo; 1 file skipped**. Extra PostgREST smoke using actual SDK upsert passed retry equality, two versions, current-partner/anon denial, forged upsert denial and account cascade; fixture accounts/couple cleaned up. Logs `/tmp/bonded-be33-{http,contract}.log`. Script is ignored `supabase/.temp/be33-http-smoke.mjs`; credentials were captured in memory only, never printed/stored in script.
- Isolated stack `bonded_backend_review` under ignored `supabase/.temp/backend-review-stack` (API56321/DB56322/mail56324) is **stopped with --no-backup**; startup output removed. Shared `bonded` untouched. Never plain reset/stop (root config identifies shared stack); use explicit --workdir and refresh branch-exact copied migrations/seed/templates for repeats. No hosted calls/writes this session; only dev `nyqbrsqqalygydtwvybb`, never production `nciyrepyphvksusoigzx`.
- PR review priority satisfied first: #75 lead accepts both fixes; CI **41830450898 green** at `c5cacad`; draft waits SEC-07 re-review of dev-only psql path. #80 lead accepts approach; waits source security + QA auth-fixture companion + combined CI. Main refreshed in #80 at `16f08ca`, pushed/replied. Actions works again (public repo). These remain on their own branches, not copied into BE-33.
- Re-run commands: `node supabase/tests/onboarding-answers.test.mjs`; `node supabase/tests/rls.test.mjs`; `npm --prefix supabase/tests test`; `SUPABASE_TELEMETRY_DISABLED=1 npm --prefix supabase/tests run check:types`; `bash qa/ci/functions.sh`; `npm run typecheck`; `npm run lint`; `npm run format:check`; `npm test -- --runInBand`; type/seed/plan/sync checks. Hooks `.githooks`; fetch/push with per-command gh credential helper, no AI attribution. Commit/push every completed step.

## Doing

- BE-33 / #83: implementation and validation complete, marked ready, handoff posted; awaiting lead review/merge order.

## Done

- Checked/replied to #75/#80 reviews before next task; no outstanding backend source request.
- BE-33 migration/RLS/tests/types/contracts; focused/reveal tests, full green CI, real reset/contracts/SDK privacy and retry validation.

## Next

- Lead reviews #83; merge order #80 → #83. MOB-37 syncs after BE-33; BE-34 next independent backend task. BE-11 follows BE-18 merge; BE-31 waits PO go.

## Blocked

- #83 hosted rollout waits reviewed migration order (#80 first); no dev DB credentials/secrets printed or used here.
- #75 SEC-07 re-review; #80 security + QA companion. Hosted function/setup acceptance requires dev secrets/Vault; BE-27 hosted Auth GET/SMTP remains separate.

## Needs from

- Lead: review #83 and enforce #80/190000 → #83/200000 merge/deploy order; lead alone merges. Route new private data-flow review as appropriate.
- Mobile/QA: MOB-37 table/types/SDK contract is on #83. Use original answer timestamp on retry and new row for new questionnaire version. Partner cannot read these rows. Update the old mobile store's local-only lastLearned comment with MOB-37; no mobile files edited.
- Security: #75 named-head verdict on dev-only psql; #80 webhook/dedupe/transfer review. QA owns #80's stale empty-body assertion companion.
- PO: dev-only credential/secrets and hosted acceptance setup. No production credentials.
