# Backend / data developer status

Updated: 2026-11-03 · Branch: `be/BE-25-solo-archive` · Milestone: M2

## Resume here

- Last AI / date: Codex · 2026-11-03
- Branch + last commit: `be/BE-25-solo-archive` @ this PR #21 review-correction handoff commit.
- Uncommitted work: none.
- Exact next step: push the PR #21 review correction, then check its CI and lead review. BE-10 remains blocked on PR #17 merging.
- Commands to re-run: `npm --prefix supabase/tests test`; `node supabase/tests/gen-types.mjs --check`; `node supabase/scripts/build-seed.mjs --check`. The focused D04 archive/reveal PGlite check passed on 2026-11-03; the full runner exceeds this shell's 30-second window.
- Watch out for: preserve BE-04c's actor/couple/invite lock order exactly. Archived membership rows remain by design; active-membership assertions must use `left_at is null`. The linked Supabase project is labelled production by the CLI, so do not deploy without a confirmed dev target.

## Doing

- BE-25 / PR #21: correct contradictory D04 test assertions so the retained archive is not treated as an active membership or a reveal-rule leak.

## Done

- PR #16 / BE-12: merged to `main`.
- PR #17 / BE-08: rebased review fixes were force-pushed with a verified lease; CI is running. Dev deployment remains withheld because the linked project reports as production.

## Next

- Get PR #21 green and reviewed, then take the next unblocked backend task.

## Blocked

- BE-10 waits for the merge of PR #17 / BE-08.

## Needs from

- Lead: review PR #21 after its correction is pushed; merge PR #17 on green CI and provide an unambiguous dev project reference for BE-08 deployment.
