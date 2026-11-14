# Widget device checks (QA-49)

Contract half: `qa/contract/widgets.test.ts` (TEST_PLAN D59). Device half: this folder.
Evidence goes in `evidence/<date>/` (screenshots and DB rows only: no answer text, no token, no hash).

| Part | Platform | State |
|---|---|---|
| QA-49b | Android, emulator-5554 | **pass** 2026-11-14 (`evidence/2026-11-14/android-*.png`; recipe in `docs/plan/status/qa.md`, QA-49b session) |
| QA-49c | iOS, REL-A | **pass except the leak check** 2026-11-14 06:38-07:45 (Debug premium build, stack `qa49c`): token minted + read, send, Undo, undo expired 409, limit 409, lapse -> locked + paywall URL, sign-out -> revoked + keychain 0. Leak check **fails**: the app's NSURLCache (`Library/Caches/com.hellobonded.app/Cache.db`) keeps the `mint_widget_token` response (the token), the auth session and answer/message bodies (see "QA-49c results"). Evidence `evidence/2026-11-14/ios-*` |
| QA-49e | iOS REL-A | 2026-11-14 09:46-10:25 (Debug build of main 08819962 with MOB-78d + BE-65): send, Undo, lapse -> locked on foreground **pass**; silent `widget_refresh` push: no banner/list **pass**, background mint **not testable on the simulator** (see "QA-49e results"). Evidence `evidence/2026-11-14e/` |
| founder | real iPhone | unlock prompt, locked keychain, redaction, silent push wakes the app (list at the end) |

## Helpers

- `ios-leak-check.sh <udid> [2h]`: counts `bwt_` in the simulator's unified log, the App Group
  container (incl. `Library/Preferences/group.com.hellobonded.app.plist`, keys printed), the app data
  container and the extension's PluginKit container; prints how many keychain items are in the
  `*.com.hellobonded.app.widget` access group (1 signed in, 0 after sign-out). Never prints a match.
- `db-check.sh <db container>`: Maya's widget tokens (lifetime, revoked, last used), usage counters,
  little_things rows (`source`, `undone`), entitlements. Never prints a token or hash.
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
