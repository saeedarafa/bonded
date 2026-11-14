# Widget device checks (QA-49)

Contract half: `qa/contract/widgets.test.ts` (TEST_PLAN D59). Device half: this folder.
Evidence goes in `evidence/<date>/` (screenshots and DB rows only: no answer text, no token, no hash).

| Part | Platform | State |
|---|---|---|
| QA-49b | Android, emulator-5554 | **pass** 2026-11-14 (`evidence/2026-11-14/android-*.png`; recipe in `docs/plan/status/qa.md`, QA-49b session) |
| QA-49c | iOS, REL-A | **pass except the leak check** 2026-11-14 06:38-07:45 (Debug premium build, stack `qa49c`): token minted + read, send, Undo, undo expired 409, limit 409, lapse -> locked + paywall URL, sign-out -> revoked + keychain 0. Leak check **fails**: the app's NSURLCache (`Library/Caches/com.hellobonded.app/Cache.db`) keeps the `mint_widget_token` response (the token), the auth session and answer/message bodies (see "QA-49c results"). Evidence `evidence/2026-11-14/ios-*` |
| QA-49d | iOS REL-A + Android emulator-5554 | **pass** 2026-11-14 08:49-09:43 (Debug builds of main 9aa9e916): #479 / MOB-89 URL cache fixed on both, MOB-78c lapse redraw on foreground works on Android. See "QA-49d results". Evidence `evidence/2026-11-14d/` |
| QA-49e | iOS REL-A | 2026-11-14 09:46-10:25 (Debug build of main 08819962 with MOB-78d + BE-65): send, Undo, lapse -> locked on foreground **pass**; silent `widget_refresh` push: no banner/list **pass**, background mint **not testable on the simulator** (see "QA-49e results"). Evidence `evidence/2026-11-14e/` |
| QA-49f | Android, emulator-5554 | 2026-11-14 10:54-11:45 (Debug build of main 5ab1ef2d with MOB-78e, `premium: true`): Gradle build **pass**; Days together picker, no token, premium count (2 x 2, 4 x 2, 4 x 1), no key dates, lapse -> locked -> paywall, renewal, sign-out **pass**; 4 x 1 clips the CTA, 4 x 2 shows one key date, Add dates / tap has no key dates screen to open (see "QA-49f results"). Evidence `evidence/2026-11-14f/` |
| QA-49g | Android, emulator-5554 | 2026-11-14 11:50-12:35 (Debug build of PR #499 `mobile/MOB-78f-android-streak` 274b022e, `premium: true`): re-check of #495-#498 **pass**; Streak picker, 2 x 2 / 4 x 2 / 4 x 1, locked -> paywall, prefs, 0 `bwt_` **pass**. One sev-4 finding: saving key dates in 47 does not refresh the widget (see "QA-49g results"). Evidence `evidence/2026-11-14g/` |
| QA-49h | Android, emulator-5554 | 2026-11-14 13:08-13:17 (Debug build of PR #507 `mobile/MOB-78h-widget-backup` be6f8407, `premium: true`): backup rules (SEC-25 Info 1) **pass**: prebuild without a secure-store backup warning, merged manifest points at the `bonded_*` rules, `assembleDebug` + backup lint green, `bmgr backupnow` (local transport) leaves out `SecureStore.xml` and every `bonded_widget*.xml` (see "QA-49h results"). Evidence `evidence/2026-11-14h/` |
| founder | real iPhone | unlock prompt, locked keychain, redaction, silent push wakes the app (list at the end) |

## Helpers

- `ios-leak-check.sh <udid> [2h]`: counts `bwt_` in the simulator's unified log, the App Group
  container (incl. `Library/Preferences/group.com.hellobonded.app.plist`, keys printed), the app data
  container and the extension's PluginKit container; prints how many keychain items are in the
  `*.com.hellobonded.app.widget` access group (1 signed in, 0 after sign-out). Never prints a match.
- `db-check.sh <db container>`: Maya's widget tokens (lifetime, revoked, last used), usage counters,
  little_things rows (`source`, `undone`), entitlements. Never prints a token or hash.
- `android-cache-check.sh [serial]`: counts files and response bodies in the app's OkHttp
  `cache/http-cache`, cached Supabase responses (URL path only) and `bwt_` tokens in the app data dir
  (Debug build, `run-as`). Never prints a body.
- `flows/sign-out.yaml`: signs out through `bonded://us` (iOS and Android dev-client builds).
- `flows/ios-add-little-things.yaml`: DRAFT Maestro flow that places the widget through SpringBoard
  (never run). If it misses, place the widget by hand once.

## QA-49c recipe (REL-A only)

```bash
UDID=E90AE3CD-873E-4237-89DC-5211A5D03243      # REL-A. Never create or delete simulators.
xcrun simctl list devices booted; adb devices  # REL-B / emulator-5554 may belong to other agents
W=$PWD                                         # the qa worktree, on origin/main
```

1. **Isolated stack `qa49c`** (never the `bonded` stack on 54321 or another agent's):
   copy `supabase/` to `$TMPDIR/qa49c-sb/supabase`, set `project_id = "qa49c"` and the ports
   api 57521, db 57522, shadow 57520, pooler 57529, studio 57523, local_smtp 57524 in its
   `config.toml`; `supabase start --workdir $TMPDIR/qa49c-sb` (it applies all migrations and the
   seed: no `db reset` needed; `-x studio,vector,logflare,imgproxy,postgres-meta` saves memory),
   `docker exec -i supabase_db_qa49c psql -U postgres -c "select dev_seed.apply_scenario('premium-couple')"`,
   `supabase functions serve widget --workdir $TMPDIR/qa49c-sb` (keep running, log to a file).
2. **Build copy:** `rsync -a --exclude /node_modules --exclude /ios --exclude /android --exclude /.git $W/ $B/`
   (exclude only the top-level dirs: `--exclude ios` also drops `plugins/widgets/ios`), symlink
   `node_modules`. In `$B/app.config.ts` replace `'./plugins/widgets',` with
   `['./plugins/widgets', { premium: true, supabaseUrl: 'http://127.0.0.1:57521' }],`.
   `$B/.env`: `EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:57521`, the anon key from `supabase status`,
   `EXPO_PUBLIC_SHIP_LITTLE_THINGS=1`, RevenueCat keys **empty** (a `test_` key kills the app on iOS).
3. `CI=1 npx expo prebuild --clean --no-install --platform ios`, `cd ios && LANG=en_US.UTF-8 pod install`, then
   `xcodebuild -workspace Bonded.xcworkspace -scheme Bonded -configuration Debug -sdk iphonesimulator -destination id=$UDID -derivedDataPath $B/ios/build ARCHS=arm64 ONLY_ACTIVE_ARCH=YES CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO build`.
   Do **not** pass `CODE_SIGNING_ALLOWED=NO`: without the simulated entitlements the keychain groups
   do not exist and SecureStore fails. `xcrun simctl boot $UDID`, `xcrun simctl install $UDID <Bonded.app>`.
   Use literal paths: outside the sandbox `$TMPDIR` is `/var/folders/…`, not `/tmp/claude-501`.
4. Metro from `$B` (`npx expo start --dev-client`), open the app with
   `xcrun simctl openurl $UDID "com.hellobonded.app://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081"`,
   then `maestro --device $UDID test -e EMAIL=maya@bonded.test -e MAILPIT_URL=http://127.0.0.1:57524 qa/widgets/flows/ios-sign-in.yaml`
   (closes the dev menu, email OTP from Mailpit). Paired Premium home appears (a streak-badge sheet may cover it).
5. **Place the widget**: `maestro --device $UDID test qa/widgets/flows/ios-add-little-things.yaml`
   (works on iOS 18.0; change `times: 3` to 4 for Little things medium) or by hand. If it cannot be placed, record that, and check the extension through the log instead
   (`xcrun simctl spawn $UDID log stream --predicate 'process == "BondedWidgetExtension"'` while
   `WidgetCenter` reloads after sign-in): a `state` call must reach `functions serve` and
   `widget_token_usage` read must count 1.

Checks (screenshot each with `xcrun simctl io $UDID screenshot evidence/<date>/ios-NN-*.png`, rows
with `db-check.sh supabase_db_qa49c`):

| # | Step | Expect |
|---|---|---|
| 1 | after sign-in | token row (48 h, not revoked); widget "Little things / Tap to send / Send Sam a hug"; read bucket >= 1; leak check keychain count 1 |
| 2 | tap Send | without opening the app: row `kind=hug, source=widget`; widget "Sent to Sam 🤍" + Undo |
| 3 | Send, then Undo within 5 s | `undone_at` set; buttons back |
| 4 | Send, wait > 5 s, Undo (if still drawn) | 409 UNDO_EXPIRED: no `undone_at`; buttons back (iOS has no separate "undo expired" line) |
| 5 | limit: send goodnight once (widget medium or app), then goodnight from the widget | 409: "Goodnight sent · Back tomorrow", no second row |
| 6 | lapse: `update entitlements set is_active=false …`, tap Send | locked preview (Premium / See Premium, lock), no row; tap opens `bonded://paywall?from=widget&widget_kind=little_things` |
| 7 | sign out in the app | token `revoked_at` set; keychain count 0; widget "Tap to catch up / Open Bonded" |
| 8 | `ios-leak-check.sh $UDID 2h` | PASS (0 `bwt_` in log, App Group, app and extension containers) |
| 9 | if time | screenshots: Little things medium, Bonded small/medium, Your turn, Lock Screen kinds in the gallery |

Watch for (from the static part): the extension's Info.plist has **no** `NSAppTransportSecurity`
(the app's has `NSAllowsLocalNetworking`). ATS normally lets plain http through to `127.0.0.1` /
`localhost`; if the extension's call fails with NSURLError -1022, that is a test-setup limit (prod is
https), not a product bug: tell mobile and use `localhost` or an https tunnel.

Cleanup: `xcrun simctl shutdown $UDID`, stop Metro and `functions serve`,
`supabase stop --no-backup --workdir $TMPDIR/qa49c-sb`, delete `$B` (the `ios/build` DerivedData is
several GB) and the stack copy.

## QA-49c results (2026-11-14, REL-A, iOS 18.0, Debug build of 1f56821c + `premium: true`)

| # | Result | Evidence |
|---|---|---|
| 1 | pass: token row 2 days, not revoked; widget "Little things / Tap to send / Send Sam a hug"; read bucket 1 at placement; keychain items in the widget group = 1. No ATS -1022: the extension reached `http://127.0.0.1:57521` without an ATS key | `ios-01-widget-premium.png`, `ios-db-rows.txt` |
| 2 | pass: row `hug / widget`, app not opened; widget "Sent to Sam 🤍" + Undo for ~5 s | `ios-02-after-send.png` |
| 3 | pass: Undo 3.1 s after send -> `undone_at` set, buttons back | `ios-03-after-undo.png` |
| 4 | pass, with the server clock forced: the iOS widget hides Undo at 5 s by itself, so a late tap never reaches the server (it lands on the widget body and opens the app). To see the 409 path, `public.widget_undo` on the `qa49c` stack was redefined for one tap with `now() + 10 s` (restored after): kong 409, no `undone_at`, buttons back | `ios-04-undo-expired-409.png` |
| 5 | pass: goodnight from the medium widget -> its chip turns to the disabled "Goodnight sent · Back tomorrow" (no second tap reaches the server; tapping the disabled chip opens the app). 409 path: good morning sent "from the app" by SQL (`private.send_little_thing_core(..., 'app', now())`), then the stale "Say good morning" chip -> kong 409, no widget row, widget "Good morning sent · Back tomorrow" | `ios-05a-goodnight-sent.png`, `ios-05b-limit-409-good-morning.png` |
| 6 | pass: lapse -> tap Send -> 403, no row, every Little things widget "Premium / See Premium"; See Premium opens `bonded://paywall?from=widget&widget_kind=little_things` (seen in the unified log; paywall shows "Not available right now" because RevenueCat keys are empty) | `ios-06a-lapse-locked.png`, `ios-06b-lapse-tap-paywall.png` |
| 7 | pass: sign-out -> `revoked_at` set, keychain items in the widget group = 0, widgets "Tap to catch up / Open Bonded" | `ios-07-after-signout.png` |
| 8 | **fail**: 0 tokens in the unified log (2 h), the App Group (only key `bonded.widget.snapshot`) and the extension container; **1 token in the app's URL cache** (`Library/Caches/com.hellobonded.app/Cache.db`, entry `rest/v1/rpc/mint_widget_token`), still there after sign-out | `ios-08-leak-check.txt` |
| 9 | partial: home-screen gallery (Bonded small, Bonded medium, Your turn, Little things small/medium) and Little things medium on the home screen. Lock Screen kinds not shot | `ios-09*.png` |

Bug (leak check): RN `fetch` goes through `NSURLSession` with the shared `NSURLCache`, and local
Supabase (kong / PostgREST / GoTrue) sends no `Cache-Control`, so the app's `Cache.db` stores the
responses of `mint_widget_token` (widget token), `auth/v1/verify` (`access_token` + `refresh_token`),
and the `answers` / `thread_messages` selects (answer and message `body`), in plain text in
`Library/Caches`, and they stay after sign-out. Check whether hosted Supabase sends `no-store`; the app
side fix is for mobile (for example `cache: 'no-store'` on the Supabase client's fetch, or a zero-size
`URLCache`).

Gotchas found while running:
- Maestro `tapOn: "<widget text>"` misses on widgets: SpringBoard reports the widget's inner elements
  with bounds relative to the widget, so the tap lands near the screen's top left. Tap by point (for
  the small widget on the first home page: Send `27%,23%`, Undo `37%,16%`; medium: hug `24%,23%`,
  good morning `50%,23%`, goodnight `76%,23%`). Text asserts on widget text work.
- Every `maestro test` / `maestro hierarchy` run starts its driver app, and SpringBoard jumps to the
  page that holds the runner icon. Start widget flows with a `repeat: while: notVisible: "<widget
  text>"` swipe loop to come back to the widget page.
- `xcrun simctl io screenshot` in a 0.5 s loop while Maestro taps in the background catches the 5 s
  Undo state; a Maestro run is too slow to start for that.
- Pressing home to leave jiggle mode dropped a just-added widget page once: tap Done.

## QA-49d results (2026-11-14, re-check after #480 MOB-89 and #476 MOB-78c)

Builds: Debug of origin/main 9aa9e916 with `premium: true`, stack `qa49d` (5752x, `premium-couple`),
recipes as QA-49c (iOS, `127.0.0.1:57521`) and QA-49b (Android, `10.0.2.2:57521`). The old
`Library/Caches/com.hellobonded.app` on REL-A (from earlier runs) was deleted before the run, and
the Android app data cleared (`pm clear`), so every entry found would be from this build.

| Check | Result | Evidence |
|---|---|---|
| iOS: fresh mint at sign-in, URL cache while signed in | **pass**: new token row (2 days, not revoked), widget keychain items 1; `Cache.db` exists but holds **0** responses at all (0 Supabase) | `ios-leak-check-signed-in.txt`, `ios-01-signed-in.png` |
| iOS: after sign-out (#479) | **pass**: token `revoked_at` set, keychain items 0, `Cache.db` 0 responses, no `access_token`/`refresh_token` under `Library/Caches`, 0 `bwt_` in log / App Group / app / extension | `ios-leak-check-after-signout.txt`, `ios-db-rows.txt`, `ios-03-after-signout.png` |
| Android: http-cache while signed in | **pass**: `cache/http-cache` = journal only, 0 response bodies, 0 Supabase entries, 0 `bwt_` in the data dir | `android-cache-check-signed-in.txt` |
| Android: after sign-out (MOB-89) | **pass**: `cache/http-cache` empty (cleared), 0 `bwt_` in data dir and logcat, token revoked, widget "Tap to catch up / Open Bonded" | `android-cache-check-after-signout.txt`, `db-rows.txt`, `android-05-widget-after-signout.png` |
| Android: lapse -> locked on foreground (MOB-78c) | **pass**: entitlement set inactive by SQL with the app in the background; 75 s later the widget still says "Send Sam a hug" (expected: nothing redraws it); the app brought to the foreground (no widget tap) -> one more `read` on the token and, back on the home screen, "Little things / Premium / See Premium" with the lock | `android-01-widget-premium.png`, `android-02-lapsed-before-foreground.png`, `android-04-widget-after-foreground.png` |

Not checked: the lapse redraw on iOS (asked for Android only); a Release build (same networking
code). The iOS widget was not on REL-A's home screen this time (the token was still read by the
extension: `last_used_at` set); the cache check does not depend on it.

Gotchas: the worktree's `node_modules` was stale (`expo-background-task` missing: prebuild fails),
run `npm ci` first. Building iOS and Android at the same time while the emulator boots made the
emulator ANR (launcher and "Process system"): stop Gradle (`./gradlew --stop`) and cold-boot it
again. On Android the dev-client scheme is `exp+bonded://expo-development-client/?url=…` (not
`com.hellobonded.app://`); use `adb reverse` for 8082 / 57521 / 57524. The Today gear sits under
the dev-client tools button, so `sign-out.yaml` opens `bonded://us`.
## QA-49e results (2026-11-14, REL-A, iOS 18.0, Debug build of origin/main 08819962 + `premium: true`)

Setup as in the QA-49c recipe, stack `qa49e` (5752x, `premium-couple`), RevenueCat keys empty, no
EAS project id. The app was uninstalled first (fresh keychain and caches), so the widget was placed
again with `flows/ios-add-little-things.yaml` (ran unchanged). Send + Undo: a 0.4 s screenshot loop
plus a Maestro flow that taps Send `27%,23%`, waits for "Undo", taps Undo `37%,16%`.

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | token minted at sign-in, widget reads it and shows the partner | **pass**: row 2 days, not revoked; read bucket 1 at placement; widget "Little things / Tap to send / Send Sam a hug" | `ios-01-widget-premium.png`, `ios-db-rows.txt` |
| 2 | tap Send (app not opened) | **pass**: row `hug / widget`; widget "Sent to Sam 🤍" + Undo | `ios-02-sent-undo.png` |
| 3 | Undo | **pass**: Undo at 2.4 s -> `undone_at` set; widget back to "Tap to send" | `ios-03-after-undo.png` |
| 4 | lapse with the app in the background, then foreground (iOS half of MOB-78c) | **pass**: entitlement set inactive by SQL; 70 s later the widget still shows "Send Sam a hug" (nothing redraws it); app brought to the foreground (no widget tap) -> one more `read` (4 -> 5) and, back home, "Little things / Premium / See Premium" | `ios-04-lapsed-before-foreground.png`, `ios-05-lapsed-after-foreground.png` |
| 5 | silent push (CONTRACTS §5 shape, `../widget-refresh.apns`: `aps.content-available=1`, `body.type=widget_refresh`, no alert): no banner, no list entry | **pass** (OS level): SpringBoard "Not delivering user visible notification ... because it has no alert, sound or badge", in the background and in the foreground | `ios-silent-push-springboard.txt` |
| 6 | silent push mints a new token when < 24 h is left (app in background) | **not testable on the simulator** (no bug): `xcrun simctl push` of a content-available-only payload reaches the app as a **background fetch** (`application(_:performFetchWithCompletionHandler:)`, `SBBackgroundFetchTask`), never as `didReceiveRemoteNotification` (lldb hit counts: 0 on every `didReceiveRemoteNotification`; 1 on `TaskManagerAppDelegateSubscriber.performFetch` -> `EXTaskService runTasksWithReason` -> `NotificationsBackgroundTaskConsumer.supportsLaunchReason` = false). So expo-notifications' `remote-notification` task (`bonded.widget.refresh-push`, registered: `getRegisteredTasksAsync` lists it) never runs and no token is minted; same in the foreground, and same after `registerForRemoteNotifications` (`getDevicePushTokenAsync` ok) | `ios-silent-push-lldb-hits.txt`, `ios-silent-push-springboard.txt` |
| 6b | foreground handler (`addNotificationReceivedListener` -> `runWidgetRefreshTask`) | **pass, indirectly**: the same push with an `alert` added (not the contract shape; only to reach `willPresent` on the simulator), app in the foreground, stored token 23 h -> one new token row within 10 s (7 -> 8 rows), no other mint path ran then | `ios-db-rows.txt` (token rows) |

How 6 was set up: on the `qa49e` stack `private.mint_widget_token_at` was redefined with a 23 h
lifetime instead of 48 h (the `expires_at` stored on the phone decides; shortening it only in the DB
does nothing), then sign-out + sign-in so the app held a 23 h token, app sent home, push sent.
Temporary `console.log`s in the throwaway build copy (never in the repo) showed the task registered
and never called. Every foreground with a < 24 h token mints again (as designed), so keep the app in
the background between a mint and the push. Detaching lldb killed the app once: relaunch after it.

Not checked: Android (a data-only FCM message cannot be sent with `adb` without FCM credentials);
the backend selection (`due_widget_refreshes`) needs a registered Expo push token, which a build
without an EAS project id does not get (covered by `supabase/tests/widget-refresh-push.test.mjs`).
Real-device item 5 below.

## QA-49f results (2026-11-14, emulator-5554, Android 17, Debug build of origin/main 5ab1ef2d + `premium: true`)

Days together (38c-3, MOB-78e #491). Setup as QA-49b/d: stack `qa49f` (5752x, `premium-couple`: Maya
active yearly, Sam on her plan; key dates `together_since` 2023-03-14 + a birthday), build copy with
`['./plugins/widgets', { premium: true, supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL }]`,
`EXPO_PUBLIC_SHIP_LITTLE_THINGS=1`, RevenueCat keys empty, `pm clear` before the run. The Days together
widget was added fresh from the picker; the Little things widget from earlier runs stayed on the page.

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Gradle `assembleDebug -PreactNativeArchitectures=arm64-v8a` of the prebuild | **pass**: BUILD SUCCESSFUL in 2m 21s, 0 Kotlin warnings in the widget files (first Gradle build of `BondedDaysTogether.kt`) | `gradle-build.txt` |
| 2 | widget picker | **pass**: "Days together", 2 x 2, next to the two free Bonded widgets and Little things. The description line repeats the name ("Days together"): en.json has no description key (documented in `plugins/widgets/index.js`); the picker preview shows only the title (no example count) | `android-01-picker-days-together.png` |
| 3 | no token (fresh install, signed out) | **pass**: "Tap to catch up / Open Bonded" | `android-02-no-token-open-bonded.png` |
| 4 | premium couple, after sign-in | **pass**: "1,341 days together / Anniversary in 120 days" (DB: today - 2023-03-14 = 1341; 2027-03-14 is 120 days away); token 2 days, read bucket counted; prefs `bonded_widget_days_together` hold only the allow-listed numbers, kinds and the partner's first name | `android-03-premium-days-count.png`, `db-rows-premium.txt`, `android-days-prefs-ready.txt` |
| 5 | no key dates (deleted by SQL for one refresh, restored after) | **pass**: "3 days in Bonded" + **Add dates** (paired 2026-11-11; the app header says "Day 4 together", a 1-based day: different wording, no conflict) | `android-04-no-key-dates-add-dates.png` |
| 6 | tap (ready) | **pass** warm: opens `bonded://us/couple` = Couple settings. The first tap right after sign-in landed on Today (not reproduced). After a **force-stop** the tap does nothing (Days together and Little things alike: Android cancels a force-stopped app's PendingIntents; back after the app runs again) | — |
| 7 | lapse by SQL with the app in the background, then foreground (> 60 s after the last reload: `reload.ts` throttle) | **pass**: lock + "Premium" + **See Premium**; prefs cleared to `view=locked`. A foreground inside the 60 s throttle does not refresh (as designed) | `android-05-lapsed-locked.png`, `db-rows-lapsed.txt`, `android-days-prefs-locked.txt` |
| 8 | tap locked | **pass**: `bonded://paywall?...` (logcat `dat=bonded://paywall/...`; the URL in the code is `from=widget&widget_kind=days_together`); paywall shows "Not available right now" because RevenueCat keys are empty | `android-06-locked-tap-paywall.png` |
| 9 | renewal (entitlement active again), foreground | **pass**: count back | `android-08-4x2-premium-renewed.png` |
| 10 | sizes: 4 x 2, 4 x 1 (resized on the home screen) | 4 x 2 ready **pass** but shows only the next key date (spec 38c §3.3: medium shows the next two). 4 x 1 ready **pass** (three short lines fit). 4 x 1 **locked and signed out: the CTA button is clipped** at the bottom ("See Premium" / "Open Bonded" cut in half) | `android-07-4x2-locked.png`, `android-09-4x1-premium.png`, `android-10-signed-out-4x1-clipped.png`, `android-11-locked-4x1-clipped.png` |
| 11 | sign-out | **pass**: token `revoked_at` set; Days together "Tap to catch up / Open Bonded"; prefs only `view=expired` | `android-10-signed-out-4x1-clipped.png` |
| 12 | leak check (`android-cache-check.sh`) after the run | **pass**: http-cache 0 files, 0 cached Supabase responses, 0 `bwt_` in the data dir, 0 `bwt_` in logcat | `android-cache-check.txt` |

Findings for mobile (the lead files them):
- **4 x 1 clips the CTA** in the locked and signed-out (and so presumably "Add dates") states:
  the layout stacks title + line + a full-size button in one row. Spec: 4 x 1 = a one-line bar.
- **The tap and "Add dates" open Couple settings, which has no key dates.** Spec 38c §3.3: "Tap: Us
  tab, key dates"; "Add dates ... opens key dates". Us has no key dates screen yet (D50 (7) moved 47
  out of onboarding to "Us (48-51)"; the only KeyDatesScreen route is `/quiz/dates`), so a couple
  with no key dates cannot act on "Add dates".
- **4 x 2 shows one key date** instead of the next two (spec 38c §3.3 medium). `DaysCache` keeps only
  `next_key_dates[0]`.
- (Little things, MOB-78, sev 4) at **4 x 2** the middle chip "Say good morning" wraps to two lines,
  sits lower than the other two and is clipped at the bottom (`android-13-little-things-4x2-middle-chip.png`).
  At 3 x 2 the three chips fit (`android-12-little-things-3x2.png`). Spec 38c §2/§3.1: 3 x 2 keeps the
  small layout and medium shows all five kinds; Android draws three (hug, good morning, goodnight) from
  3 x 2 up, as `plugins/widgets/README.md` says: lead to confirm whether that is an accepted deviation.
- (Little things, MOB-78, sev 4) a failed `state` read with nothing cached draws "Couldn't send · Tap to
  try again" although nothing was sent; seen after sign-in while the widget could not reach the stack.

Gotcha (test setup, not a product bug): in this emulator session the app's OkHttp requests to
`http://10.0.2.2:57521` never reached kong (the sign-in "Send code" stayed busy; no connection on the
host) although `nc 10.0.2.2 57521` from `adb shell` did. Fix used: `adb reverse tcp:57521 tcp:57521`,
`EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:57521` for Metro, and the widget endpoint (generated
`android/.../widget/BondedLittleThings.kt` `ENDPOINT`, shared by Days together; the plugin also accepts
`supabaseUrl: 'http://127.0.0.1:57521'`) pointed at 127.0.0.1, then an incremental Gradle build (22 s).
Widget tap Maestro-free: `adb shell input tap`; resize with `adb shell input motionevent DOWN/MOVE/UP`
on the resize handles (drag the bottom handle up for 4 x 1; the top handle did not move).

## QA-49g results (2026-11-14, emulator-5554, Android 17, Debug build of PR #499 274b022e + `premium: true`)

Re-check of the QA-49f findings (#495-#498) and first device run of the Streak widget (MOB-78f).
Setup as QA-49f: stack `qa49g` (5752x, `premium-couple`: Maya active yearly, streak 3, key dates
`together_since` 2023-03-14 + a birthday), build copy from `git archive origin/mobile/MOB-78f-android-streak`
with `['./plugins/widgets', { premium: true, supabaseUrl: 'http://127.0.0.1:57521' }]`,
`EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:57521` + `adb reverse` 57521 / 57524 / 8081 (the QA-49f
workaround, used from the start), `EXPO_PUBLIC_SHIP_LITTLE_THINGS=1`, RevenueCat keys empty, `pm clear`
after install. Little things (4 x 2) and Days together (4 x 1) stayed on page 1 from QA-49f; Streak was
added fresh on page 2.

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Gradle `assembleDebug -PreactNativeArchitectures=arm64-v8a` | **pass**: BUILD SUCCESSFUL in 2m 38s, 0 warnings in the widget Kotlin (first Gradle build of `BondedStreak.kt`) | `gradle-build.txt` |
| 2 | Days together 4 x 1, signed out (#495) | **pass**: one-line bar "Tap to catch up / Open Bonded", no button, nothing clipped | `android-01-signed-out-days-4x1-bar.jpg` |
| 3 | Days together 4 x 1, premium | **pass**: "1,341 days together / Anniversary in 120 days" bar | `android-02-premium-home.jpg` |
| 4 | Days together 4 x 1, locked (lapse by SQL + foreground) (#495) | **pass**: "Days together" + lock + "Premium", no button, nothing clipped | `android-09-days-4x1-locked.jpg` |
| 5 | Days together 4 x 1, no key dates (deleted by SQL) (#495) | **pass**: bar "3 days in Bonded / Add dates" | `android-11-days-4x1-no-key-dates.jpg` |
| 6 | "Add dates" tap -> 47 (#497) | **pass**: `bonded://quiz/...` opens 47 "Any dates worth celebrating?" | `android-12-add-dates-opens-47.jpg` |
| 7 | 47 save for the paired couple (#497) | **pass**: Together since 03/14/2023 + Your birthday 12/20/1994 -> Continue -> two rows in `key_dates` (`together_since` couple-wide, `birthday` personal, `remind_week_before` true); the app goes back to Today | `android-13-key-dates-filled.jpg`, `db-key-dates-after-47.txt` |
| 8 | widget shows the count after the save (#497) | **pass with finding**: right after Continue the widget still said "3 days in Bonded / Add dates" (`android-14-days-after-save.jpg`); the next foreground (> 60 s after the last reload) drew "1,341 days together / Your birthday in 36 days" | `android-15-days-4x1-count-after-foreground.jpg` |
| 9 | Days together 4 x 2 shows two key dates (#496) | **pass**: "Your birthday in 36 days" + "Anniversary in 120 days" | `android-16-days-4x2-two-key-dates.jpg` |
| 10 | Days together tap (ready) opens Us (#497) | **pass**: `bonded://us/...` -> Us tab (Us has no key dates entry yet: accepted deviation, plugins/widgets/README) | `android-17-days-tap-opens-us.jpg` |
| 11 | Little things 4 x 2 buttons (#498b) | **pass**: the two-line "Say good morning" lines up with the other two, nothing clipped | `android-02-premium-home.jpg` |
| 12 | Little things failed first read (#498a) | **pass**: Little things prefs deleted (`run-as`), `functions serve` stopped (kong 503), app restarted -> "Little things / Tap to catch up / Open Bonded", not "Couldn't send"; Days together kept its last view (as designed) | `android-10-little-things-failed-first-read.jpg` |
| 13 | Streak in the picker | **pass**: "Streak", 2 x 2, "Your streak, both of you, and the next badge." (Days together now has its own description too) | `android-03-picker-streak.jpg` |
| 14 | Streak 2 x 2 / 4 x 2 / 4 x 1 (resized) | **pass**: 2 x 2 "3 days, both of you" + progress bar + "4 days to badge 7"; 4 x 2 "3-day streak" + ladder 1 3 (filled) 7 (dashed) 14 21 30 + "4 days to badge 7"; 4 x 1 bar "3-day streak / 4 days to badge 7" (matches `couple_streaks.current` 3) | `android-04-streak-2x2.jpg`, `android-05-streak-4x2.jpg`, `android-06-streak-4x1.jpg` |
| 15 | Streak tap (ready) | **pass**: `bonded://us/...` -> Badges | — |
| 16 | Streak locked -> paywall | **pass**: lapse by SQL + foreground -> "Streak" + lock + "Premium" (4 x 1, no button); tap -> `bonded://paywall/...`, paywall "Not available right now" (RevenueCat keys empty) | `android-07-streak-4x1-locked.jpg`, `android-08-streak-locked-tap-paywall.jpg` |
| 17 | Streak prefs | **pass**: `bonded_widget_streak` = `current`, `next_badge`, `saver_available`, `napping`, `view` only (no names, no token); cleared to `view=locked` on lapse; `_seen` holds `lockedSeen` | `android-streak-prefs-ready.txt`, `android-streak-prefs-locked.txt`, `android-prefs-keys.txt` |
| 18 | sign-out | **pass**: token `revoked_at` set; Days together 4 x 2 and Streak 4 x 1 "Tap to catch up / Open Bonded" | `android-18-signed-out-days-4x2.jpg`, `android-19-streak-signed-out-4x1.jpg`, `db-rows.txt` |
| 19 | leak check | **pass**: `android-cache-check.sh` 0 cached responses, 0 `bwt_` in the data dir; logcat over sign-out + sign-in (mint) + widget reads: 0 `bwt_` (earlier parts of the run were cleared with `logcat -c` between steps and not counted) | `android-cache-check.txt`, `android-logcat-bwt.txt` |

Finding for mobile (sev 4, the lead files it):
- **Saving key dates in 47 does not refresh the widgets.** The "Add dates" tap opens the app inside the
  60 s foreground throttle (`reload.ts`), and `upsertKeyDates` does not ask for a reload, so Days
  together keeps "Add dates" until the next foreground more than 60 s later (or the periodic job).
  Expected (#497): the count right after Continue. Ask: reload the widgets (bypassing the throttle)
  after a successful key-dates save, as the app does after other snapshot writes.

Observations (no bug): the 4 x 1 bars put the two lines at the bottom with an empty band above
(Days together and Streak alike); the locked 4 x 1 keeps the title row + lock and drops the button.
Back from 47 opened by the widget goes to the previous screen (Today here), not Us.

Gotchas: with node_modules symlinked to another checkout, the first Metro start served the "Welcome
to Expo" router screen (1683 modules): restart Metro with `--clear`. The first boot after Gradle hit
"System UI isn't responding" (host load 48): `./gradlew --stop`, `adb emu kill`, cold boot. `adb
reverse --remove` does not cut a running OkHttp/HttpURLConnection keep-alive, so it is no way to fake
offline; stopping `functions serve` (kong 503) is. A force-stopped dev client opens the launcher, not
the bundle: tap the recent `127.0.0.1:8081` entry.

## QA-49h results (2026-11-14, emulator-5554, Android 17, Debug build of PR #507 be6f8407 + `premium: true`)

Checks the widget plugin's Android backup rules (MOB-78h, SEC-25 Info 1). Build copy: `rsync` of the
worktree without `/android`, `/ios`, `/node_modules`, `/.git` into `/private/tmp/claude-501/qa78h-build`,
`node_modules` symlinked, `.env` = `.env.example`, `['./plugins/widgets', { premium: true, supabaseUrl:
'http://10.0.2.2:54321' }]` (the plugin refuses `premium: true` without a URL; no backend needed here).
Gradle and the emulator outside the sandbox. No stack, no Metro, no sign-in: the emulator's app data
from QA-49g already held all seven excluded prefs files.

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | `npx expo prebuild --clean --no-install --platform android`: no expo-secure-store backup warning (only the usual Sentry org/project note); `AndroidManifest.xml` and both merged manifests have `fullBackupContent="@xml/bonded_backup_rules"`, `dataExtractionRules="@xml/bonded_data_extraction_rules"`, `allowBackup="true"`; `res/xml` has only the two `bonded_*` rule files (plus the widget infos), no `secure_store_*` file and no reference to one | **pass** | `prebuild.log`, `merged-manifest-backup-attrs.txt`, `bonded_backup_rules.xml`, `bonded_data_extraction_rules.xml` |
| 2a | `./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a`: BUILD SUCCESSFUL (2 m 56 s); 0 warnings in widget Kotlin (one template warning in `MainActivity.kt`, the rest in node_modules) | **pass** | `gradle-assemble-summary.txt` |
| 2b | `./gradlew :app:lintDebug` with a temp `lint { checkOnly 'FullBackupContent', 'DataExtractionRules', 'AllowBackup' }` block: "No issues found." Negative control: an extra `<exclude domain="file" path="qa_negative_control"/>` in the backup rules gives `Error: qa_negative_control is not in an included path [FullBackupContent]`, so the check really reads our files | **pass** | `lint-backup.txt`, `lint-negative-control.txt` |
| 3 | `adb install -r` on emulator-5554 (data kept: `SecureStore.xml`, `bonded_widgets.xml`, `bonded_widget_little_things.xml`, `bonded_widget_days_together(_seen).xml`, `bonded_widget_streak(_seen).xml` present), `bmgr enable true`, transport `com.android.localtransport/.LocalTransport`, `bmgr backupnow com.hellobonded.app` -> Success. The app's `FullBackup_native` lines list the 8 files written (TaskManagerModule, WebViewChromiumPrefs, I18nUtil, localization, devlauncher, PersistentDataManager, devmenu, `com.hellobonded.app_preferences`); none of the 7 excluded files appears. 0 `bwt_` in the log. This exercises the Android 12+ `cloud-backup` rules; `device-transfer` and the Android 11 `full-backup-content` file have the same exclude list (lint-checked, not run) | **pass** | `shared-prefs-on-device.txt` (names only), `logcat-backup-filtered.txt` |

Afterwards: transport set back to `com.google.android.gms/.backup.BackupTransportService`, `bmgr enable
false` (as found), emulator killed, build copy deleted. The local transport's backup set stays in the
emulator's `/data/cache/backup` (no root to delete it; it holds only the 8 non-secret files). iOS not touched.

## Founder items (real iPhone only; a simulator cannot show these)

1. Lock Screen circular "Send a hug" and the Control Center control on a **locked** phone ask to
   unlock before anything is sent (`.requiresAuthentication`); nothing reaches the server before.
2. The widget's token read while the phone is locked after a restart (before first unlock):
   `AfterFirstUnlockThisDeviceOnly` means "Open Bonded" until the first unlock, then normal.
3. Redaction: Lock Screen "Today's question" / "Thinking of you" and Little things in StandBy show
   the neutral lines with no partner name while locked.
4. iOS 18.2+: the control opens the paywall / Today when the send cannot happen (`OpenURLIntent`).
5. Silent `widget_refresh` push (QA-49e step 6): on a TestFlight/dev build with push registered,
   leave the app in the background > 36 h (or with a short-lived token on a test stack) until
   `daily-reminder` sends the push; expect a new `private.widget_tokens` row for that device with no
   banner, no Notification Center entry and no app launch on screen.

## QA-49c static part (done 2026-11-14, in the sandbox)

`expo prebuild --platform ios` of origin/main 1f56821c with `premium: true`,
`supabaseUrl: 'http://127.0.0.1:57521'` (the plugin accepts it): app entitlements
`keychain-access-groups` = `$(AppIdentifierPrefix)com.hellobonded.app` then `…app.widget`, App Group
`group.com.hellobonded.app`; extension entitlements = the widget group only + the same App Group;
extension Info.plist `BondedSupabaseURL` = `http://127.0.0.1:57521`, `BondedWidgetKeychainGroup` =
`$(AppIdentifierPrefix)com.hellobonded.app.widget` (expanded at build time; MOB-77b saw it expanded
on REL-A). The extension xcodebuild failed in the sandbox (CoreSimulator service and the build arena
folder are not reachable), not because of the code; MOB-77b built it with 0 warnings outside.
