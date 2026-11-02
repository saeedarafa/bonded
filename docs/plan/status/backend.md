# Backend / data developer status

Updated: 2026-11-02 · Branch: `be/BE-25-solo-archive` · Milestone: M2

## Resume here

- Last AI / date: Codex · 2026-11-02
- Branch + last commit: `be/BE-25-solo-archive` @ `8720932`; this handoff update is uncommitted.
- Uncommitted work: this status update only.
- Exact next step: commit/push this handoff and open the BE-25 PR. Then check PR #17 review status before taking another task.
- Commands to re-run: `npm --prefix supabase/tests test && node supabase/tests/gen-types.mjs --check && node supabase/scripts/build-seed.mjs --check`.
- Watch out for: preserve BE-04c's actor/couple/invite lock order exactly. The linked Supabase project is labelled production by the CLI, so do not deploy without a confirmed dev target.

## Doing

- BE-25 D04 solo archive: implementation complete; focused archive, invite, generated-type and seed checks pass. Ready to push/open for review.

## Done

- PR #16 / BE-12: merged to `main`.
- PR #17 / BE-08: review changes pushed; dev deployment withheld because the linked project reports as production.

## Next

- Open BE-25, then take the next unblocked backend task.

## Blocked

- BE-10 waits for the merge of PR #17 / BE-08.

## Needs from

- Lead: provide an unambiguous dev project reference for BE-08 deployment; review BE-25 after it is opened.
