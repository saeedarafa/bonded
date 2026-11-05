# Backend / data developer status

Updated: 2026-11-05 · Branch: `be/BE-35-archive-consent` · Task: BE-35

## Resume here

- BE-35 draft PR #115 (https://github.com/saeedarafa/bonded/pull/115), first implementationcfb7838. BE-35 branch from latest origin/main `89948f7`, independent of unmerged #97/#100. Migration250000 follows pending230000/240000; lead alone merges in order.
- Implemented D37 `p_archive_own` default false and `CONFIRM_ARCHIVE`; private RLS consent ledger binds typed approval to the exact solo couple. Valid solo requests without true cannot archive or become pending; legacy/changed-space pending approval fails until requester reconfirms. Public old overload removed; private core remains denied to all API roles. Focused consent56 and reveal23 pass, including read/write denial for every API role.
- Backend validation complete: DB suites passed in split invocations. Initial full run passed through reminders, then caught the new wrapper's non-hardened search_path (hardening90/1). Restored pg_catalog, extensions, public, pg_temp; hardening91 and every remaining suite pass in /private/tmp/bonded-be35-db-suffix.log. Consent56 and final reveal23 pass; types/current check, functions52+QA10 and seed/plan/agent-sync/whitespace pass. Original prefix evidence: /private/tmp/bonded-be35-db.log.
- Isolated exact-tree reset plus final real HTTP checks pass (/private/tmp/bonded-be35-{reset-exact,http}.log): false/null/omitted flags, confirmed-vs-unconfirmed race, archive privacy, stale-space approval/reconfirmation and anon denial; fixture accounts/couples cleaned. Consent FK index and hardened search_path also applied/tested on isolated Postgres after reset. Shared stack untouched.
- Exact next step: mobile adoption/ack and focused security review on #115; QA updates intended solo token-join helpers in qa/contract/invites.test.ts and ended-couples.test.ts. QA diagnostics:271 pass/10 fail solely CONFIRM_ARCHIVE,1 expected fail/7todo; QA typecheck passes. App local/CI typecheck fails src/lib/errors.ts:115 because errors.CONFIRM_ARCHIVE is missing; mobile owns translations and D37 request flag. Keep draft until integrated CI green; backend must not edit their files. Refresh latest CI after this hardening fix, which removes the backend-owned failure.

- #91/220000 merged/deployed to dev (lead confirmation). #97 main integration65c664c and #100 integrationacbec9b pushed; local feature/reveal/saver/helpers/types/static pass, #100 functions54+QA10 pass. All seven CI checks now pass at both heads (#97 run42031085830, #100 run42031205555); reviewed feature migrations/functions unchanged. Keep all suites and CONTRACTS log rows during integration. #100 does not include unmerged230000.
- #102 docs-only Auth report remains ready; partial evidence only, hosted parity/SMTP/device acceptance remains PO/QA-owned. No hosted writes.
- Commands: export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH; export SUPABASE_HOME=/private/tmp/bonded-cli-resume SUPABASE_TELEMETRY_DISABLED=1; node supabase/tests/archive-consent.test.mjs; npm --prefix supabase/tests test; node supabase/tests/gen-types.mjs --check; bash qa/ci/functions.sh; node supabase/scripts/build-seed.mjs --check; node scripts/plan/generate.mjs --check; node scripts/agents/sync.mjs --check; git diff --check; gh pr checks 97; gh pr checks 100; gh pr checks 102.
- Shared stack never reset/stopped. Dev only nyqbrsqqalygydtwvybb; no prod. Hooks .githooks. No secrets/AI attribution.

## Doing

- BE-35 draft #115 backend validation; consumer adoption pending. Latest branch sources committed/pushed after each step; no hosted changes.

## Done

- #97/#100 review-requested main merges pushed, reviewed source unchanged.

## Next

- BE-35 PR and mobile/security review, lead integration/dev deploys.

## Blocked

- BE-31 needs PO go; BE-22 approved milestone; BE-13 after launch. Hosted Auth acceptance and function secrets/device evidence need PO/QA. D28 local-day3 interpretation needs lead confirmation.

## Needs from

- Mobile: ack BE-35 breaking contract; send p_archive_own:true only from D37 sheet; handle CONFIRM_ARCHIVE including stale pending approval.
- Security: focused BE-35 consent/approval/lock-order review when PR opens.
- Lead: green #97 → #100 → BE-35 merge/deploy order (250000 after240000); #102 docs review and D28 confirmation.
