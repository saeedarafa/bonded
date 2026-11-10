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

- After BE-37: no other unblocked BE row (BE-31 needs the PO's go; BE-22 needs milestone approval; BE-13 waits until after launch).

## Blocked

- BE-31 needs the PO's go; BE-22 needs milestone approval; BE-13 waits until after launch. The D28, partner ritual-time and J5 privacy decisions need the lead.

## Needs from

- Security: re-review the userinfo delta `7ae4d96` on #130 (issuecomment-6768046475).
- QA: nothing for now. Your BE-37 companion (`bf91009`) is on the branch. Report back if CI shows a contract failure.
- Lead: review and merge #130 once CI and security are green.
- PO: run security's read-only dashboard checks on #126. Rotate the dev internal secret only after BE-37 is on bonded-dev.
- Mobile: none.
