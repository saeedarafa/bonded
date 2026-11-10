# Backend / data developer status

Updated: 2026-11-10 · Branch: `be/BE-37-pgnet-headers` · Task: BE-37 = fix for issue #126 (pg_net headers; not a BACKLOG row)

## Resume here

- Branch `be/BE-37-pgnet-headers` from origin/main `614a7ec`. Uncommitted work: none. Do NOT commit on `be/BE-36-free-pack-question` (QA is pushing its fixture companion there).
- Migration `supabase/migrations/20261110160000_pgnet_named_headers.sql` (after BE-36's 150000, so #129 merges first): `create or replace` of `private.dispatch_notify` and `private.dispatch_daily_reminders` with named pg_net args (`url, body, params := '{}', headers, timeout_milliseconds := 5000`); new internal `private.internal_url_allowed(text)` (https, or http for loopback/RFC1918/dotless docker hosts); `undefined_function` with `net` present is a warning with SQLSTATE only. Test `supabase/tests/pgnet-headers.test.mjs` (58: pg_net-exact stub, both dispatchers + answer trigger, URL guard, drift warning, ACLs, static guard on positional `net.http_*` in migrations >= 20261110160000). Fails 18 checks without the migration.
- Local: full `npm test` 31 suites green (rls 23, error-codes 55, hardening 91, pgnet 58); functions.sh 10 ok; types/plan/sync/diff-check pass. Real pg_net 0.20.4 smoke on the isolated `bonded_backend_review` stack (ports 563xx, stopped after): both requests POST, no query keys, `Authorization: Bearer <secret>` ok, no secret in URL/body. QA `purchases.test.ts` on that stack: 39 pass, 3 fail exactly as expected once delivery works (the #126 `it.fails`, plus two tests that `h.replay` the dispatch and now see `suppressed: 1` because the real dispatch already sent).
- CI run 42817828948 on `aa2c2b7`: all green except db-reset, whose only failures are the 3 expected `purchases.test.ts` ones (the #126 `it.fails` now passes on real pg_net in CI, Linux docker gateway URL included; migration applied on `supabase db reset`).
- Exact next step: watch `gh pr checks 130`; db-reset stays red until QA's companion (see Needs from). Then pull, re-run suites, mark ready. Rotation of the dev secret is the PO's, after this is applied on bonded-dev (security's comment on #126).
- Commands: `export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH`; `npm --prefix supabase/tests test`; `node supabase/tests/pgnet-headers.test.mjs` (from supabase/tests); `bash qa/ci/functions.sh`; `node supabase/tests/gen-types.mjs --check`; `node scripts/plan/generate.mjs --check`; `node scripts/agents/sync.mjs --check`. Fetch/push with `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' ...`.
- Gotcha: this status file conflicts with #129's copy; this version supersedes it.
- Dev only `nyqbrsqqalygydtwvybb`; never prod. No hosted writes. Hooks `.githooks`; no AI attribution.

## Doing

- BE-37 (#126 fix): PR #130 open, awaiting CI, QA companion and security re-review.
- BE-36 PR #129: awaiting CI and QA companion.

## Done

- BE-36 migration + tests + CONTRACTS (PR #129). BE-11 #123 and BE-17 #125 merged.
- #100 recap and #122 consent vehicle merged/deployed per lead. Premium wording correction implemented; hosted Auth report accepted. Streak-context backend implemented/tested and source-reviewed.

## Next

- After #129: no other unblocked BE row (BE-31 PO go; BE-22 milestone approval; BE-13 after launch).

## Blocked

- #129 db-reset needs the QA contract fixture change. BE-31 PO go; BE-22 milestone approval; BE-13 after launch. D28/partner ritual-time/J5 privacy decisions need lead.

## Needs from

- QA (BE-37 PR, companion commit on `be/BE-37-pgnet-headers`): in `qa/contract/purchases.test.ts` flip `the database's notify request authenticates and is delivered (#126)` from `it.fails` to `it`; update `notify delivers it to Sam only...` and `one partner_premium a day...`, which `h.replay` the dispatch and now get `{sent:0, suppressed:1}` because the real dispatch already delivered (assert on the real delivery instead). Optionally add one `dispatch_daily_reminders()` call through the harness (security's test 2).
- Security: re-review the BE-37 PR (migration + `pgnet-headers.test.mjs`).
- Lead: merge #129 before BE-37 (migration order); this status file supersedes #129's copy on conflict.
- PO: security's read-only dashboard checks on #126; rotate the dev internal secret only after BE-37 is on bonded-dev.

- QA: companion commit on `be/BE-36-free-pack-question`: in `qa/contract/helpers.ts` `ensureContent()`, add a question at position 0 of `fixture-contract-premium` (e.g. `FIXTURE-CONTRACT-PREMIUM-FIRST`, `daily_eligible: false`) so `Q.premium` stays gated; optionally assert the first question is free.
- Lead: review #129; mark D43 `decided`/done (BE-36) in DESIGN_DELTA when merged. Security review of the rule if wanted (no new anon surface).
- Mobile: none (MOB-20 already handles both outcomes; MOB-49 unblocked once merged).
