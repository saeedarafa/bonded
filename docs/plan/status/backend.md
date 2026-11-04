# Backend / data developer status

Updated: 2026-11-04 · Branch: `be/BE-33-onboarding-answers` · Task: BE-33 (D38, M2/P0)

## Resume here

- Last AI/date: Codex · 2026-11-04; work only `/Users/saeedarafa/dev/bonded-be`. Fresh branch `be/BE-33-onboarding-answers` from latest main `0cf8d71`; one task/PR per branch. Hooks `.githooks`; git credential helper via gh per command. Commit/push every completed step, no AI attribution.
- Exact next step: implement BE-33 private versioned onboarding answers with direct table upsert/read, RLS own rows only, composite key `(user_id,question_id,questionnaire_version)`, JSON payload/id/version/size validation, account cascade; tests for partner/outsider/anon, retry, two versions, update ownership and deletion. Generate types and document CONTRACTS §2; mobile MOB-37 consumes it. Migration must sort after pending BE-18/190000, reserve `20261103200000_onboarding_answers.sql`. Do not import BE-18 code into this branch.
- PR reviews checked first: #75 lead accepts both requested changes, **CI 41830450898 green** at `c5cacad`; keep draft for SEC-07 re-review of dev-only psql credential. No backend source request. #80 lead accepts approach; source security review + QA-owned auth-fixture companion + green combined CI remain. Main integrated without rebase into BE-18 at `16f08ca`, pushed/replied. Actions billing blocker resolved (repo public). No QA file edits or main merges.
- BE-18 source/checkpoint remains on `be/BE-18-revenuecat`, PR #80; local 23 DB suites, Deno 52, app 729, fresh isolated reset/contracts 281 pass (1 expected failure/7 todo); stale QA empty-body expectation is its sole local failure. #75 remains `be/BE-32-dev-content` at `c5cacad`, local DB 23/Deno 32+9/app729/contracts281 pass. Never mix these changes into BE-33.
- Test isolation: previous stack under ignored `supabase/.temp/backend-review-stack`, project `bonded_backend_review` / ports API56321 DB56322 mail56324, was stopped with --no-backup. Refresh its copied snapshot and use explicit --workdir on every stack command if needed; root config identifies QA's shared bonded stack. Never reset/stop shared services or print keys. Dev only `nyqbrsqqalygydtwvybb`; production `nciyrepyphvksusoigzx` prohibited. No hosted changes this session.
- Commands: `node supabase/tests/onboarding-answers.test.mjs`; `node supabase/tests/rls.test.mjs`; `npm --prefix supabase/tests test`; `SUPABASE_TELEMETRY_DISABLED=1 node supabase/tests/gen-types.mjs`; type/seed/plan/sync checks; Deno function checks; app typecheck/lint/tests as appropriate.
- Uncommitted work: none after task-pickup checkpoint.

## Doing

- BE-33 / D38: versioned own-only onboarding answer storage, including screen03 last_learned.

## Done

- Reviewed #75/#80 comments; no remaining backend source request, review gates recorded/replied. #75 CI green; #80 refreshed with main and parked.

## Next

- Finish BE-33 tests/types/contracts/PR; BE-34 (D39) next M2 task. BE-11 follows BE-18 merge; BE-31 waits for PO go.

## Blocked

- #75 security re-review; #80 security + QA companion. Hosted function/setup acceptance needs dev secrets/Vault. BE-27 hosted Auth GET/SMTP remains separate.

## Needs from

- Mobile/QA: BE-33 direct table contract/type handoff follows implementation; partner must never read onboarding answers. MOB-37 syncs 03/05/06 with a stable questionnaire version and retry timestamp.
- Lead/security: #75 SEC-07 verdict on the psql path; #80 named-head source review. Lead routes QA companion; backend never edits QA files or merges main.
- PO: dev-only credential/secrets and hosted acceptance setup; no production credentials.
