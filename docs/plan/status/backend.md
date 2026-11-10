# Backend / data developer status

Updated: 2026-11-10 · Branch: `be/BE-37-pgnet-headers` · Task: BE-37 = fix for issue #126 (pg_net headers; not a BACKLOG row)

## Resume here

- Branch `be/BE-37-pgnet-headers` (PR #130). main merged in (`fea7d7b`, after #129; migration 20261110160000 stays after BE-36's 150000). Security's userinfo fix is `7ae4d96`. QA companion `bf91009` (+ merge `d7a4e24`) is on the branch. Uncommitted work: none.
- `7ae4d96`: `private.internal_url_allowed` rejects `@` in the authority for any scheme (`!~ '^[a-zA-Z][a-zA-Z0-9+.-]*://[^/?#]*@'`). The http host match is anchored (`host(:digits)?` then `/?#` or end). `[::1]` gets its own anchored match (it was unreachable before). The migration was edited in place: unmerged and not applied anywhere. CONTRACTS §4 and its change-log line say "no userinfo". `pgnet-headers.test.mjs` 70/70 (security's 3 URLs + HTTP-uppercase, 2 https userinfo, `[::1].evil`, bad port are refused; `[::1]`, uppercase, `@`-in-path and an https path/query URL are allowed).
- Local after the fix: all 32 DB suites green, functions.sh 10 ok, types/plan/sync/diff-check pass. PR comment asking security to re-review the `7ae4d96` delta: #130 issuecomment-6768046475.
- Exact next step: watch `gh pr checks 130` (run 42821080518 on `d7a4e24`, includes QA's companion; db-reset should now be green). If it's green and security approves, mark ready for the lead. The PO rotates the dev secret after this is on bonded-dev.
- Commands: `export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH`; `npm --prefix supabase/tests test`; `node pgnet-headers.test.mjs` (from supabase/tests); `bash qa/ci/functions.sh`; `node supabase/tests/gen-types.mjs --check`; `node scripts/plan/generate.mjs --check`; `node scripts/agents/sync.mjs --check`. Fetch/push with `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' ...`. QA pushes to this branch: fetch and merge (no rebase or force) before every push.
- Dev only `nyqbrsqqalygydtwvybb`; never prod. No hosted writes. Hooks `.githooks`; no AI attribution.

## Doing

- BE-37 (#126 fix): PR #130 open. The userinfo fix is pushed; waiting for CI and security's re-review of `7ae4d96`.

## Done

- BE-36 merged (#129). BE-11 #123 and BE-17 #125 merged.
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
