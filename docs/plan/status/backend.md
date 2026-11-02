# Backend / data developer status

Updated: 2026-11-02 · Branch: `be/BE-04c-hardening` · Milestone: M1

## Resume here

<!-- Keep this current after every step: the next AI starts here. -->
- Last AI / date: Codex · 2026-11-02
- Branch + last commit: `be/BE-04c-hardening`; QA-03d is cherry-picked and SEC-01’s final answer-update R1 guard is committed locally.
- Uncommitted work: this status handoff only.
- Exact next step: commit this status update and push PR #1; wait only for its lead merge before rebasing PR #5 onto it. Continue independent BE-12/BE-08 work in separate branches without waiting.
- Commands to re-run: `npm --prefix supabase/tests test && node supabase/tests/gen-types.mjs --check && node supabase/scripts/build-seed.mjs --check`; deployed migration state: `supabase db push --project-ref nciyrepyphvksusoigzx --yes`.
- Watch out for: the linked project is `nciyrepyphvksusoigzx`. The CLI calls its environment “production” even though the founder designated this the dev project. Never print or commit secret values.

## Doing

- BE-04c / PR #1: final lead blockers addressed: QA-03d global-alert contract test and pair-period check on answer updates.

## Done

- BE-23 dev deployment unblocked: set a newly generated `INTERNAL_FUNCTION_SECRET` directly in the linked project (not committed or printed); deployed `notify`, `daily-reminder`, `revenuecat`, and `delete-account` stubs.
- Applied nine migrations to project `nciyrepyphvksusoigzx`, through `20261102235000_pairing_hardening.sql`.
- PR #1 security remediations: F2, F4, F5, F8–F12 retained; R1 includes answers, threads, reactions and read markers. The focused hardening suite passes 89 checks.
- BE-06 is merged to main. BE-10 remains blocked on BE-08.

## Next

- Fix PR #5’s requested QA handoff and rebase on latest main; after PR #1 lands, rebase PR #5 again and confirm ended-couple policies retain the `paired_at` boundary.
- BE-12 and BE-08 from latest main, per the user’s instruction.

## Blocked

- BE-10 waits for BE-08 (`notify`, `push_log`, quiet-hours/cap infrastructure).

## Needs from

- QA: PR #5 changes unpair to retain two `couple_members` rows with `left_at`, preserves the couple/history for 30 days, and makes it read-only. Update `qa/contract/rpc.test.ts` and `qa/contract/scenarios.test.ts` expectations; this is lead-requested QA-03e work.
- Lead: PR #1 now has the QA-03d cherry-pick and the final answer-update R1 guard; please merge on green CI. PR #5 needs its post-merge composition rebase.
- Founder: all listed external function secrets are now configured on the dev project; do not place their values in the repo.
