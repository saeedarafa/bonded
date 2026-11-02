# Backend / data developer status

Updated: 2026-11-02 · Branch: `be/BE-12-badges-v2` · Milestone: M3

## Resume here

- Last AI / date: Codex · 2026-11-02
- Branch + last commit: `be/BE-12-badges-v2` @ `0208e01` (PR #16, pushed); this status update is uncommitted.
- Uncommitted work: this status update only.
- Exact next step: commit/push this PR handoff, then `git fetch origin` and check PR #1. Only if it has merged, rebase/finalize PR #5; otherwise create `be/BE-08-notify-v2` from the latest `origin/main` and implement BE-08.
- Commands to re-run: `npm --prefix supabase/tests test && node supabase/tests/gen-types.mjs --check && node supabase/scripts/build-seed.mjs --check`.
- Watch out for: all 15 catalogue rows live in product-owned `supabase/content/badges.csv`; the loader reads but never edits it. PR #5 may not be revisited until PR #1 is merged.

## Doing

- BE-12 badges: PR #16 open. Migration adds protected catalogue/awards, idempotent content loading and a threshold-crossing streak trigger; full database suite and generated artifact checks pass.

## Done

- PR #1: latest lead blockers fixed and pushed (QA-03d cherry-pick plus pair-period answer-update guard); awaiting lead merge.
- PR #5: rebased on BE-06/07/23 and QA handoff added; it must rebase after PR #1 merges and retain pair-period guards.
- Dev project: function stubs deployed; internal and supplied external secrets are configured; migrations applied through BE-04c.

## Next

- Fetch/check PR #1, then take BE-08 notify if PR #1 is still open (which unblocks BE-10).

## Blocked

- BE-10 waits for BE-08.
- PR #5’s final composition rebase waits for the lead to merge PR #1.

## Needs from

- Lead: merge PR #1 after CI; PR #5 will be rebased immediately afterward.
