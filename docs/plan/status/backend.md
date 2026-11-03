# Backend / data developer status

Updated: 2026-11-03 · Branch: `be/BE-25-solo-archive` · Milestone: M2

## Resume here

- Last AI / date: Codex · 2026-11-03
- Branch + last commit: `be/BE-25-solo-archive` @ this correction commit.
- Uncommitted work: none after committing and pushing this correction.
- Exact next step: push the corrected BE-04c crossing-accept regression to PR #21 with lease protection, then monitor CI and lead re-review. Once it is merged, rebuild BE-26 from this dependency rather than overwriting its separate remote rebase.
- Commands to re-run: `npm --prefix supabase/tests test`; `SUPABASE_TELEMETRY_DISABLED=1 node supabase/tests/gen-types.mjs --check`; `node supabase/scripts/build-seed.mjs --check`; `deno lint supabase/functions && deno check supabase/functions/**/*.ts && deno test -A supabase/functions`.
- Watch out for: PR #21 now includes QA's `QA-03f` D04 contract commit and is rebased on `origin/main` (`f9765da`). PGlite returns timestamptz columns as `Date` objects: normalize before comparing pinned timestamps. Archived membership rows remain by design; active-membership assertions must use `left_at is null`. Git uses authenticated SSH in this clone; do not switch back to the unauthenticated HTTPS remote.

## Doing

- BE-25 / PR #21: corrected its CI failure: the BE-04c crossing-accept regression now asserts the losing solo couple is retained as an ended archive rather than deleted. Push/re-run CI next.

## Done

- PR #16 / BE-12: merged to `main`.
- PR #17 / BE-08: rebased review fixes were force-pushed with a verified lease; CI is running. Dev deployment remains withheld because the linked project reports as production.
- BE-25 focused D04/reveal regression: 131 passed, 0 failed; BE-04c hardening regression: 91 passed, 0 failed (2026-11-03).

## Next

- Get PRs #21 and #17 green and reviewed, then rebase/reconcile BE-26 on its merged dependency.

## Blocked

- BE-10 waits for the merge of PR #17 / BE-08.

## Needs from

- Lead: review PR #21 after its correction is pushed; merge PR #17 on green CI and provide an unambiguous dev project reference for BE-08 deployment.
- Security: SEC-01 review remains required for BE-26's typed-code approval flow once its dependency is merged and its PR is published.
