# Backend / data developer status
Updated: 2026-11-02 · Branch: be/BE-23-functions · Milestone: M1

## Resume here
<!-- Keep this current after every step: the next AI (Claude, Codex or Copilot) starts from it. -->
- Last AI / date: Codex · 2026-11-02
- Branch + last commit: `be/BE-23-functions`, latest BE-23 handoff commit pushed; [PR #2](https://github.com/saeedarafa/bonded/pull/2).
- Uncommitted work: none after this status commit.
- Exact next step: deploy the four stubs to the new dev project after the product owner supplies a Supabase access token with `project_admin_read` and `edge_functions_write`; continue BE-07 now without waiting. Re-run `bash qa/ci/functions.sh` before handoff.
- Commands to re-run: `bash qa/ci/functions.sh`; `npm --prefix supabase/tests ci && npm --prefix supabase/tests test`; `node supabase/tests/gen-types.mjs --check`; `node supabase/scripts/build-seed.mjs --check`.
- Watch out for: `deno.json` uses `nodeModulesDir: auto`; its `node_modules/` is ignored, while `deno.lock` is committed. Git needs `DEVELOPER_DIR=/Library/Developer/CommandLineTools`; no AI attribution in commits or PRs.

## Doing
- BE-23: `_shared` admin/auth/http/log/push helpers; authenticated stubs for `notify`, `daily-reminder`, `revenuecat` and `delete-account`; six Deno tests pass; PR #2 awaits review and dev deployment.

## Done (since last update)
- BE-01, BE-02, BE-03, BE-04, BE-05 and BE-24 are now on `main`.
- BE-04c pairing hardening is pushed as [PR #1](https://github.com/saeedarafa/bonded/pull/1), awaiting lead and SEC-01 review.

## Next
- BE-06 streak v2, then BE-07 notification preferences and BE-09 ended couples.

## Blocked
- BE-23 dev deployment: project `nciyrepyphvksusoigzx` now exists, but `supabase link`/function deploy requires a Supabase access token with `project_admin_read` and `edge_functions_write`. The supplied database password cannot authorize the management API. No production deployment is authorized.
- Local `supabase db reset` needs Docker; CI covers it.

## Needs from
- lead: review PR #1 and route it to SEC-01. Provide LEAD-03 dev-project access so BE-23 can deploy its stubs.
- qa: `supabase/functions/deno.json` now activates the `functions` CI job; it runs the shared/stub Deno tests.
- mobile: no BE-23 API change.

## Contract changes in flight
- None. BE-23 supplies the authenticated implementation foundation for the already-planned §3 functions.

## Questions for the product owner
- None.
