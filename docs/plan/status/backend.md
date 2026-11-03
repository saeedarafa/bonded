# Backend / data developer status

Updated: 2026-11-03 · Branch: `be/BE-25-solo-archive` · Milestone: M2

## Resume here

- Last AI / date: Codex · 2026-11-03
- Branch + last commit: `be/BE-25-solo-archive` @ `05442b6` `[BE-25] Correct archive regression assertions`.
- Uncommitted work: this status handoff only (commit and push next).
- Exact next step: monitor PR #21 CI and lead re-review (all six checks began pending after `0cfbf78`). Once it is merged, rebuild BE-26 from this dependency rather than overwriting its separate remote rebase.
- Commands to re-run: `npm --prefix supabase/tests test`; `SUPABASE_TELEMETRY_DISABLED=1 node supabase/tests/gen-types.mjs --check`; `node supabase/scripts/build-seed.mjs --check`; `deno lint supabase/functions && deno check supabase/functions/**/*.ts && deno test -A supabase/functions`.
- Watch out for: PR #21 now includes QA's `QA-03f` D04 contract commit and is rebased on `origin/main` (`f9765da`). PGlite returns timestamptz columns as `Date` objects: normalize before comparing pinned timestamps. Archived membership rows remain by design; active-membership assertions must use `left_at is null`. Git uses authenticated SSH in this clone; do not switch back to the unauthenticated HTTPS remote.

## Doing

- BE-25 / PR #21: QA's D04 contract tests merged, rebased on `main`, backend archive regression repaired, and re-review requested; CI is pending.

## Done

- PR #16 / BE-12: merged to `main`.
- PR #17 / BE-08: rebased review fixes were force-pushed with a verified lease; CI is running. Dev deployment remains withheld because the linked project reports as production.
- BE-25 focused D04/reveal regression: 131 passed, 0 failed (2026-11-03).

## Next

- Get PR #21 green and reviewed, then rebase/reconcile BE-26 on its merged dependency.

## Blocked

- BE-10 waits for the merge of PR #17 / BE-08.

## Needs from

- Lead: review PR #21 after its correction is pushed; merge PR #17 on green CI and provide an unambiguous dev project reference for BE-08 deployment.
- Security: SEC-01 review remains required for BE-26's typed-code approval flow once its dependency is merged and its PR is published.
