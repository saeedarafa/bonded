# Backend / data developer status

Updated: 2026-11-10 · Branch: `be/BE-36-free-pack-question` · Task: BE-36 free first pack question (D43)

## Resume here

- Branch `be/BE-36-free-pack-question` from origin/main `441d59a`; PR #129. Uncommitted work: none.
- Migration `supabase/migrations/20261110150000_free_first_pack_question.sql`; test `supabase/tests/free-pack-question.test.mjs` (29); fixtures in `error-codes`/`rls` tests give the premium pack a first question. Rule for multi-pack: free if first (lowest active position, ties by id) in ANY active pack. Inactive question → QUESTION_UNAVAILABLE.
- Local: full `npm test` 30 suites green (rls 23, error-codes 55, hardening 91); types/plan/sync/diff-check pass.
- CI run 42815046874 on `174ac27`: all jobs green except db-reset, whose only failure is `qa/contract/rpc.test.ts` "PREMIUM_REQUIRED for a premium-pack question" (the QA fixture's lone premium question is now free; migration applied fine on `supabase db reset`).
- Exact next step: watch `gh pr checks 129`. db-reset stays red until QA's companion commit updates `qa/contract/helpers.ts` (premium fixture needs a first question); then `git pull --ff-only`, re-run suites, mark ready for lead.
- Commands: `export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH`; `npm --prefix supabase/tests test`; `node supabase/tests/gen-types.mjs --check`; `node scripts/plan/generate.mjs --check`; `node scripts/agents/sync.mjs --check`; `gh pr checks 129`. Fetch/push with `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' ...`.
- Dev only `nyqbrsqqalygydtwvybb`; never prod. No hosted writes. Hooks `.githooks`; no AI attribution.

## Doing

- BE-36 PR #129: awaiting CI and QA companion.

## Done

- BE-36 migration + tests + CONTRACTS (PR #129). BE-11 #123 and BE-17 #125 merged.
- #100 recap and #122 consent vehicle merged/deployed per lead. Premium wording correction implemented; hosted Auth report accepted. Streak-context backend implemented/tested and source-reviewed.

## Next

- After #129: no other unblocked BE row (BE-31 PO go; BE-22 milestone approval; BE-13 after launch).

## Blocked

- #129 db-reset needs the QA contract fixture change. BE-31 PO go; BE-22 milestone approval; BE-13 after launch. D28/partner ritual-time/J5 privacy decisions need lead.

## Needs from

- QA: companion commit on `be/BE-36-free-pack-question`: in `qa/contract/helpers.ts` `ensureContent()`, add a question at position 0 of `fixture-contract-premium` (e.g. `FIXTURE-CONTRACT-PREMIUM-FIRST`, `daily_eligible: false`) so `Q.premium` stays gated; optionally assert the first question is free.
- Lead: review #129; mark D43 `decided`/done (BE-36) in DESIGN_DELTA when merged. Security review of the rule if wanted (no new anon surface).
- Mobile: none (MOB-20 already handles both outcomes; MOB-49 unblocked once merged).
