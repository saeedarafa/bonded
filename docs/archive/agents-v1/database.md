# Agent Brief — Database

**You own:** `supabase/migrations/`, `supabase/seed.sql`, `supabase/tests/`, `supabase/config.toml`, `src/types/database.ts` (generated), and §2 and §4 of `docs/CONTRACTS.md`.
**Do not edit:** `app/`, `src/` (except the generated types), `supabase/functions/`.

**Read first:** `docs/ARCHITECTURE.md` (§3 and §6), `docs/CONTRACTS.md`, `docs/FEATURES.md`.

## Starting point
- `supabase/migrations/0001_mvp.sql` already contains the tables, RLS, pairing/daily/pack RPCs, the streak trigger and the realtime publication.
- `supabase/tests/rls.test.mjs` already passes 23 behaviour tests (PGlite).
- `0002_ai_phase2.sql` is **Phase 2**: move it to `supabase/migrations_phase2/` so it isn't applied with the MVP.
- Treat `0001` as already shipped once M1 merges: add **new** migrations from then on and never edit an applied one.

## Tasks

### M1 — Foundations (unblocks everyone; do first)
1. Link the Supabase `dev` project; apply `0001`; generate and commit `src/types/database.ts`. **Tell FE and BE as soon as the types are on `main`.**
2. `0003_error_codes.sql`: replace the exception messages with the codes in CONTRACTS §2 (`NOT_AUTHENTICATED`, `ALREADY_PAIRED`, `INVALID_CODE`, `OWN_CODE`, `NOT_PAIRED`, `LIBRARY_EXHAUSTED`, `PREMIUM_REQUIRED`). Update the tests.
3. `seed.sql`: 30 placeholder daily questions (categories × depths), 3 packs × 5 questions (1 free, 2 premium), and 2 test users already paired, for local development.
4. Port `supabase/tests/rls.test.mjs` to run in CI (keep PGlite, or switch to pgTAP with `supabase test db`; your call). Must run on every PR.

### M2 — Core loop (F02–F07)
5. `get_streak()`: returns current = 0 when `last_completed_on < today - 1` in the couple's timezone (F10, but FE needs it on Today in M2).
6. `unread_thread_counts()`: per couple question, the count of partner messages newer than my `thread_reads.last_read_at` (F06).
7. Add `couple_members` to the `supabase_realtime` publication (FE uses it to detect the partner joining).
8. Profile timezone validation: a check constraint that `timezone` is a valid `pg_timezone_names` entry (invalid timezones would break `get_daily_question`).
9. Tests for 5–8, plus concurrency: both partners call `get_daily_question()` at the same time → one row.

### M3 — Notifications, streak, history (F08–F11)
10. `push_targets_for_partner_of(p_user uuid)` (service role only; revoke from `authenticated`).
11. Triggers on `answers` / `thread_messages` insert → `pg_net` POST to `{functions_url}/notify` with the CONTRACTS §4 payload. Read URL and secret from **Vault**. Ensure an error in the HTTP call can never fail the user's insert.
12. `reminder_log (user_id, local_date)` primary key, plus `due_reminders(p_now timestamptz)` → users whose `reminder_time` falls in the current 15-minute window in their timezone, who haven't answered today and have no log row. BE calls it and then inserts the log rows.
13. `pg_cron` job: every 15 minutes → POST `{functions_url}/daily-reminder`.
14. Index review for history: `couple_questions (couple_id, created_at desc)`; `answers (couple_question_id)` is covered by the unique index.

### M4 — Premium and account (F12–F14)
15. Storage: `avatars` bucket; policies: write own path `{uid}/*`, read own + partner.
16. Revoke client writes on `entitlements` (it must stay service-role only) and add a test proving it.
17. Account deletion: confirm the cascade from `auth.users` removes profile, membership, answers and messages. If the partner remains, the couple is deleted too (same as `unpair`). Add a test.

### M5 — Launch (F16)
18. Content loader: `supabase/content/questions.csv` (body, category, depth, is_premium, pack_slug, position) → an idempotent import script. You don't write the content; the product owner does.
19. Run the Supabase security and performance advisors on `dev`; fix findings; apply all migrations to `prod`.

### Phase 2 (after launch, not now)
Move `0002_ai_phase2.sql` back into `migrations/`, switch to the real pgvector type, add the `ai_jobs` claim function (`FOR UPDATE SKIP LOCKED`), and add consent-revocation cleanup.

## Definition of done (every task)
- New migration file; nothing destructive to applied migrations.
- Tests added and passing; `supabase db reset` from scratch works.
- Types regenerated if the schema changed.
- CONTRACTS.md updated plus a change-log line if any signature changed.

## Guardrails
- Every new table: RLS enabled in the same migration. `SECURITY DEFINER` functions always `set search_path`.
- The reveal rule (a partner's answer is invisible until you've answered) must keep a passing test at all times. Treat it as a release blocker.
