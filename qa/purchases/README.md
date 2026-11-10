# Purchase tests (QA-06)

What is automated, and how the product owner runs the real store sandbox checks later. CONTRACTS §6 is the rule: the app shows premium only from the server's `entitlements` rows (mine, or my **current** partner's, active and unexpired); the RevenueCat SDK's customer info only triggers a refetch.

## Automated (every PR)

| Layer | File | What it covers | CI job |
|---|---|---|---|
| Webhook + partner premium, over HTTP on the local stack | `qa/contract/purchases.test.ts` with `qa/contract/purchase-harness.ts` and `qa/functions/purchase_harness.ts` | One case per event in `qa/fixtures/revenuecat-events.json` (resulting `entitlements` row); idempotency (same event id = one effect); ordering (an older EXPIRATION after a RENEWAL does not revoke); bad/missing auth = 401 before any lookup or write; anonymous, unknown and non-UUID users; unsupported types; RevenueCat lookup failure = retryable 500 with no write; partner premium by the server rules (packs gate, app rule, former partner, expiry, billing grace); `partner_premium` dispatched once, delivered to the partner with the approved copy and `bonded://packs`, quiet hours, 1/day type cap, 4/day cap | `db-reset` |
| App (Jest) | `qa/app/purchases.test.tsx` (`qa/app/jest.config.js`) | Paywall 16 with the real Supabase client, premium api and hooks against a fake PostgREST server: restore (success, nothing to restore, partner landed meanwhile, expired row, former partner, errors), payment failed 57 for each store refusal code, Try again, Manage payment method, cancel, ask-to-buy, and 35 only after the server row is read | `app` |
| Function units | `supabase/functions/revenuecat/index_test.ts` (backend) | Snapshot logic with a fake admin client | `functions` |

The harness runs the **real** `revenuecat` and `notify` handlers (real secrets check, real service-role client, real SQL). Only two things are faked: the RevenueCat REST API (`/v1/subscribers/<id>`, set per test) and Expo push delivery (captured). The database's push dispatch goes through real pg_net and Vault (`functions_url`, `internal_function_secret`) to the harness.

Run locally (Docker, Deno, an **isolated** stack; never the shared `bonded` one while an app is signed in to it):
```bash
# a scratch copy of supabase/ with its own project_id and ports, then:
supabase start --workdir <scratch>
SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_DB_URL=... \
  npm --prefix qa/contract test -- purchases.test.ts
npx jest -c qa/app/jest.config.js
```
The contract test creates `pg_net` if missing (and drops it again) and removes its Vault secrets at the end.

#126 (`dispatch_notify` sent the notify secret as URL query parameters, so notify answered 401 to every database push) is fixed by BE-37: the test "the database's notify request authenticates and is delivered" checks the database's own request (bearer header, no query string) and every delivery, quiet-hours and cap case asserts notify's answer to that request. `h.replay` is only used for a retry of an already delivered dispatch. One case calls `private.dispatch_daily_reminders()` and checks the same transport (the harness records it and answers 200; the daily-reminder handler itself is not run).

## Store sandbox runs (product owner, later)

Needs ACCOUNTS rows 8 (RevenueCat) and 9 (App Store Connect / Play products, sandbox and license testers), a build with the RevenueCat **sandbox** public key, pointing at **bonded-dev** (`nyqbrsqqalygydtwvybb`). Never production (`nciyrepyphvksusoigzx`): `check-entitlement.ts` refuses it. No credentials go into the repo: sandbox Apple IDs, Play license testers and the dev service-role key stay in the PO's password manager.

### Accounts
- **iOS:** App Store Connect → Users and Access → Sandbox → Testers: create two sandbox Apple IDs (A buyer, C "nothing to restore"). On the device: Settings → App Store → Sandbox Account, sign in as A (do not use a real Apple ID). Sandbox renewals are fast (a yearly renews about every hour; a 7-day trial lasts minutes), which is how S9/S10 are reached in one session.
- **Android:** Play Console → Settings → License testing: add the tester Google accounts; join the internal testing track with them and install from it. The test payment methods include "Test card, always approves" and "Test card, always declines" (use the second for 57).
- **App accounts (bonded-dev):** two app test users paired with each other (A and B) plus one free unpaired user (C). Use test addresses only.

### Steps
1. Install the sandbox build; sign in as A on device 1 and B on device 2 (paired). Check both are free: `node qa/purchases/check-entitlement.ts <A> <B>`.
2. **S1 buy:** on A, `maestro test -e RESULT=success .maestro/purchases/paywall-sandbox.yaml` and confirm the store sheet by hand. The sheet must show the store's price and trial (never an app-made price). 35 appears only after the server row exists; if it says "Premium can take a minute", tap Check again.
3. **S2/S3 server and partner:** `check-entitlement.ts <A> <B>`: A `is_active: true`, product `yearly_trial`, store `app_store` or `play_store`; B `premium_by_app_rule.via_partner: true`. On B: packs open, no buy button, "on A's plan".
4. **S4 push:** B receives one "You're both Premium" outside quiet hours; tapping opens packs.
5. **S5 restore:** sign in as A on another device (or reinstall), `maestro test -e RESULT=restored .maestro/purchases/restore-sandbox.yaml`.
6. **S6 nothing to restore:** sign in as C with store sandbox account C, `-e RESULT=nothing` on the restore flow: a toast, stays on 16.
7. **S7 payment failed (57):** Android: choose "Test card, always declines" in the Play sheet; iOS: use a sandbox tester with interrupted purchases on (App Store Connect → Sandbox → tester → Interrupt purchases) or an invalid payment method. `-e RESULT=failed` on the paywall flow. Check Try again and Manage payment method.
8. **S8 cancel** the store sheet: back on 16, nothing changes.
9. **S9/S10:** cancel the subscription in the store's sandbox subscription settings; A stays premium until the period ends; after the last sandbox renewal lapses, `check-entitlement.ts` shows `is_active: false` and both apps lose premium on the next foreground.

### Evidence
Copy `qa/purchases/runs/TEMPLATE.md` to `qa/purchases/runs/<YYYY-MM-DD>-<ios|android>.md`, fill the table and paste the `check-entitlement.ts` output. Maestro screenshots (`qa06-*.png`, in the folder Maestro prints) go on the PR or issue, not in the repo, and must not show emails or order ids. Bugs: GitHub issues titled `[SCR-16] …` / `[BE-18] …` with the run file linked.
