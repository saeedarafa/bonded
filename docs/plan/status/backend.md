# Backend / data developer status

Updated: 2026-11-03 · Branch: `be/BE-06-streak-regression` · Milestone: M2

## Resume here

- Last AI / date: Codex · 2026-11-03
- Branch + last commit: `be/BE-06-streak-regression` @ `ed23d0f` `[BE-06] Make completed_today non-null`.
- Uncommitted work: this status handoff only (commit and push next).
- Exact next step: monitor PR #34 CI/review alongside PRs #17 and #21; once #21 merges, rebuild BE-26 from that dependency rather than overwriting its separate remote rebase.
- Commands to re-run: `node supabase/tests/streak.test.mjs`; `npm --prefix supabase/tests test`; `SUPABASE_TELEMETRY_DISABLED=1 node supabase/tests/gen-types.mjs --check`; `node supabase/scripts/build-seed.mjs --check`; `deno lint supabase/functions && deno check supabase/functions/**/*.ts && deno test -A supabase/functions`.
- Watch out for: `completed_today` remains nullable in generated TypeScript because Postgres composite fields are nullable at the schema level; the RPC contract guarantees a boolean. `streak-11-fresh-day` must be added to QA-owned `qa/fixtures/personas.json` before the backend can add it to `dev_seed`, because the seed parity test rejects unlisted scenario IDs.

## Doing

- BE-06 / QA-BUG-3 / PR #34: migration makes `get_streak().completed_today` `false`, never null, when no day has been completed; backend regression passes 50/50.
- BE-25 / PR #21: corrected its CI failure: the BE-04c crossing-accept regression now asserts the losing solo couple is retained as an ended archive rather than deleted; CI is re-running.
- BE-08 / PR #17: rebased review fixes were force-pushed with a verified lease; CI is running. Dev deployment remains withheld because the linked Supabase project is labelled production.

## Done

- PR #16 / BE-12 merged to `main`.
- BE-25 focused D04/reveal regression: 131 passed, 0 failed; BE-04c hardening regression: 91 passed, 0 failed (2026-11-03).

## Next

- Get this QA-BUG-3 correction, PR #21, and PR #17 green and reviewed, then rebase/reconcile BE-26 on its merged dependency.

## Blocked

- BE-10 waits for PR #17 / BE-08 to merge.

## Needs from

- Lead: review PR #21 after CI is green; merge PR #17 on green CI and provide an unambiguous dev project reference for BE-08 deployment.
- Security: SEC-01 review remains required for BE-26's typed-code approval flow once its dependency is merged and its PR is published.
- QA: add `streak-11-fresh-day` to `qa/fixtures/personas.json`; backend will then add its matching `dev_seed` builder.
