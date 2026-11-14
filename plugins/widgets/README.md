# Bonded widgets (MOB-30, screen 38, D26; 38b pair MOB-57, D47)

Config plugin `plugins/widgets` (registered in `app.config.ts`) plus the local Expo module
`plugins/widgets/modules/bonded-widgets` (found through `expo.autolinking.nativeModulesDir` in
`package.json`).

## Data flow

1. `src/features/widgets/useWidgetSync.ts` (root layout) watches the Query cache: active couple,
   today's question, streak, profiles. It never fetches.
2. `buildWidgetSnapshot` (`src/features/widgets/snapshot.ts`) makes the snapshot: state, booleans,
   streak, day number, the end of the couple-local day (`dayEndsAt`), the partner's first name and the
   copy from `en.json` `widget.*`. **Never answer, message or question text** (FUN-04).
3. The module writes it as JSON:
   - iOS: `UserDefaults(suiteName: <App Group>)`, key `bonded.widget.snapshot`, then
     `WidgetCenter.shared.reloadAllTimelines()`. The App Group is `group.<bundle id>`
     (Info.plist `BondedAppGroup` in the app and in the extension).
   - Android: shared preferences `bonded_widgets` / `snapshot`, then a package-only broadcast
     `com.hellobonded.widgets.REFRESH` that both receivers handle.
4. Sign-out writes the empty snapshot (state `none`, no name).
5. **Redraw without a new snapshot (MOB-78c, QA-49b):** `reloadWidgets()` on the module, called
   through `requestWidgetReload` (`src/features/widgets/reload.ts`, debounced 750 ms; foreground
   reloads at most once a minute, state changes always) from `useWidgetReload` (root layout) on
   AppState `active` and when the cached Premium / couple / session state changes, and from
   `tokens.ts` after a new widget token. iOS: `WidgetCenter.shared.reloadAllTimelines()` and, on
   iOS 18, `ControlCenter.shared.reloadAllControls()`. Android: an explicit `APPWIDGET_UPDATE` with
   the ids to each of this app's providers that has widgets placed (`onUpdate`: free widgets redraw
   from the snapshot, Little things fetches `state`, so a lapse shows the locked preview without a
   tap). Typechecked: swiftc against the ExpoModulesCore stub (iOS 16.4 and 18.0, Swift 5 and 6),
   kotlinc 2.4 against a stub with expo-modules-core's real `Function` overloads (incl.
   `FunctionWithoutArgs`: a bare `return@Function` there is a K2 error). Not built with Gradle or
   Xcode, not run on a device yet.

## Widgets

| Widget | iOS kind / Android receiver | Sizes | Layouts |
|---|---|---|---|
| Bonded (38) | `BondedToday` / `.widget.BondedTodayWidget` | small, medium; iOS lock screen: rectangular, inline, circular; Android `keyguard` where supported | Day N + whose turn; medium: title, streak, countdown |
| Your turn (38b) | `BondedYourTurn` / `.widget.BondedYourTurnWidget` | small | Countdown (nobody answered / missed day), Partner answered (they did, I haven't), otherwise the 38 small layout |

Tap: `bonded://today?widget=today|countdown|partner_answered` (Expo Router opens Today; analytics
sends `widget_tapped` and `app_opened {source: widget}`).

At `dayEndsAt` the widgets switch to "New question" by themselves (iOS timeline entry, Android
inexact alarm), because the snapshot then describes a day that has ended.

## Premium widgets (MOB-77, D59, SEC-21 option A): behind `premium`

Off by default: `app.config.ts` registers `'./plugins/widgets'` with no props, so today's builds have
none of this and the app never mints a widget token. Turn on with
`['./plugins/widgets', { premium: true, supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL }]`
**only after the device build check below**. `supabaseUrl` must be an `https://` origin; plain
`http://` is accepted only for `localhost`, `127.0.0.1` and `10.0.2.2` (local Supabase), because
the widget sends its bearer token there (SEC Info 1).

- **Keychain:** `keychain-access-groups` on the app (`$(AppIdentifierPrefix)com.hellobonded.app`
  first, so items written without a group, like the Supabase session, stay app-only, then
  `$(AppIdentifierPrefix)com.hellobonded.app.widget`) and on the extension (the widget group only).
  EAS `appExtensions` gets the same entitlement.
- **Bridge:** Info.plist `BondedWidgetKeychainGroup` → the module constant `keychainAccessGroup`
  (nil when absent or unexpanded) → `src/features/widgets/tokens.ts` stores the token there
  (expo-secure-store: service `bonded.widget:no-auth`, account `Data("token")`,
  `AfterFirstUnlockThisDeviceOnly`). `takeActionQueue()` hands the app the `{widget_kind, action}`
  entries the extension queued (App Group key `bonded.widget.actions`; Android prefs `actions`).
- **Extension** (`ios/premium/`, compiled only with `premium`): `WidgetTokenStore` (read only),
  `WidgetClient` (`POST <BondedSupabaseURL>/functions/v1/widget`, Bearer token, no cache, no logs),
  `WidgetActionQueue`, `BondedPremiumCopy.swift` (generated from en.json `widgets.*`) +
  `BondedCopyFormat`, App Intents `SendLittleThingIntent` / `UndoLittleThingIntent`
  (`openAppWhenRun = false`, `isDiscoverable = false`, `.requiresAuthentication`), the Little things
  widget (Home Screen small/medium only; the partner's name is `.privacySensitive()` and swapped for
  neutral "Send a hug" / "Sent" when redacted, since StandBy shows it on a locked phone) and two read-only Lock Screen widgets (Today's question,
  Thinking of you) with `.privacySensitive()` and neutral lines when redacted. iOS 17+.
- **Lock Screen / Control Center send** (`LockScreenSend.swift`; SEC-21 recommended default, lead
  decision 2026-11-14): a Lock Screen circular "Send a hug" (same `SendLittleThingIntent`) and the
  iOS 18 `ControlWidgetButton` "Send a hug" (`SendHugControlIntent`, same send path). Both keep
  `.requiresAuthentication`: a locked phone asks to unlock before anything is sent. No partner
  name, no question. The control opens the paywall / Today when the send cannot happen (iOS 18.2+).
- **Not here yet:** Days / Streak / Mood / On this day / Ritual widgets, `BGAppRefreshTask` token
  refresh. Android: see the next section.

**Swift typecheck (no build, no simulator):** generate the extension's Swift with `iosFiles()` for
`premium: true` into a temp folder, then
`xcrun --sdk iphonesimulator swiftc -typecheck -parse-as-library -application-extension -target arm64-apple-ios16.4-simulator -module-name BondedWidgets *.swift`
(also `-swift-version 6` and targets 18.0 / 18.2). `-application-extension` matters: without it the
`iOSApplicationExtension` availability checks do not apply. `BondedWidgetsModule.swift` needs an
ExpoModulesCore stub module (`-I <stub dir>`).

**Device build check:** in a temporary copy, `npx expo prebuild --clean --no-install` with `premium: true`, then
`xcodebuild -project ios/Bonded.xcodeproj -target BondedWidgetExtension -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO build`
and a dev build on REL-A: the token is readable from the extension, `$(AppIdentifierPrefix)` is
expanded in Info.plist, the buttons send without opening the app, Undo works within 5 s, and the
Lock Screen widgets redact while locked.

- **Done 2026-11-14 (Xcode 27.2, iOS 18.0 simulator):** the extension target builds with 0 errors
  and 0 warnings. The full app (Release, simulator, ad-hoc `CODE_SIGN_IDENTITY=-`, after `pod install`)
  builds, installs on REL-A and launches. chronod registers every kind (including Little things
  small/medium, Lock question / thinking, Lock send circular) and the `BondedSendHug` control
  (`SendHugControlIntent`). The extension process starts with no errors or faults.
  `$(AppIdentifierPrefix)` is expanded the same way in both Info.plists and both simulated
  entitlements (`FAKETEAMID.` without a team; the real prefix with a team).
- **Still open:** the token read from the extension, send/Undo, `.requiresAuthentication` and the
  Lock Screen redaction. These need a signed-in, paired Premium account and a served `widget`
  function, plus a real device for unlock and locked-keychain behaviour. The Kotlin
  `takeActionQueue` compiles in the MOB-78 Gradle build below.
- **Gotchas:** if you copy the repo with `rsync --exclude ios`, the exclude also drops
  `plugins/widgets/ios`; copy `plugins/` again afterwards. xcodebuild needs the sandbox off. The
  copy needs `.env`, or the JS throws `Missing EXPO_PUBLIC_SUPABASE_URL` at launch. A Release build
  with a RevenueCat `test_` key shows "Wrong API Key" and closes; use Debug + Metro for flows.

## Premium widgets on Android (MOB-78, D59, SEC-21): behind the same `premium` prop

- **Backup (SEC-21 MOB-78 check 1, SEC-25 Info 1):** the plugin always (premium or not) writes
  `res/xml/bonded_backup_rules.xml` (`full-backup-content`, Android 11 and lower) and
  `res/xml/bonded_data_extraction_rules.xml` (`cloud-backup` + `device-transfer`, Android 12+) and
  points the application's `fullBackupContent` / `dataExtractionRules` at them. Same scope as
  expo-secure-store's old rules (only `sharedpref` `.` is included), minus `SecureStore.xml` (the
  MMKV key and the widget token) and every widget prefs file (`ANDROID_BACKUP_EXCLUDED_PREFS` in
  `index.js`: `bonded_widgets`, `bonded_widget_little_things`, `bonded_widget_days_together(_seen)`,
  `bonded_widget_streak(_seen)`). Backup rules have no wildcards: **a new `getSharedPreferences`
  file needs a new entry**; `androidBackup.test.ts` reads the names from every widget Kotlin source
  and fails otherwise. `app.config.ts` registers `expo-secure-store` with
  `configureAndroidBackup: false` so it only removes its own rule paths and never warns or fights
  ours. `allowBackup` is unchanged (template `true`). The test runs every plugin of app.config.ts on
  an in-memory manifest.
- **Token reader** (`android/premium/kotlin/BondedLittleThings.kt`, `WidgetTokenStore`): read only.
  expo-secure-store 58 layout: prefs `SecureStore` (MODE_PRIVATE), key `bonded.widget-token`, value
  JSON `{ct, iv, tlen, scheme: "aes", usesKeystoreSuffix: true, keystoreAlias: "bonded.widget",
  requireAuthentication: false}`, AndroidKeyStore alias
  `AES/GCM/NoPadding:bonded.widget:keystoreUnauthenticated` (AES-256-GCM, no user auth); plaintext
  `{"token":"bwt_…","expires_at":"…"}`. If expo-secure-store changes this layout the widget shows
  "Open Bonded" (the test pins the names against node_modules).
- **Client** (`WidgetClient`): `POST <supabaseUrl>/functions/v1/widget`, `Authorization: Bearer`,
  `useCaches = false`, no redirects, 3 s connect / 3 s read, nothing logged. 401 → "Open Bonded",
  403 / `premium:false` → locked preview, 409 → limit / undo expired.
- **Little things widget** (`BondedLittleThingsWidget`, RemoteViews, resizable; 2 x 2 shows the hug,
  wider shows hug / good morning / goodnight): taps are explicit `FLAG_IMMUTABLE` broadcasts to
  `BondedLittleThingsActionReceiver` (exported="false", no intent-filter), one requestCode per kind;
  the receiver re-checks the kind and sends in `goAsync()` on a background executor (new client id per
  tap, one retry with the same id). "Sent" + Undo for 5 s (alarm redraw), limit and failed lines,
  locked preview → `bonded://paywall?from=widget&widget_kind=little_things`, expired → Today. The
  widget's own prefs `bonded_widget_little_things` hold only the partner's first name, `premium`, the
  per-kind `at_limit` and the last tap's status. REFRESH from the app (sign-out writes the empty
  snapshot) drops to "Open Bonded" when the token is gone.
- **Partner name on the lock screen (SEC Info 2):** RemoteViews has no redaction like iOS
  `.privacySensitive()`. The provider is `home_screen` only, so launchers should never put it on the
  lock screen; if a host still reports `OPTION_APPWIDGET_HOST_CATEGORY` = keyguard, the widget draws
  the neutral "Send a hug" / "Sent" instead of the name. The endpoint comes from the same
  https-only `supabaseUrl` check as iOS (SEC Info 1).
- **`hasTokenReader`:** with `premium` the plugin adds application meta-data
  `com.hellobonded.widgets.TOKEN_READER=true`; the bridge module reads it. Without it the app never
  mints on Android.
- **Copy:** `BondedPremiumCopy.kt` generated from en.json `widgets.*` (same keys as iOS).
- **Days together (38c-3, MOB-78e):** `BondedDaysTogether.kt`, provider `BondedDaysTogetherWidget`
  (exported="false", APPWIDGET_UPDATE + REFRESH, home screen, 2 x 2 resizable to 4 x 2 / 4 x 1).
  Read-only: one `state` call through the shared `WidgetClient`, no action receiver. Draws
  `days_together` + the first `next_key_dates` entry, or `days_in_bonded` + "Add dates" when there
  are no key dates; taps open `bonded://us`, "Add dates" opens 47 `bonded://quiz/dates` (#497,
  **deviation**: spec 38c §3.3 says "Us tab, key dates", but Us has no key-dates screen yet, D50 (7);
  47 now writes the dates straight away for a paired couple; point both at the Us key-dates screen
  once it exists). Locked (free/lapsed) → paywall
  `from=widget&widget_kind=days_together`; 401 or no token → "Open Bonded". Its own prefs
  `bonded_widget_days_together` keep the numbers, the key-date kind/whose and the partner's first
  name only (never drawn on a keyguard host); locked/401 clear them. Typechecked with kotlinc
  (recipe below); not yet built with Gradle or run on a device. MOB-78f: 4 x 2 also shows the
  second `next_key_dates` entry; 4 x 1 (max height under 100 dp) is a bar with no title row and no
  button ("Add dates" / "Open Bonded" become its line); the picker description is
  `widgets.days.description`.
- **Streak (38c-4, MOB-78f):** `BondedStreak.kt`, provider `BondedStreakWidget` (exported="false",
  APPWIDGET_UPDATE + REFRESH, home screen, 2 x 2 resizable to 4 x 2 / 4 x 1). Read-only like Days
  together. Draws `streak.current` + "N days to badge T" (`streak.next_badge.threshold`); 4 x 2 adds
  six steps of the 1-3-7-14-21-30-50-100-365 ladder (reached filled, next dashed); 2 x 2 has a
  progress bar (current / next badge, as the board's 12 of 14); 4 x 1 is a bar
  (no title, no button). States: `saver_available` → "Saver ready" + "Use saver" (opens
  `bonded://today`, where the app's saver card is; the widget never spends a saver), `current` 0 +
  `mascot` napping → "Napping today", `current` 0 → "Start a streak today"; default taps open
  `bonded://us/badges`. Locked → paywall `from=widget&widget_kind=streak`; 401 or no token → "Open
  Bonded". Own prefs `bonded_widget_streak`: two numbers and two flags, no names; locked/401 clear
  them. Typechecked with kotlinc; not yet built with Gradle or run on a device.
- **One shared `state` read (MOB-78i, SEC-25 Info 3):** `WidgetClient.state` goes through
  `StateMemo` (BondedLittleThings.kt), like iOS's MOB-78d memo: Days together, Streak and Little
  things refreshing together join the one read in flight, and a successful (Premium) read serves
  them for 30 s (`elapsedRealtime`). Memory only, same token only; failed, locked and expired reads
  are never kept, and a send or undo drops it, as do no token and a 401 (MOB-78j, on iOS too). The app's `reloadWidgets()` stamps its
  APPWIDGET_UPDATE broadcasts with `EXTRA_RELOAD_AT`; each provider's `onReceive` calls
  `StateMemo.noteReload` first, so a lapse or upgrade the app saw is never answered from an older
  read. Failure behaviour per widget is unchanged. Typechecked with kotlinc; not yet Gradle-built.
- **Kotlin typecheck (no Gradle):** generate the files with `androidFiles()` for `premium: true`, add
  an `R` stub object with the ids/layouts/drawables/strings, then
  `"/Applications/Android Studio.app/Contents/plugins/Kotlin/kotlinc/bin/kotlinc" -classpath ~/Library/Android/sdk/platforms/android-37.0/android.jar -no-reflect -jvm-target 17 -d out *.kt`
  (JAVA_HOME = Android Studio's `jbr/Contents/Home`, `-J-Djava.io.tmpdir=$TMPDIR` in the sandbox).
  The bridge module compiles the same way against a stub of expo-modules-core's `Module`,
  `ModuleDefinition`, `Name`, `Constant`, `Function` (incl. the `FunctionWithoutArgs` overload).
- **Gradle + emulator check (2026-11-14, emulator-5554, Android 17):** with `premium: true` in a temp
  copy, `npx expo prebuild --clean --no-install --platform android` then
  `./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a` (outside the sandbox) builds with no
  errors or warnings in the widget Kotlin. Merged manifest: the three providers and the action
  receiver are `exported="false"`, `TOKEN_READER` meta-data present, `fullBackupContent` /
  `dataExtractionRules` = expo-secure-store's rules at the time (`exclude sharedpref
  path="SecureStore"`; the framework adds `.xml` for sharedpref excludes, see `FullBackup.java`);
  since SEC-25 Info 1 they are the plugin's `bonded_*` rules (not yet Gradle-checked). On the emulator all three
  appear in the picker (non-exported providers are fine), Little things is home-screen only, draws
  the no-token state ("Tap to catch up" / Open Bonded) and its tap opens `bonded://today`; no
  `bwt_` in logcat.
- **Not here yet:** the other 7 widgets, Material You colours (`values-v31` dynamic colours), a
  WorkManager / push token refresh, Thinking of you, and a run with a real minted token (needs a
  signed-in paired account and a Premium backend).

## Why RemoteViews and not Glance (Android)

Glance is Jetpack Compose: it needs the Compose compiler Gradle plugin in the app module, pinned to
the app's Kotlin version, and Compose runtime libraries in the APK. Expo regenerates `android/` and
owns the Kotlin and AGP versions, so every SDK upgrade could break the widget build. These widgets are
static (text, an image, a button, a countdown), which RemoteViews covers fully, including a live
countdown (`Chronometer`) and night colours (`values-night`). No new dependency.

## Art and colours

- Mascot stills come from `design-handoff/assets/mascot/*.svg` at prebuild: SVG in the iOS asset
  catalog (vector preserved), VectorDrawables on Android (`svgToVector.js`). Dashed strokes (the empty
  seat) are drawn solid on Android.
- Colours are generated from `src/ui/tokens.json` (`BondedColors.swift`, `values/` + `values-night/`).
- Fonts are the system fonts (rounded on iOS); Outfit and DM Sans are not bundled into the extension.

## Checks

- `src/features/widgets/__tests__/plugin.test.ts`: the plugin's iOS target, App Group, Android
  receivers and generated files.
- `npx expo prebuild --clean --no-install`, then (no Pods needed)
  `xcodebuild -project ios/Bonded.xcodeproj -target BondedWidgetExtension -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO build`.
  Delete `ios/` and `android/` afterwards.
