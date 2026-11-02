# Backend / data developer status

Updated: 2026-11-02 · Branch: `be/BE-12-badges-v2` · Milestone: M3

## Resume here

- Last AI / date: Codex · 2026-11-02
- Branch + last commit: `be/BE-12-badges-v2` @ pending review-fix commit; rebase is complete but not yet pushed.
- Uncommitted work: BE-12 review fixes (private trigger helper, ended-archive policy/test, status).
- Exact next step: run the database suite and generated-artifact checks, commit/push the review fixes for PR #16, then switch to `be/BE-08-notify-v2` and address its remaining PR #17 review.
- Commands to re-run: `npm --prefix supabase/tests test && node supabase/tests/gen-types.mjs --check && node supabase/scripts/build-seed.mjs --check`.
- Watch out for: all 15 catalogue rows live in product-owned `supabase/content/badges.csv`; the loader reads but never edits it. `couple_streaks` is always created at `current = 0`, so the badge trigger needs only the update path.

## Doing

- BE-12 badges: PR #16 open. Rebased on `origin/main`; addressing the lead’s private-definer and ended-archive review comments.

## Done

- PR #5: merged to `main`.
- Dev project: function stubs deployed; internal and supplied external secrets are configured; migrations applied through BE-04c.

## Next

- PR #17: switch to `be/BE-08-notify-v2` after PR #16’s fixes and address the `public.claim_push` wrapper / handler error review.

## Blocked

- BE-10 waits for BE-08.

## Needs from

- Lead: review PR #16 after its rebase and review fixes are pushed.
