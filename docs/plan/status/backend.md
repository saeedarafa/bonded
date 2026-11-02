# Backend / data developer status
Updated: 2026-11-02 · Branch: be/BE-02-error-codes · Milestone: M1

## Resume here
<!-- Keep this current after every step: the next AI (Claude, Codex or Copilot) starts from it. -->
- Last AI / date: Claude Code · 2026-11-02
- Branch + last commit: be/BE-02-error-codes @ "[BE-02] Harness applies Supabase default grants before migrations" (worktree /Users/saeedarafa/dev/bonded-be; no remote)
- Uncommitted work: none
- Exact next step: write supabase/migrations/20261102170000_error_codes.sql (enum public.error_code + private.raise_error + live RPCs redefined with exact codes and restricted grants), then supabase/tests/error-codes.test.mjs
- Commands to re-run: `npm --prefix supabase/tests ci && npm --prefix supabase/tests test` (22 passed); `node supabase/tests/gen-types.mjs --check`
- Watch out for:
  - /usr/bin/git crashes on this Mac: prefix git with DEVELOPER_DIR=/Library/Developer/CommandLineTools
  - no Docker; the Supabase CLI 3.0.0 lives in supabase/tests/node_modules/.bin
  - the harness now grants like Supabase (default privileges before migrations), so a migration's revoke really takes effect in tests

## Doing
- BE-02 error codes: harness grants fixed; next the migration

## Done (since last update)
- [BE-01] Status: merged, types on main (be3ae4e; lead docs follow-up 4ae26b2)

## Next
- BE-02 (error codes), then BE-03, BE-05 (D33: the content loader skips `age_gate = 18+` packs unless CONTENT_INCLUDE_AGE_GATED=true), BE-23

## Blocked
- BE-01 `dev` project part (link, `db push`, deploy): waiting on LEAD-03 (dev project + credentials from the PO)
- BE-01 "`supabase db reset` green in CI": needs CI with Docker (QA, below); can't run locally (no Docker)

## Needs from
- lead:
  - review BE-01. Files outside my ownership: none
  - "Types on `main` for BE-01" once merged (mobile's MOB-06 is waiting)
  - ARCHITECTURE.md lines 26 and 177 still point at `supabase/migrations/0002_ai_phase2.sql`; it is now `supabase/migrations_phase2/0002_ai_phase2.sql`
  - CONTRACTS §1, my agent file and the bonded-db-change skill say `supabase gen types typescript --local > src/types/database.ts`. Proposed wording: "`node supabase/tests/gen-types.mjs` (no Docker), or with the local stack `supabase gen types typescript --local --schema public`". Your call; both give the same public types
- qa (for `.github/workflows/ci.yml`, DB job, Node 24):
  ```
  npm --prefix supabase/tests ci
  node supabase/tests/rls.test.mjs                 # exits 1 on any FAIL
  node supabase/tests/gen-types.mjs --check        # exits 1 if src/types/database.ts is stale
  ```
  Plus a Docker job for the real stack: `supabase/tests/node_modules/.bin/supabase start` then `... db reset` (or the supabase/setup-cli action, version 3.0.0). Cache `supabase/tests/node_modules`
- mobile: once merged, import `Database` from `src/types/database.ts` (public schema only). Don't edit it; ask me for schema changes

## Contract changes in flight
- none (the type-generation command wording is a lead doc change, see above)

## Questions for the product owner
- install Docker Desktop (or Podman) on the dev Mac so `supabase start` / `db reset` can run locally
