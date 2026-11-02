---
name: bonded-edge-function
description: Build or change a Bonded Supabase Edge Function (Deno + TypeScript), such as notify, daily-reminder, revenuecat, delete-account or offers. Covers the shared helpers, auth, error shape, idempotency, push caps and quiet hours, secrets, tests and deployment. Use for any work in supabase/functions.
---

# Bonded edge functions

There is no general API server. Functions exist only for things Postgres can't do alone: sending pushes, receiving webhooks, admin deletes, and scheduled jobs. Business rules stay in SQL; a function calls RPCs and helpers rather than re-implementing them.

## 1. Layout
```
supabase/functions/
  _shared/admin.ts     service-role client (SUPABASE_SERVICE_ROLE_KEY from env)
  _shared/auth.ts      requireInternalSecret(req), requireUser(req) -> userId
  _shared/http.ts      json(data, status), error(code, message, status)   // CONTRACTS §3 shape
  _shared/push.ts      sendExpoPush(messages) in batches of 100 -> { tickets, invalidTokens }
  _shared/rules.ts     canSend(userId, type, now): cap 4/day, per-type caps, quiet hours, 5-min grouping
  _shared/log.ts       structured logs + Sentry; redact(); never user text
  notify/index.ts  daily-reminder/index.ts  revenuecat/index.ts  delete-account/index.ts  offers/index.ts
  */index_test.ts      deno tests next to each function
```

## 2. Auth per caller (CONTRACTS §3)
| Caller | Check |
|---|---|
| DB trigger via `pg_net`, `pg_cron` | `Authorization: Bearer ${INTERNAL_FUNCTION_SECRET}`, compared in constant time |
| RevenueCat | `Authorization: Bearer ${REVENUECAT_WEBHOOK_SECRET}` |
| App | user JWT through `requireUser`; act only on that user's id |

Reject with `401 {error:'UNAUTHORIZED'}`. In `config.toml`, set `verify_jwt = false` only for the webhook and internal functions, and verify those yourself.

## 3. Idempotency (every function)
- `notify`: dedupe on `(record_id, type)` in `push_log` before sending.
- `daily-reminder`: `reminder_log (user_id, local_date)` primary key; insert before send, `on conflict do nothing`, send only if inserted.
- `revenuecat`: ignore events older than the stored `entitlements.updated_at`; upsert by `user_id`; replaying an event is a no-op.
- `delete-account`: deleting an already-deleted user returns `200`.

## 4. Notification rules (D23–D25, `supabase/content/notifications.json`)
- Types: `ritual_reminder`, `partner_answered`, `both_answered`, `thread_activity` (replies and reactions, grouped within 5 min), `last_call` (22:30 local, streak ≥3 at risk), `nudge`, `partner_joined`, `partner_premium`, `weekly_recap`; `celebration` is P2.
- Before sending, check `notification_prefs` toggles, quiet hours (default 23:00–07:00 local), at most 4 pushes per person per local day, and per-type caps. Record every send in `push_log` (type, local date, no text).
- Copy templates live in `notifications.json`. Fill only names and the 80-character preview; the preview exists only inside the push payload.
- Payload `data` = `{ type, url }` per CONTRACTS §5. Delete tokens Expo reports as `DeviceNotRegistered`.
- `notify` must return within 3 s. Do the work with `EdgeRuntime.waitUntil` if needed.

## 5. RevenueCat mapping
`INITIAL_PURCHASE`, `RENEWAL`, `PRODUCT_CHANGE`, `UNCANCELLATION`, `NON_RENEWING_PURCHASE` → active. `CANCELLATION` and `BILLING_ISSUE` stay active until `expiration_at_ms`. `EXPIRATION` → inactive. `TRANSFER` → move between the `app_user_id`s. `$RCAnonymousID:*` → `200` plus a log line, no write. When a user becomes active and the partner wasn't premium → `partner_premium` push. Fixtures: `qa/fixtures/revenuecat-events.json`.

## 6. Secrets (CONTRACTS §7)
Set them with `supabase secrets set --env-file supabase/functions/.env` (never commit `.env`; keep `.env.example` current). The functions URL and `INTERNAL_FUNCTION_SECRET` also go into Vault so triggers and cron can call functions; tell the lead when they change.

## 7. Tests
- Pure logic (copy building, rules, event mapping) is a pure function with unit tests using fake rows and a fixed clock.
- Handler tests: build a `Request`, stub the admin client and `fetch` (Expo, RevenueCat), and assert the response, the DB calls and the push batch.
- Run:
  ```bash
  deno lint supabase/functions && deno check supabase/functions/**/index.ts && deno test -A supabase/functions
  ```
- Integration on `dev`: seed the "streak-11-waiting" couple, insert an answer as Sam, and see one push on a device with Expo Go or a dev build.

## 8. Deploy
- `dev`: `supabase functions deploy <name> --project-ref $DEV_REF`.
- `prod`: only at a milestone merge approved by the lead.
- Update the runbook in `supabase/functions/README.md`: deploy, secrets, replaying a RevenueCat event, sending a test push.
