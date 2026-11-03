# Backend / data developer status

Updated: 2026-11-03 · Branch: `be/BE-08-notify-v2` · Milestone: M3

## Resume here

- Last AI / date: Codex · 2026-11-03
- Branch + last commit: `be/BE-08-notify-v2` @ this verification handoff commit.
- Uncommitted work: none.
- Exact next step: force-push PR #17 with lease protection, check its CI and lead review, then take BE-10 after it merges. Address BE-25 / PR #21 review feedback while BE-08 awaits merge.
- Commands to re-run: `npm --prefix supabase/tests test`; `SUPABASE_TELEMETRY_DISABLED=1 node supabase/tests/gen-types.mjs --check`; `node supabase/scripts/build-seed.mjs --check`; `deno lint supabase/functions`; `deno check supabase/functions/notify/index.ts`; `deno test -A supabase/functions`.
- Watch out for: `public.claim_push` is service-role-only; it is the PostgREST wrapper over the locked private implementation. The full PGlite suite may take more than this shell's 30-second window; the BE-08-specific ledger, notifications, and hardening suites passed on 2026-11-03.

## Doing

- BE-08 / PR #17: review fixes are verified on `origin/main`; force-push and CI/re-review next.

## Blocked

- Dev deployment is blocked because the linked Supabase project is explicitly labelled production by the CLI.
- BE-10 waits for BE-08 to merge.

## Needs from

- Lead: merge PR #17 on green CI and identify an unambiguous dev project for deployment.
