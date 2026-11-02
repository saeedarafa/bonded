# Backend / data developer status
Updated: 2026-11-02 · Branch: be/BE-06-streak-v2 · Milestone: M2

## Resume here
<!-- Keep this current after every step: the next AI (Claude, Codex or Copilot) starts from it. -->
- Last AI / date: Codex · 2026-11-02
- Branch + last commit: `be/BE-06-streak-v2` @ `75e1850`; created from `origin/main` @ `4130160`, independent of PR #1 and PR #2.
- Uncommitted work: this status update only.
- Exact next step: commit/push BE-06 and open its PR against `main`; link the new Supabase dev project and deploy BE-23 stubs from its branch; then start BE-07 from the latest `main` without waiting for review.
- Commands to re-run: `npm --prefix supabase/tests test`; `node supabase/tests/gen-types.mjs --check`; `node supabase/scripts/build-seed.mjs --check`.
- Watch out for: no Docker locally; test explicit historical timestamps through an owner/no-JWT insert. Helpers are `private.*`; client inserts cannot control `created_at` or `counts_for_streak`.

## Doing
- BE-06: D17 offline-streak semantics and `get_streak()` complete; 50 focused tests and the full DB suite pass.

## Done (since last update)
- BE-04c hardening: [PR #1](https://github.com/saeedarafa/bonded/pull/1), pending review.
- BE-23 Edge Function foundation: [PR #2](https://github.com/saeedarafa/bonded/pull/2), pending review; its dev deploy remains blocked until LEAD-03 provides the dev project and secrets.

## Next
- BE-07 notification preferences, then BE-09 ended couples and BE-20 history/realtime/storage.

## Blocked
- Real `supabase db reset` needs Docker; CI covers it. The new dev project now unblocks BE-23 deployment; function secrets still need to be set before real callers use the stubs.

## Needs from
- mobile: regenerate types; send `client_written_at` for queued/online daily answers and handle the expanded `get_streak()` state (`completed_today`, `at_risk`, `saver_available`).
- qa: BE-06 adds `streak.test.mjs`; verify real two-session `get_daily_question()` contention in Docker CI (PGlite simulates the race).
- lead: review PR #1 and PR #2 when available; do not wait on them for this BE-06 branch.

## Contract changes in flight
- BE-06: `answers.client_written_at` / server-owned `counts_for_streak`; `get_streak()` is live with composite `streak_state` (mobile + QA acknowledgement requested).

## Questions for the product owner
- None.
