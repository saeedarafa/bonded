# Release validation: REL-07c widgets 38 / 38b (#284) and the #282 thread title (main 2c79f14)

Device check of MOB-30 / MOB-57 (home and lock-screen widgets, merged in #284) and of #282 (fixes #280, title of 22
for a past day). **Not a store GO/NO-GO**: local Release builds against a local stack. Run 2026-11-12 06:20-07:30 EET
(couple timezone Europe/Berlin).

## 1. Build identity
| Field | iOS | Android |
|---|---|---|
| Version / build | 0.1.0 (1), `com.trybonded.app`; widget extension `com.trybonded.app.widgets` 0.1.0 (1) | 0.1.0 (versionCode 1), `com.trybonded.app`, targetSdk 36, compileSdk 37 |
| Commit | `main` 2c79f14 (Merge #284; includes #282 and #281) | same |
| EAS profile / channel | none: `expo prebuild -p ios --clean --no-install`, `pod install`, `xcodebuild -workspace -scheme Bonded -configuration Release -sdk iphonesimulator`, ad-hoc signed (qa/e2e/README.md recipe) | none: `expo prebuild -p android --clean --no-install`, `./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a`. Local build output only: `android:usesCleartextTraffic="true"` (as in REL-07b) and, for the snapshot dump, a second build with `debuggable true` on the release build type (`run-as` needs it; the first, non-debuggable APK built the same way) |
| Build env | `EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:57521`, local demo anon key, `EXPO_PUBLIC_SHIP_LITTLE_THINGS=1`, `EXPO_PUBLIC_SHIP_PREMIUM_HISTORY=1`, `EXPO_PUBLIC_SHIP_VOICE=1`; no RevenueCat / PostHog key | same with `http://10.0.2.2:57521` |
| Backend (Supabase project) | isolated local stack `rel07c` (copy of `supabase/` in /tmp, ports 575xx, edge-runtime/studio off), all migrations to `20261112100000`; scenarios from `qa:scenario` | same stack |
| RevenueCat environment | none | none |
| Devices + OS versions | REL-A iPhone 16 Pro Max, iOS 18.0 (only device booted; shut down after) | emulator-5554, AVD `Medium_Phone_API_37.0`, Android 17 (API 37), Pixel launcher, 1080x2400, started with `-no-snapshot-save -cores 4 -memory 4096`; killed after |

## 2. Scope
1. MOB-30 / MOB-57 widgets: build of the app and the extension; 38 "Bonded" (small, medium, lock screen) and 38b
   "Your turn"; states yourTurn, partnerAnswered (while the app is open), waiting, bonded, napping, solo, signed
   out; light and dark; tap opens Today; sign-out clears the name; the stored snapshot has no answer, message or
   question text; extension version = app version. RC_CHECKLIST FUN-15, FUN-20, FUN-04 (widget part).
2. #282: 22 for a past day (29 -> 30 -> thread) is titled "Thread"; today's thread stays "Today's thread".

How the states were reached: scenario `streak-11-your-turn` with Sam's answer for today removed (yourTurn), put back
by SQL while Maya's app is on Today (partnerAnswered, via realtime), Maya answers in the app (iOS) or by SQL while
the app is open (Android) with Sam's removed (waiting), Sam's put back (bonded); then `missed-day-napping`,
`solo-invite-pending` (app relaunched after each seed), then sign-out from 40. Typed answer text starts with
`FIXTURE-E2E`.

## 3. Results
### 3.1 Builds
| Check | Platform | Result | Evidence (under `qa/release/evidence/2c79f14-rel07c/`) |
|---|---|---|---|
| App + widget extension build (prebuild + Pods + xcodebuild Release) | iOS | **pass** | `IOS-xcodebuild.log`: `** BUILD SUCCEEDED **`, 0 errors; `Bonded.app/PlugIns/BondedWidgetExtension.appex` embedded. Both binaries carry the simulated entitlement `com.apple.security.application-groups = group.com.trybonded.app`; Info.plist `BondedAppGroup` = `group.com.trybonded.app` in both |
| Extension CFBundleVersion / CFBundleShortVersionString = app's | iOS | **pass** (local prebuild) | app 0.1.0 (1), extension 0.1.0 (1) in the built Info.plists. The extension's Info.plist has **literal** values written at prebuild (not `$(CURRENT_PROJECT_VERSION)`) — see 5 (EAS remote versioning) |
| App build with the widget receivers (gradle assembleRelease) | Android | **pass** | `AND-gradle-assembleRelease.log`: `BUILD SUCCESSFUL in 6m 32s`; merged manifest has both receivers (`AND-merged-manifest-widgets.txt`); `AND-apk-badging.txt` |

### 3.2 Widgets on iOS (REL-A)
| Check | Result | Evidence |
|---|---|---|
| Add "Bonded" small and medium and "Your turn" from the widget gallery (search "Bonded"; three pages) | **pass** | `IOS-gallery-yourturn-38b.png`; all three on the home screen in `IOS-home-yourTurn-light.png` |
| yourTurn: 38b Countdown "Your turn · 18 hr, 20 min · to keep your streak · Answer now"; 38 small "Day 12 · Your turn"; medium "Your turn · 11-day streak · Left today 18 hr, 20 min" (deadline = 00:00 Berlin, `dayEndsAt` 23:00Z) | **pass** | `IOS-home-yourTurn-light.png`, `-dark.png`, `IOS-snapshot-yourTurn.json` |
| partnerAnswered, written while the app is open (realtime): 38b lock icon "Sam answered · Reply to see theirs."; small "Sam answered · your turn"; medium "Sam answered" + countdown; no answer text | **pass** | snapshot rewritten within 8 s of the insert (`IOS-snapshot-partnerAnswered.json`), `IOS-home-partnerAnswered-dark.png`, `-light.png` |
| waiting: "Waiting for Sam" (small, 38b), medium "You answered" | **pass** | `IOS-home-waiting-light.png`, `IOS-snapshot-waiting.json` |
| bonded: "Both answered", celebrating pose with heart, medium "Next question in 18 hr, 17 min", streak 12 | **pass** | `IOS-home-bonded-dark.png`, `-light.png`, `IOS-snapshot-bonded.json` |
| napping: "Bao and Bun are napping" (napping pose), 38b Countdown "to start a streak" (missed day) | **pass** | `IOS-home-napping-light.png`, `-dark.png`, `IOS-snapshot-napping.json` |
| solo: "Day 1 · Waiting for Sam to join", saving-a-seat pose; medium "Answer first. They see yours once they join and reply." | **pass** | `IOS-home-solo-light.png`, `-dark.png`, `IOS-snapshot-solo.json` |
| signed out: "Bonded · Open Bonded to start", no name; snapshot `state:none`, `partnerName:null` | **pass** | `IOS-home-signedOut-light.png`, `-dark.png`, `IOS-snapshot-signedOut.json` |
| Light and dark | **pass** | every state above in both appearances (warm light card, dark `#1B140F`-family card) |
| Tap opens Today: 38b cold (app killed) -> `bonded://today?widget=countdown`, Today; 38 medium and small warm (`?widget=today`), also from the History tab | **pass** | `IOS-tap-38b-cold.png`, `IOS-tap-38-medium-warm.png`, `IOS-tap-38-small-warm.png`, `IOS-tap-38-medium-from-history.png` (URLs from the system log) |
| FUN-15 after a reboot with the app killed: partnerAnswered still shows "Sam answered", no text | **pass** | `IOS-gallery-38b-after-reboot-killed.png`, `IOS-home-partnerAnswered-after-reboot-killed.png` (the simulator lost its second home page on reboot, so 38b was re-added; it reads the stored snapshot without the app running) |
| Snapshot has no answer, message or question text | **pass** | 9 dumps (`IOS-snapshot-*.json`): exactly the 12 keys of `WidgetSnapshot`; no `FIXTURE`, no seed answer or question words. Read from the App Group plist (see note) |
| Lock-screen widgets (rectangular, inline, circular) | **blocked** | the simulator can't be locked from the command line (Simulator's Device > Lock needs the GUI; scripting it was refused). The extension declares `.accessoryRectangular, .accessoryInline, .accessoryCircular` for `BondedToday` (`BondedWidgets.swift:289-290`). Needs a hand check on a phone or the Simulator GUI |

Note: `xcrun simctl spawn <udid> defaults read group.com.trybonded.app bonded.widget.snapshot` reports "does not
exist": `defaults` in the simulator reads the global domain, not the App Group container. The snapshot is in
`$(xcrun simctl get_app_container <udid> com.trybonded.app groups)/Library/Preferences/group.com.trybonded.app.plist`.

### 3.3 Widgets on Android (emulator-5554)
| Check | Result | Evidence |
|---|---|---|
| Add "Bonded" (38) and "Your turn" (38b) from the widget picker | **pass** for 38, **fail** for 38b | picker preview of "Your turn" reads "Couldn't add widget." (`AND-picker-previews.png`) |
| 38b in yourTurn / partnerAnswered / napping (Countdown and Partner answered layouts) | **fail** -> #286 (sev-2) | "Can't load widget"; logcat `InflateException ... layout/bonded_widget_countdown line #44: Class not allowed to be inflated android.view.View` (`AND-yourturn-inflate-error-logcat.txt`, `AND-home-yourTurn-dark-38b-cant-load.png`, `AND-home-partnerAnswered-light.png`, `AND-home-napping-light.png`) |
| 38b in waiting / bonded / solo / signed out (falls back to the 38 small layout) | **pass** | `AND-home-waiting-light.png`, `AND-home-bonded-dark.png`, `AND-home-solo-light.png`, `AND-home-signedOut-light.png` |
| 38 small (2 x 2) yourTurn "Day 12 · Your turn" and 38 resized to medium (4 x 2) with live `Chronometer` | **pass** | `AND-home-yourTurn-dark.png` (medium "Your turn · 11-day streak · Left today 17:43:35") |
| 38 states: partnerAnswered (while the app is open) "Sam answered · Reply to see theirs.", waiting "You answered", bonded "Both answered" + heart, napping, solo, signed out "Bonded · Answer a question together every day." | **pass** with layout nits -> #287 (sev-4) | the `AND-home-*` screenshots; bonded medium wraps "Next question in 17:4 / 0:05", solo medium cuts the sub line with "..." |
| Light and dark (`values-night`) | **pass** | partnerAnswered, napping, solo, signed out, bonded in both (`-light` / `-dark`) |
| Tap opens Today: 38 medium -> `bonded://today?widget=...` START, Today; 38b (small layout) same | **pass** | `AND-tap-38.png` + `AND-tap-38-logcat.txt`, `AND-tap-38b.png` + `AND-tap-38b-logcat.txt` |
| Sign-out clears the name | **pass** | `AND-snapshot-signedOut.xml`: `state:none`, `partnerName:null`; `AND-home-signedOut-*.png` |
| Snapshot in shared_prefs (`bonded_widgets.xml` / `snapshot`) has no text | **pass** | 7 dumps (`AND-snapshot-*.xml`, via `run-as` on the debuggable build): one key, the 12 snapshot fields, no `FIXTURE`, no seed answer or question words |
| Lock-screen (keyguard) | **n/a** | phones on Android 5+ have no keyguard widgets; `widgetCategory="home_screen|keyguard"` only matters on hosts that support it |

Observation (not filed): after `am force-stop`, a tap on the 38 widget did nothing until the app had been opened
once (Android cancels a force-stopped app's PendingIntents and stops its broadcasts). A user "Force stop" is rare;
swiping the app away does not do this.

### 3.4 #282: thread title (22)
| Check | Platform | Result | Evidence |
|---|---|---|---|
| History (29) > Nov 11 > 30 > Open thread: title "Thread" | iOS | **pass** | Maestro `assertVisible: "Thread"` + `assertNotVisible: "Today's thread"` passed; `IOS-282-22-past.png` |
| Today > 20 hold > 21 > Talk about it: "Today's thread" | iOS | **pass** | Maestro `assertVisible: "Today's thread"`; `IOS-282-22-today.png` |
| History > Nov 11 > 30 > Open thread: "Thread" | Android | **pass** | `AND-282-29.png`, `AND-282-30-past.png`, `AND-282-22-past.png` |
| Today > 20 hold > 21 > Talk about it: "Today's thread" | Android | **pass** | `AND-282-22-today.png` |

Counts: pass 31 (iOS 17, Android 14 incl. builds and #282), fail 2 (Android 38b, Android 38 layout nits), blocked
1 (iOS lock screen), n/a 1 (Android keyguard).

## 4. Failed checks
| Finding | Platform | Issue | Severity |
|---|---|---|---|
| "Your turn" (38b) shows "Can't load widget" in its Countdown and Partner answered layouts: plain `<View>` spacers are not allowed in RemoteViews (`bonded_widget_countdown.xml:41`, `bonded_widget_partner_answered.xml:24, 56`) | Android | #286 | sev-2 (FUN-20 P0 fails on Android) |
| 38 medium: bonded countdown wraps mid-number; solo sub line truncated | Android | #287 | sev-4 |
| New, outside the widget scope: first tap on "Talk about it" (21) right after the reveal does nothing; the second works (both platforms, also seen in REL-07b on the voice play button) | iOS + Android | #288 | sev-3 |

## 5. Blocked checks
| Check | Platform | Reason | Needed to unblock |
|---|---|---|---|
| Lock-screen widgets (rectangular, inline, circular) | iOS | the simulator can't be locked without the Simulator GUI | a hand check (Simulator Device > Lock, or a phone) |
| EAS remote versioning bumps the extension's CFBundleVersion with the app's | iOS | needs an EAS build with `appVersionSource: remote` + `autoIncrement` (production profile); a local prebuild writes both from `ios.buildNumber` (1 = 1). If EAS sets the build number after prebuild only on the app target, the extension keeps the literal `1` and App Store Connect rejects the upload | the first EAS production/TestFlight build: compare `CFBundleVersion` of `Bonded.app` and `PlugIns/BondedWidgetExtension.appex` in the IPA |
| After-midnight "New question" switch | both | the run ended before couple midnight; not in this task's list | a run across 00:00 Europe/Berlin |

## 6. Evidence index
`qa/release/evidence/2c79f14-rel07c/` (git-ignored, local only): `IOS-*` (iOS), `AND-*` (Android), build logs
`IOS-xcodebuild.log`, `AND-gradle-assembleRelease.log`. No answer or message text in any log or dump; typed text
starts with `FIXTURE-E2E`. (The 21 and 22 screenshots show seeded fixture answers on screen, which is the screen
under test, not a log.)

## 7. Residual risks
- 38b on Android is broken in its main states until #286 is fixed; re-check after the fix (Countdown, Partner
  answered, napping; picker preview).
- iOS lock-screen widgets unchecked; EAS extension build number unchecked (see 5).
- Android only on the Pixel launcher of an Android 17 emulator; Samsung One UI / other launchers and Android 12-16
  not checked. Widget sizes on small phones not checked (iOS SE not used: one simulator for this task).
- Widget refresh after a reboot with the app killed checked on iOS only.

## 8. Decision
#282 **pass** on both platforms. Widgets: iOS **pass** (lock screen blocked); Android **fail** (#286, sev-2: FUN-20
P0 fails). Under the NO-GO rules a build with #286 open would be NO-GO. Not a release GO/NO-GO (local builds).

Validated by: Release Validator · Date: 2026-11-12 07:35 EET
