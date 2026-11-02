# Backend / data developer status

Updated: 2026-11-02 · Branch: `be/BE-12-badges-v2` · Milestone: M3

## Resume here

- Last AI / date: Codex · 2026-11-02
- Branch + last commit: `be/BE-12-badges-v2`, rebased on latest `origin/main` (`f8c049b`); this status handoff is uncommitted.
- Uncommitted work: this status handoff only.
- Exact next step: implement BE-12 in a new migration after `20261102230000_notification_prefs.sql`: badge catalogue and awards with RLS, idempotent `badges.csv` loader integration, and a streak-advance trigger helper. Add PGlite tests for streak 1/3/7 exactly once, own/couple RLS and outsider/anon denial; regenerate types, update CONTRACTS, then test/commit/push/PR.
- Commands to re-run: `npm --prefix supabase/tests test && node supabase/tests/gen-types.mjs --check && node supabase/scripts/build-seed.mjs --check`.
- Watch out for: all 15 catalogue rows live in product-owned `supabase/content/badges.csv`; read it but never edit it. BE-12 depends only on merged BE-06. Do not wait for PR reviews.

## Doing

- BE-12 badges: schema/loader/trigger design inspected; implementation next.

## Done

- PR #1: latest lead blockers fixed and pushed (QA-03d cherry-pick plus pair-period answer-update guard); awaiting lead merge.
- PR #5: rebased on BE-06/07/23 and QA handoff added; it must rebase after PR #1 merges and retain pair-period guards.
- Dev project: function stubs deployed; internal and supplied external secrets are configured; migrations applied through BE-04c.

## Next

- BE-12, then BE-08 notify (which unblocks BE-10).

## Blocked

- BE-10 waits for BE-08.
- PR #5’s final composition rebase waits for the lead to merge PR #1.

## Needs from

- Lead: merge PR #1 after CI; PR #5 will be rebased immediately afterward.
