# Backend / data developer status

Updated: 2026-11-02 · Branch: `be/BE-04c-hardening` · Milestone: M1

## Resume here

<!-- Keep this current after every step: the next AI starts here. -->
- Last AI / date: Codex · 2026-11-02
- Branch + last commit: `be/BE-04c-hardening`; rebased onto merged BE-06/07/23. SEC-01 R1 remediation is committed locally; status handoff is uncommitted.
- Uncommitted work: this status handoff only.
- Exact next step: commit and force-push this rebase/remediation to PR #1, then update PR #5 with the required QA handoff and rebase it on current main. Do not rebase PR #5 onto PR #1 until PR #1 lands.
- Commands to re-run: `npm --prefix supabase/tests test && node supabase/tests/gen-types.mjs --check && node supabase/scripts/build-seed.mjs --check`; deployed migration state: `supabase db push --project-ref nciyrepyphvksusoigzx --yes`.
- Watch out for: the linked project is `nciyrepyphvksusoigzx`. The CLI calls its environment “production” even though the founder designated this the dev project. Never print or commit secret values.

## Doing

- BE-04c / PR #1: lead-requested rebase complete; SEC-01 R1 fixed by adding the pair-period check to thread, reaction and read-marker RLS, with a pre-hardening-data regression.

## Done

- BE-23 dev deployment unblocked: set a newly generated `INTERNAL_FUNCTION_SECRET` directly in the linked project (not committed or printed); deployed `notify`, `daily-reminder`, `revenuecat`, and `delete-account` stubs.
- Applied nine migrations to project `nciyrepyphvksusoigzx`, through `20261102235000_pairing_hardening.sql`.
- PR #1 security remediations: F2, F4, F5, F8–F12 retained; R1 added. Full PGlite suite and 89-case hardening suite pass.
- BE-06 is merged to main. BE-10 remains blocked on BE-08.

## Next

- Fix PR #5’s requested QA handoff and rebase on latest main; after PR #1 lands, rebase PR #5 again and confirm ended-couple policies retain the `paired_at` boundary.
- Then BE-12 from latest main, per the user’s instruction.

## Blocked

- BE-10 waits for BE-08 (`notify`, `push_log`, quiet-hours/cap infrastructure).

## Needs from

- QA: PR #5 changes unpair to retain two `couple_members` rows with `left_at`, preserves the couple/history for 30 days, and makes it read-only. Update `qa/contract/rpc.test.ts` and `qa/contract/scenarios.test.ts` expectations; this is lead-requested QA-03e work.
- Lead: PR #1 is rebased and now includes SEC-01 R1; PR #5 needs its QA contract update before merge, then must rebase after PR #1 lands.
- Founder: remaining function secrets required before their corresponding integrations are enabled: `REVENUECAT_WEBHOOK_SECRET`, `REVENUECAT_REST_API_KEY`, `EXPO_ACCESS_TOKEN`, and `SENTRY_DSN`. `INTERNAL_FUNCTION_SECRET` is already generated and set remotely.
