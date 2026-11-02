# Agent Brief — Backend (Edge Functions)

**You own:** `supabase/functions/**` and §3, §5 and the BE parts of §6–7 of `docs/CONTRACTS.md`.
**Do not edit:** migrations, seed, app code. If you need a DB change (a column, an RPC, a grant), ask the DB agent through a note in the CONTRACTS change log.

**Read first:** `docs/ARCHITECTURE.md` §4, `docs/CONTRACTS.md` (all of it), `docs/FEATURES.md` F08, F09, F13, F14, F15.

**Stack:** Supabase Edge Functions (Deno + TypeScript), `@supabase/supabase-js` with the service role, the Expo Push HTTP API (`https://exp.host/--/api/v2/push/send`), RevenueCat webhooks, Sentry for Deno.

There is no general API server. The app talks to Postgres directly; you only build the four functions below. Business rules live in the database, so don't re-implement them here.

## Tasks

### M1 — Foundations
1. `supabase/functions/_shared/`:
   - `admin.ts`: service-role client.
   - `auth.ts`: `requireInternalSecret(req)` and `requireUser(req)` (verifies the JWT and returns the user id).
   - `http.ts`: JSON responses and the CONTRACTS §3 error shape.
   - `push.ts`: sends in batches of up to 100, collects tickets, returns invalid tokens.
   - `log.ts`: Sentry plus structured logs, **never** answer or message text.
2. Stub all four functions, returning `200` with the correct auth checks. Deploy them to `dev`.
3. Set the secrets on `dev` (CONTRACTS §7). Give the DB agent the functions URL and `INTERNAL_FUNCTION_SECRET` so they can put them in Vault.
4. CI: `deno lint`, `deno check`, and `deno test` on every PR.

### M3 — Notifications (F08, F09)
5. **`notify`**, input as in CONTRACTS §4:
   - `answer_created` → load the couple question and its `answer_count`. If it's 1, send `partner_answered` to the partner; if it's 2, send `both_answered` to **both** partners.
   - `message_created` → `thread_message` to the partner. The body preview is the first 80 characters, **only inside the push itself**; never logged.
   - Targets come from `push_targets_for_partner_of(actor)` (DB helper). Delete tokens Expo reports as `DeviceNotRegistered`.
   - Collapse: an answer that is edited doesn't notify again (inserts only, guaranteed by the DB trigger).
   - Must answer in under 3 seconds; send asynchronously if needed.
6. **`daily-reminder`**: call `due_reminders(now())`, send `daily_reminder` ("Today's question is waiting" / "{partner} already answered — your turn"), insert `reminder_log` rows. Must be safe to run twice in the same window (no duplicate pushes).
7. Tests: unit tests for the message-building and branching logic using fake DB rows. Then an integration run on `dev` with the DB seed couple and a real Expo Go device token.

### M4 — Subscriptions and account (F13, F14)
8. **`revenuecat`**:
   - Verify the `Authorization` header.
   - Map `INITIAL_PURCHASE`, `RENEWAL`, `PRODUCT_CHANGE`, `UNCANCELLATION`, `NON_RENEWING_PURCHASE` → active. Map `EXPIRATION` → inactive. `CANCELLATION` stays active until `expiration_at_ms`. `BILLING_ISSUE` stays active until expiry (grace period). `TRANSFER` → move the entitlement between the two `app_user_id`s.
   - Upsert into `entitlements` (`user_id = app_user_id`). Ignore events older than the stored `updated_at` (out-of-order delivery).
   - Ignore anonymous RevenueCat ids (`$RCAnonymousID:*`) with `200` + a log line.
   - Tests: a fixture for each event type.
9. **`delete-account`**: `requireUser` → `auth.admin.deleteUser(uid)`; the DB cascades the rest. Return `200`. Optional: call the RevenueCat REST API to delete the subscriber.

### M5 — Launch (F15)
10. Sentry on all functions; alert on `notify` error rate > 5% and on any `revenuecat` 5xx.
11. Deploy to `prod`, set prod secrets, point the RevenueCat production webhook at the prod `revenuecat` function, then send a test event.
12. Short runbook `supabase/functions/README.md`: deploy commands, secrets, how to replay a RevenueCat event, how to test a push.

### Phase 2 (after launch)
`ai-worker` (claims `ai_jobs` in batches → LLM with a JSON-schema response → `answer_signals`) and `weekly-report`. Design rules: ARCHITECTURE §6.

## Definition of done
- Function deployed to `dev`; tests pass; the CONTRACTS section is accurate.
- Errors use the shared error shape. No user content in logs.
- Safe to retry: every function can receive the same input twice without side effects being doubled.
