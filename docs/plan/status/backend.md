# Backend / data developer status

Updated: 2026-11-02 · Branch: `be/BE-09-ended-couples-v2` · Milestone: M2

## Resume here

- Last AI / date: Codex · 2026-11-02
- Branch + last commit: `be/BE-09-ended-couples-v2`, rebased onto current `origin/main`; BE-09 code is committed and this handoff is uncommitted.
- Uncommitted work: this status handoff only.
- Exact next step: fetch and create `be/BE-12-badges-v2` from latest `origin/main` (BE-06 is merged); build BE-12 without waiting for PR reviews. PR #5 still needs its post-PR-1 compatibility rebase before merge.
- Commands to re-run: `npm --prefix supabase/tests test && node supabase/tests/gen-types.mjs --check && node supabase/scripts/build-seed.mjs --check`.
- Watch out for: BE-09 currently follows main, not unmerged PR #1. Do not merge it until rebased after #1 and pairing-period compatibility is verified.

## Doing

- BE-09 / PR #5: rebased on BE-06/07/23 and awaiting QA-03e contract-test update plus the post-PR-1 rebase.

## Done

- BE-09 preserves a read-only ended-couple archive for 30 days, permits re-pairing, and schedules hosted purge; PGlite coverage included.
- BE-10 remains blocked by BE-08.

## Next

- BE-12 badges from latest main; do not wait for PR #1/#5 reviews.

## Blocked

- BE-10 waits for BE-08 notification infrastructure.

## Needs from

- QA (lead-requested QA-03e): update `qa/contract/rpc.test.ts` expectation from immediate deletion to `status='ended'` with both member rows timestamped; update `qa/contract/scenarios.test.ts` partner-left expectation from one member row to two `left_at` rows, and validate former partners can read but not write for 30 days.
- Lead: re-review PR #5 after the QA update. Once PR #1 lands, request the final rebase that confirms `paired_at` pair-period controls and ended-archive policies compose safely.
