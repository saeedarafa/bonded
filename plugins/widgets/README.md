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
**only after the device build check below**.

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
  widget (Home Screen small/medium only) and two read-only Lock Screen widgets (Today's question,
  Thinking of you) with `.privacySensitive()` and neutral lines when redacted. iOS 17+.
- **Lock Screen / Control Center send** (`LockScreenSend.swift`; SEC-21 recommended default, lead
  decision 2026-11-14): a Lock Screen circular "Send a hug" (same `SendLittleThingIntent`) and the
  iOS 18 `ControlWidgetButton` "Send a hug" (`SendHugControlIntent`, same send path). Both keep
  `.requiresAuthentication`: a locked phone asks to unlock before anything is sent. No partner
  name, no question. The control opens the paywall / Today when the send cannot happen (iOS 18.2+).
- **Not here yet:** Days / Streak / Mood / On this day / Ritual widgets, `BGAppRefreshTask` token
  refresh, Android.

**Swift typecheck (no build, no simulator):** generate the extension's Swift with `iosFiles()` for
`premium: true` into a temp folder, then
`xcrun --sdk iphonesimulator swiftc -typecheck -parse-as-library -application-extension -target arm64-apple-ios16.4-simulator -module-name BondedWidgets *.swift`
(also `-swift-version 6` and targets 18.0 / 18.2). `-application-extension` matters: without it the
`iOSApplicationExtension` availability checks do not apply. `BondedWidgetsModule.swift` needs an
ExpoModulesCore stub module (`-I <stub dir>`).

**Device build check (not done yet; the Swift is typechecked only, and the Kotlin `takeActionQueue`
was never compiled):** in a temporary copy, `npx expo prebuild --clean --no-install` with `premium: true`, then
`xcodebuild -project ios/Bonded.xcodeproj -target BondedWidgetExtension -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO build`
and a dev build on REL-A: the token is readable from the extension, `$(AppIdentifierPrefix)` is
expanded in Info.plist, the buttons send without opening the app, Undo works within 5 s, and the
Lock Screen widgets redact while locked.

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
