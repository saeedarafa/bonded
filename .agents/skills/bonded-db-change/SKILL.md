---
name: bonded-db-change
description: Make a safe change to Bonded's Supabase Postgres database. Covers new migrations, RLS policies, SECURITY DEFINER RPCs with error codes, triggers, realtime, seed and content loading, tests, type generation and contract updates. Use for any schema, policy, RPC or seed change, and when reviewing one.
---

# Changing the Bonded database

The app talks to Postgres directly with the user's JWT. **RLS and RPCs are the only security layer.** A bug here is a data leak between couples.

## 1. Before writing SQL
- Find the decision you're implementing (`docs/plan/DESIGN_DELTA.md`, `Dnn`) and the contract row (`docs/CONTRACTS.md` §2).
- Read the existing objects you touch in `supabase/migrations/`. The RLS helpers live in the `private` schema (BE-24, not callable as RPCs): `private.my_couple_id()`, `private.is_cq_member()`, `private.has_answered()`, `private.both_answered()` and `private.is_couple_premium()`. Reuse them, schema-qualified.

## 2. Migration rules
- New file: `supabase/migrations/<YYYYMMDDHHMMSS>_<slug>.sql` (`supabase migration new <slug>`). **Never edit a migration that's on `main`.**
- Every new table: `alter table … enable row level security;` in the same file, plus explicit policies for each operation the client needs. No policy = no access (good default).
- Revoke what the client must not do: `revoke insert, update, delete on public.entitlements from authenticated, anon;`
- Functions:
  ```sql
  create or replace function public.accept_invite(p_code text)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
  as $$
  begin
    if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
    ...
  end $$;
  revoke all on function public.accept_invite(text) from public, anon;
  grant execute on function public.accept_invite(text) to authenticated;
  ```
- Errors: the exception message is **exactly** a code from CONTRACTS §2. A new code goes into the contract in the same PR.
- Concurrency: lock the parent row (`select … for update`) when two partners can race (daily question, answer count, streak), or rely on unique constraints plus `on conflict do nothing`.
- Time:
  - compute "today" in the couple's timezone (`(now() at time zone c.timezone)::date`);
  - store `timestamptz` in UTC;
  - functions that depend on time take an optional `p_now timestamptz default now()` so tests can pin the clock.
- Anything callable by `anon` (for example `invite_preview`):
  - return the minimum fields;
  - rate-limit it;
  - get a security review before merge.
- Realtime: add a table to `supabase_realtime` only if the app subscribes to it (CONTRACTS §2). RLS applies to the events.

## 3. Seed and content
- Content (questions, packs, badges, special questions) comes from `supabase/content/*.csv` through the idempotent loader. Re-running it never duplicates rows (upsert on a natural key such as `slug` or `external_id`).
- `supabase/seed.sql` = content plus the persona scenarios in `qa/fixtures/personas.json` (local and `dev` only, never prod). Test users are created in `auth.users` with fixed UUIDs from the personas file.

## 4. Tests (required for every change)
- Add behaviour tests in `supabase/tests/`:
  - the PGlite harness (`rls.test.mjs`), which runs as `authenticated` with `request.jwt.claim.sub` set;
  - or pgTAP (`supabase test db`).
- For each new rule, test:
  1. the happy path as a member;
  2. the same call as the **other couple's** user (must fail or see nothing);
  3. as `anon`;
  4. each error code;
  5. a retry (idempotency);
  6. boundaries (500 chars, 48 h expiry, 30-day purge, timezone midnight).
- The reveal-rule tests must still pass.
- Run:
  ```bash
  supabase db reset && node supabase/tests/rls.test.mjs supabase/migrations/*.sql
  ```
  or `supabase test db`.

## 5. After the SQL works
1. `node supabase/tests/gen-types.mjs` (no Docker; `--check` fails if stale), or `supabase gen types typescript --local --schema public` on the local stack, and commit `src/types/database.ts`.
2. Update CONTRACTS §2 (RPC table, direct access, realtime) plus a change-log row.
3. Mark the DESIGN_DELTA row for the lead (`done (BE-xx)` request in your status file).
4. Post under *Needs from mobile / qa* when consumers must react.

## 6. Review checklist (also used by the lead, QA and security)
- [ ] RLS enabled on every new table; policies scoped through `private.my_couple_id()` or ownership.
- [ ] No policy uses `true` for `select` on couple data.
- [ ] `SECURITY DEFINER` functions set `search_path`, check `auth.uid()`, and have grants restricted.
- [ ] No way to read a partner's answer before answering (direct select, RPC return, realtime payload, view).
- [ ] Error messages are codes only (no data in messages).
- [ ] Indexes for new foreign keys and query paths.
- [ ] Destructive changes are backward compatible with the currently shipped app version (add, then migrate, then remove later).
