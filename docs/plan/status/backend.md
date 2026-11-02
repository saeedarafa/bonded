# Backend / data developer status

Updated: 2026-11-02 · Branch: `be/BE-12-badges-v2` · Milestone: M3

## Resume here

- Last AI / date: Codex · 2026-11-02
- Branch + last commit: `be/BE-12-badges-v2`, rebased on `origin/main` (`f8c049b`); BE-12 code, generated types/seed, tests, contract and this handoff are uncommitted.
- Uncommitted work: BE-12 migration/loader/award tests/generated artifacts plus `docs/CONTRACTS.md` and this status.
- Exact next step: run the full DB suite and generated-artifact checks; commit, push and open the BE-12 PR. Then `git fetch origin`, check whether PR #1 has merged, and either rebase/finalize PR #5 (only if merged) or branch BE-08 from latest `origin/main`.
- Commands to re-run: `npm --prefix supabase/tests test && node supabase/tests/gen-types.mjs --check && node supabase/scripts/build-seed.mjs --check`.
- Watch out for: all 15 catalogue rows live in product-owned `supabase/content/badges.csv`; the loader reads but never edits it. PR #5 may not be revisited until PR #1 is merged.

## Doing

- BE-12 badges: migration adds protected catalogue/awards, idempotent content loading and a threshold-crossing streak trigger; focused PGlite suites pass. Full suite and PR remain.

## Done

- PR #1: latest lead blockers fixed and pushed (QA-03d cherry-pick plus pair-period answer-update guard); awaiting lead merge.
- PR #5: rebased on BE-06/07/23 and QA handoff added; it must rebase after PR #1 merges and retain pair-period guards.
- Dev project: function stubs deployed; internal and supplied external secrets are configured; migrations applied through BE-04c.

## Next

- Finish BE-12 PR, then fetch/check PR #1 and take BE-08 notify if PR #1 is still open (which unblocks BE-10).

## Blocked

- BE-10 waits for BE-08.
- PR #5’s final composition rebase waits for the lead to merge PR #1.

## Needs from

- Lead: merge PR #1 after CI; PR #5 will be rebased immediately afterward.
