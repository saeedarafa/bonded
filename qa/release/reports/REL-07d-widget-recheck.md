# Release validation: REL-07d re-check of #286, #287, #288 after PR #290 (main 3d1d247)

Device re-check of the REL-07c findings fixed in PR #290: #286 (Android 38b "Can't load widget"), #287 (Android 38
medium layout), #288 (first tap on 21 after the reveal ignored) and #288v (the same on the voice play button).
**Not a store GO/NO-GO**: local Release builds against a local stack. Run 2026-11-12 08:10-10:15 EET (couple
timezone Europe/Berlin). The Android half ran in an earlier session that was stopped before the report; this
session reviewed its evidence and ran the iOS half.

## 1. Build identity
| Field | iOS | Android |
|---|---|---|
| Version / build | 0.1.0 (1), `com.trybonded.app`; widget extension `BondedWidgetExtension.appex` embedded | 0.1.0 (versionCode 1), `com.trybonded.app` |
| Commit | `main` 3d1d247 (Merge #290) | same |
| EAS profile / channel | none: `expo prebuild -p ios`, `pod install`, `xcodebuild -configuration Release -sdk iphonesimulator` | none: `expo prebuild -p android --no-install`, `./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a`; local-only `usesCleartextTraffic` and `debuggable true` (as REL-07c) |
| Build env | `EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:57521`, local demo anon key, `EXPO_PUBLIC_SHIP_LITTLE_THINGS=1`, `EXPO_PUBLIC_SHIP_PREMIUM_HISTORY=1`, `EXPO_PUBLIC_SHIP_VOICE=1`; no RevenueCat / PostHog key | same with `http://10.0.2.2:57521` |
| Backend | isolated local stack `rel07d` (copy of `supabase/` in /tmp/rel07d, ports 575xx); scenarios from `qa:scenario` | same stack |
| Devices | REL-A iPhone 16 Pro Max, iOS 18.0 (only device used; shut down after) | emulator-5554, AVD `Medium_Phone_API_37.0`, Android 17 (API 37), Pixel launcher, 1080x2400 |

The app id change to `com.hellobonded.app` (parallel mobile PR) is not in this build.

## 2. Results
### 2.1 Builds
| Check | Platform | Result | Evidence (under `qa/release/evidence/3d1d247-rel07d/`) |
|---|---|---|---|
| App + widget extension Release build | iOS | **pass** | `IOS-xcodebuild.log`: `** BUILD SUCCEEDED **` |
| App with widget receivers, `assembleRelease` | Android | **pass** | `AND-gradle-assembleRelease.log`: `BUILD SUCCESSFUL in 4m 56s` |

### 2.2 #286: 38b "Your turn" on Android
| Check | Result | Evidence |
|---|---|---|
| Widget picker preview of "Your turn" renders (was "Couldn't add widget.") | **pass** | `AND-picker-previews.png` (countdown, mascot, Answer now button) |
| 38b Countdown layout, yourTurn, dark: "Your turn · 16:17:00 · to keep your streak · Answer now" | **pass** (layout nit, see #295) | `AND-home-yourTurn-dark-38b.png` |
| 38b Partner answered layout: lock icon, "Sam answered · Reply to see theirs. · Answer now"; light and dark | **pass** | `AND-home-partnerAnswered-light.png`, `-dark.png` |
| 38b Countdown in napping: "Your turn · to start a streak", sleeping mascot; light and dark | **pass** (layout nit, see #295) | `AND-home-napping-light.png`, `-dark.png` |
| No "Can't load widget" / `InflateException` | **pass** | `AND-logcat-widgets-1.txt`: `updateAppWidget` only, no inflate error |
| Snapshot still has no answer/question text | **pass** | `AND-snapshot-{partnerAnswered,bonded,napping,solo}.xml` |
| New: countdown digits run under the mascot in the 2 x 2 Countdown layout (last digit overlaps the image) | **fail (new, sev-4)** -> #295 | `AND-home-yourTurn-dark-38b.png`, `AND-home-napping-light.png` |

### 2.3 #287: 38 medium on Android
| Check | Result | Evidence |
|---|---|---|
| bonded: "Next question in" label on one line, `Chronometer` "16:04:26" whole on its own line (was "17:4 / 0:05") | **pass** | `AND-home-bonded-dark.png`, `-light.png` |
| solo: sub line "Answer first. They see yours once they join and reply." in full on two lines (was cut with "...") | **pass** | `AND-home-solo-light.png`, `-dark.png` |
| partnerAnswered / napping medium: label + timer stacked, nothing cut | **pass** | `AND-home-partnerAnswered-light.png`, `AND-home-napping-light.png` |

### 2.4 #288: first tap on 21 "Talk about it" after the hold on 20
Scenario `streak-11-both-answered`, Maya signed in, 20 opened, hold until the seal opens, lift, wait for 21 to settle,
**one** tap on `21-talk`.

| Check | Platform | Result | Evidence |
|---|---|---|---|
| 22 "Today's thread" opens on the first tap | Android | **pass** | `AND-288-20-rest.png`, `AND-288-20-held-3s.png` (still on 20 while held: navigation now on lift), `AND-288-21-after-lift.png`, `AND-288-22-after-first-tap.png` (one `adb shell input tap`) |
| 22 "Today's thread" opens on the first tap | iOS | **pass** | Maestro `tapOn: 21-talk` with `retryTapIfNoChange: false` (one tap, no retry): `IOS-288-run1-21-after-lift.png`, `IOS-288-run1-after-first-tap.png` (22 "Today's thread"), `IOS-288-run1-maestro.txt`; flow `flows/ios-288.yaml` |
| One success haptic per reveal (PR #290 moved it to the fill, `onComplete` on lift) | Android | **pass** | `AND-vibrator-reveal.txt`: one `UNKNOWN`-usage success pattern per reveal (08:54:30, 08:58:39), only `TOUCH` ticks otherwise |

### 2.5 #288v: first tap on the partner's voice play button on 21 after the reveal
Same scenario with Sam's answer for today turned into a 2 s voice answer (seed object in the `voice` bucket; SQL
update with triggers off, test data only).

| Check | Platform | Result | Evidence |
|---|---|---|---|
| Playback starts on the first tap of `21-partner-voice-play` | Android | **pass** | `AND-288v-play-first-tap-logcat.txt`: `requestAudioFocus` from the app and the AAC decoder created at 09:02:50 right after the one tap; `AND-288v-21-after-first-play-tap.png` (taken after the 2 s clip ended); one success haptic in `AND-vibrator-reveal-voice.txt` (09:02:33) |
| Playback starts on the first tap of `21-partner-voice-play` | iOS | **pass** | one Maestro tap at 10:09:00.2 EET, no retry; the app signs and fetches the clip at 08:09:01Z (`IOS-288v-kong-storage.txt`: `POST /storage/v1/object/sign/voice/...` then 2 GETs of the signed URL; tokens redacted); `IOS-288v-run1-21-after-lift.png`, `IOS-288v-run1-after-first-tap.png`, `IOS-288v-run1-maestro.txt`. Sound itself not heard (simulator, no audio check) |

### 2.6 iOS widget sanity (38 / 38b; iOS widget code unchanged since REL-07c: #290 only touches Android layouts)
| Check | Result | Evidence |
|---|---|---|
| "Your turn" (38b) in the gallery and added to the home screen; bonded state "Day 12 · Both answered" | **pass** | `IOS-gallery-38b.png`, `IOS-home-38b-bonded.png`, `IOS-snapshot-bonded.json`; flow `flows/ios-add-38b.yaml` |
| 38b Partner answered: lock icon, "Sam answered · Reply to see theirs. · Answer now"; light and dark | **pass** | `IOS-home-38b-partnerAnswered-light.png`, `-dark.png`, `IOS-snapshot-partnerAnswered.json` (12 snapshot fields, no answer/question text) |

Counts: pass 22 (iOS 8, Android 14), fail 1 new (Android #295, sev-4), blocked 0.

## 3. Failed checks
| Finding | Platform | Issue | Severity |
|---|---|---|---|
| 38b Countdown layout: the countdown's last digit runs under the mascot (2 x 2, light and dark) | Android | #295 (new) | sev-4 |

## 4. Blocked checks
| Check | Platform | Reason | Needed to unblock |
|---|---|---|---|
| iOS lock-screen widgets | iOS | still needs the Simulator GUI or a phone (as REL-07c) | hand check |
| Voice clip heard | iOS | simulator audio not checked; request + fetch prove the tap was handled | device build |

## 5. Evidence index
`qa/release/evidence/3d1d247-rel07d/` (git-ignored, local only): `IOS-*`, `AND-*`, build logs, Maestro flows in
`flows/`. No answer or message text in any log or dump; the 21 and 22 screenshots show seeded fixture answers on
screen, which is the screen under test. `s*.png` and `tick.png` are working screenshots of the Android session.

## 6. Residual risks
- Android only on the Pixel launcher of an Android 17 emulator; other launchers, Android 12-16 and small phones not
  checked. The #295 overlap may be worse on narrower cells.
- #288 fix moves navigation to the lift: a user who keeps holding after the fill stays on 20 until they let go
  (by design in PR #290; looked fine).
- iOS lock-screen widgets and the EAS extension build number (REL-07c section 5) still unchecked.

## 7. Decision
#286 **pass** (Android 38b loads in all states; preview renders). #287 **pass** (Android). #288 and #288v **pass** on
both platforms. New #295 (sev-4, cosmetic) does not block. Not a release GO/NO-GO (local builds).

Validated by: Release Validator · Date: 2026-11-12 10:20 EET
