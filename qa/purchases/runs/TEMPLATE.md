# Sandbox purchase run: <YYYY-MM-DD> · <iOS | Android>

Copy to `qa/purchases/runs/<YYYY-MM-DD>-<ios|android>.md`. This file is committed to a **public** repo. No emails, user or couple ids, Apple IDs, passwords, receipts, order ids or tokens: use the labels only (A = buyer, B = partner, C = nothing to restore). Run `check-entitlement.ts A=<email> B=<email>` so its output carries the labels and no ids, and check it before pasting.

- Build: <version (build)> · commit <sha> · EAS profile <profile> · RevenueCat key: sandbox
- Device: <model, OS>
- Supabase: bonded-dev (`nyqbrsqqalygydtwvybb`)
- Store sandbox account: <label only, e.g. "iOS sandbox tester 1">

| # | Case | Expected | Result | Evidence |
|---|---|---|---|---|
| S1 | A buys yearly (trial) from 16 | store sheet shows the trial and the store price; after confirming: 35 "You're both Premium" only after the server row exists | | screenshot names |
| S2 | Server row for A | `check-entitlement.ts`: `is_active: true`, product `yearly_v2`, store `app_store` / `play_store`, `expires_at` ≈ trial end | | output pasted below |
| S3 | B (paired) is premium | B's app: packs open, J8/16 shows "on A's plan", no buy button; `premium_by_app_rule.via_partner: true` | | |
| S4 | B gets partner_premium | one push "You're both Premium" (outside B's quiet hours); tapping opens packs. Known: blocked by #126 until fixed | | |
| S5 | Restore on a second device signed in as A | 16 → Restore → 35 after the server confirms | | |
| S6 | Restore with nothing to restore (fresh sandbox account, signed in as a free test user) | toast "No purchases to restore on this store account.", stays on 16 | | |
| S7 | Payment failed (57) | 57 "Payment didn't go through", "Nothing was charged"; Try again reopens the store sheet; Manage payment method opens the store's subscriptions page | | |
| S8 | Cancel in the store sheet | back on 16, nothing changes, no 57 | | |
| S9 | Cancellation in store settings | stays premium until period end (`is_active: true`, same `expires_at`) | | |
| S10 | Expiry (sandbox renews fast; wait for the last renewal) | `is_active: false` after EXPIRATION; A and B lose premium on next foreground | | |

## check-entitlement output
```
<paste the output of check-entitlement.ts A=... B=...; labels only>
```

## Issues filed
- <#n title>
