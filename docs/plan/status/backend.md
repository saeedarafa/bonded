# Backend / data developer status

Updated: 2026-11-04 · Branch: `be/BE-11-streak-saver` · Task: BE-11 / D18

## Resume here

- Primary worktree `/Users/saeedarafa/dev/codex-backend/bonded`. BE-11 branched from origin/be/BE-18-revenuecat (#80, unmerged dependency), then merged latest origin/main aaef349 without rewriting reviewed history. #81 remains the lead-designated BE-18 merge vehicle. Never merge main yourself.
- Exact next step: merge the lead-designated QA companion #81 into this dependency branch (it fixes the known inherited QA functions expectation), then full DB/Edge/static checks and isolated reset/HTTP concurrency smoke; open draft PR documenting #80/#81 dependency. Implementation complete: private monthly saver ledger, premium/gap validation, same-day retry, protected-day-aware late-answer scan. New migration220000 follows pending190000/200000/210000.
- BE-11 focused41/streak50/reveal23/private-helpers74 pass; types regenerated; seed/plan/sync/diff pass. Backend Deno52 pass; QA8+1 inherited stale fixture failure to resolve by integrating #81 unchanged. Isolated stack bonded_backend_be11 API58321/DB58322 starting under /private/tmp/bonded-be11-stack; no shared-stack commands.
- BE-34/#90 checkpoint b927f70 pushed. Implementation1e1dafe; current CI41850570130 all seven required jobs pass; draft awaits security. No review comments at startup. Local expired26, Deno32+QA9, types/seed/plan/sync/diff pass. Full local rerun stalled in existing 10,000-invite fixture; interrupted, not counted green. Remote fullDB/reset pass.
- Reviews checked first: #75 ready/source SEC-07 approved; #80 source SEC-08 approved, QA companion #81 is merge vehicle (do not edit QA tests here); #83 ready/all CI green. No unresolved backend source requests.
- Commands: Node24 PATH `/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin`; `SUPABASE_HOME=/private/tmp/bonded-cli-resume SUPABASE_TELEMETRY_DISABLED=1` required for CLI sandbox telemetry. `node supabase/tests/streak-saver.test.mjs`; `npm --prefix supabase/tests test`; `npm --prefix supabase/tests run check:types`; `bash qa/ci/functions.sh`; seed/plan/sync/diff checks. Hooks `.githooks`; push using per-command gh credential helper.
- Shared QA stack belongs to QA: never plain reset/stop. Use isolated project/ports. Dev only nyqbrsqqalygydtwvybb; never prod nciyrepyphvksusoigzx. No hosted calls this session.
- Uncommitted work: none after checkpoint; no secrets.

## Doing

- BE-11/D18 premium shared streak saver; one task branch/PR.

## Done

- Startup fetch/pull/status/log, backend skills, contracts/backlog/status review and open PR comments.
- BE-34 current CI green; handoff pushed before switching tasks.

## Next

- Complete BE-11 tests/contracts/types, local/CI verification and PR.
- Next unblocked BE-14 or BE-17 after this task.

## Blocked

- BE-34 focused security review and ordered dev migration rollout.
- #75 lead merge/QA-13 workflow and configuration; #80/#81 lead integration; #83 migration order.
- Hosted credentials/secrets/Vault/SMTP; BE-31 PO go; BE-22 approved milestone.

## Needs from

- Lead/security: review #90 token-gated expired name. Preserve migration order190000→200000→210000→220000. BE-11 depends on unmerged BE-18/#80/#81.
- Mobile/QA: contract changed BE-11: parameterless use_streak_saver returns streak_state; saver_available now enforces current-member premium, yesterday gap, shared local-month quota. Generated types available here; no reveal/answer writes. BE-34 additive `error.details.inviter_name`; BE-33 private onboarding answers ready on #83. BE-11 forthcoming.
- PO: dev-only hosted credentials/secrets/Vault/SMTP.
