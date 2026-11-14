# SEC-25: post-merge security review of #491 (MOB-78e, Android "Days together" widget)

- **Reviewed:** merge `6be5246f` on `main` (branch commits `e9ae3898`, `d3038f84`), diff `6be5246f^1..6be5246f`.
- **Mode:** focused guidance (security-audit skill), source only. No Gradle build, kotlinc, Jest, emulator or device was run.
- **Checked against:** `docs/plan/security/SEC-21-widget-auth.md` (MOB-78 checks), the earlier #463/#469/#476/#485 reviews.
- **Verdict: APPROVE (security).** No Critical, High, Medium or Low findings. Four Info items and a device needs_validation list.

## What holds

| Check | Evidence |
|---|---|
| Token storage and reads | The widget never touches the token directly except a null check: `BondedDaysTogether.kt:279` (`WidgetTokenStore.read`, the read-only #469 reader). The only network path is the shared `WidgetClient.state` (`:126`), which sends the token in the Bearer header only. The token is never put in `DaysCache` (`:81-91`). |
| No answer or message text | `DaysCache.fromState` (`:50-65`) copies only `days_together`, `days_in_bonded`, the first `next_key_dates` entry's `kind` (allow-list), `days_until`, `years`, `whose` (allow-list) and `partner_first_name` (trimmed, at most 20 chars). It does not read `today`, `on_this_day`, `question_text` or `last_from_partner`. The key-date `date` and any title are not stored. A test pins this (`androidPremiumPlugin.test.ts`, "allow-listed state fields only"). |
| Receivers not exported | `plugins/widgets/index.js:99` adds `BondedDaysTogetherWidget` to `ANDROID_PREMIUM_RECEIVERS`, and `addWidgetReceivers` (`index.js:676-690`) writes it with `android:exported="false"` and only `APPWIDGET_UPDATE` + `com.hellobonded.widgets.REFRESH`. With `premium: false` it is removed. There is no new action receiver. Tested ("manifest: a private provider ..."). |
| PendingIntents | `open()` (`:168-178`): `ACTION_VIEW` with `setPackage(context.packageName)`, `FLAG_IMMUTABLE`, separate request codes 7810/7811/7812 and distinct URIs. Only `getActivity`; no broadcast PendingIntents (read-only widget). Tested. |
| Backup exclusions | No new secret storage. The token stays in `SecureStore.xml`, which the expo-secure-store rules exclude (`secure_store_backup_rules.xml:6`, `secure_store_data_extraction_rules.xml:7,11`). The new `bonded_widget_days_together` prefs hold no secret (see Info 1). |
| Logs without `bwt_` | No `Log`, `println` or `printStackTrace` in `BondedDaysTogether.kt` (test asserts it). Exceptions are swallowed in the shared `runAsync`. |
| Locked preview for free users | `WidgetClient.state` maps `200 {premium:false}` to `Locked`; the widget clears the cache and draws the lock, "Premium" copy and a CTA to `bonded://paywall?from=widget&widget_kind=days_together` (`:132-135`, `:232-238`). `view_locked` is recorded once per locked spell through the allow-listed `WidgetActionQueue` (`days_together` is in its kinds and in `WIDGET_KINDS`). |
| Lapse and sign-out | Lapse: the next `state` (30 min `updatePeriodMillis`, app `reloadAll`, or a REFRESH after the token is gone) returns `premium:false`, which clears the cache. 401 or no token: `Expired`, cache cleared, "Open Bonded" with no data (`:136-139`, `:239-244`). Sign-out: the app deletes the token then writes the empty snapshot, whose package-scoped REFRESH (`BondedWidgetsModule.kt:51`) reaches this provider; `onReceive` clears and draws "Open Bonded" when the token is gone (`:276-284`). The shared single-thread executor serialises this after any in-flight refresh, so a late `Ok` cannot overwrite the clear. `onDisabled` clears the cache (`:286`). |
| Keyguard | `widgetCategory="home_screen"` only (`bonded_widget_days_together_info.xml:15`); if a host still reports keyguard, the partner's name is not drawn (`:214`, `nextLine`). |

## Info

1. **The widget cache is in Auto Backup.** The library rules include the whole `sharedpref` domain and exclude only `SecureStore`, so `bonded_widget_days_together.xml` (partner first name, days together, days until the next anniversary or the partner's birthday) is backed up to the user's Google account and device transfer. With `days_until` and the backup time, the partner's birthday or anniversary day can be worked out. It is not a secret and it is the user's own data, and #469 Info 2 already accepted the same for `bonded_widget_little_things`. After a restore the widget shows these stale numbers until the first refresh (which then returns 401 → cleared, since the token is not restored). Optional hardening (mobile): exclude `bonded_widget_*` prefs from backup with an extra rule merged into the library XML.
2. **Offline, 429 or 5xx keeps the last view** (`:141`). After a lapse or a server-side revoke with no network, the widget can keep drawing the cached numbers until the next successful call. Display only; same as #476 Info 2.
3. **Read budget.** There are now two premium Android providers and each makes its own `state` call on every `onUpdate`, and `reloadAll` sends one `APPWIDGET_UPDATE` per provider. With the 60 s foreground throttle, two providers can reach the 120 reads/hour token cap (`429`), which then keeps the last view (Info 2). Fails safe; for availability, consider one shared `state` fetch for both providers. More providers (streak, mood, ...) make this worse.
4. **The REFRESH `onReceive` does no network.** A lapse is caught only by the next `state` (up to 30 min, or the next app foreground). Acceptable: SEC-21 says the next read shows the locked preview; the server refuses sends anyway and this widget only reads.

## needs_validation (device, before `premium: true`)

- Merged manifest: `BondedDaysTogetherWidget` is `exported="false"` and is removed when `premium` is off.
- Sign-out with the widget on the home screen: it drops to "Open Bonded" at once, with no partner name or numbers; logcat has no `bwt_`.
- Free and lapsed couples: the locked preview opens the paywall with `from=widget&widget_kind=days_together`.
- `adb shell bmgr` backup/restore: `SecureStore.xml` is left out; the restored widget clears to "Open Bonded" after its first refresh.
- The `BondedDaysTogether.kt` code has not been built with Gradle (the PR says kotlinc typecheck only).
