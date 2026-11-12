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
     `com.trybonded.widgets.REFRESH` that both receivers handle.
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
