# Release validation: REL-07e re-run, device rechecks of #302, #327 and MOB-25 (main fec1933)

Re-run of the REL-07e device checks that were blocked by host load (report `REL-07e-device-checks.md`).
Covers #302 (fix for #295 / #291: Android 38b "Your turn" countdown left of the mascot), #327 (fix for #324:
Bonded app icon and splash) and the MOB-25 release device checks (#297). **Not a store GO/NO-GO**: local Release
builds against a local stack. Run 2026-11-12 13:32-15:35 EET, one device at a time (Android first, then iOS).

## 1. Build identity
| Field | Android | iOS |
|---|---|---|
| Version / build | 0.1.0 (versionCode 1), `com.hellobonded.app` | 0.1.0 (1), `com.hellobonded.app` |
| Commit | `main` fec1933 (Merge #327; contains #302 ec767dd and #297 464684c) | same |
| EAS profile / channel | none: `CI=1 expo prebuild -p android --no-install`, `./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a`; local-only `android:usesCleartextTraffic="true"` (as REL-07b-e) | `expo prebuild -p ios`, `pod install`, `xcodebuild -configuration Release -sdk iphonesimulator ARCHS=arm64 ONLY_ACTIVE_ARCH=YES` (ad-hoc signed) |
| Build env | `EXPO_PUBLIC_SUPABASE_URL=http://10.0.2.2:57521`, local demo anon key, `EXPO_PUBLIC_SHIP_LITTLE_THINGS=1`, `EXPO_PUBLIC_SHIP_PREMIUM_HISTORY=1`, `EXPO_PUBLIC_SHIP_VOICE=1`; no RevenueCat / PostHog key | same with `http://127.0.0.1:57521` |
| Backend | isolated local stack `rel07e2` (copy of `supabase/` in /tmp/rel07e2, ports 575xx); scenarios from `qa:scenario` | same stack |
| Devices | emulator-5554, AVD `Medium_Phone_API_37.0`, Android 17 (API 37), Pixel launcher, 1080x2400, started with `-cores 4 -memory 4096` | REL-B (iPhone SE 3rd gen, iOS 18.0) |

Host load: 18-33 at the Android build and session (the previous run had 110-180). `assembleRelease`:
`BUILD SUCCESSFUL in 7m 49s` (`AND-gradle-assembleRelease.log`).

## 2. Results
Evidence lives in `qa/release/evidence/fec1933-rel07e2/` (local, gitignored as for every report). Maestro flows in
`flows/`, their screenshots under `mob25-3btn/`, `picker/`.

### 2.1 Android (emulator-5554)
| # | Check | Result | Evidence |
|---|---|---|---|
| A1 | `assembleRelease` arm64-v8a, install on emulator | **pass** | `AND-gradle-assembleRelease.log`; `adb install` Success |
| A2 | #327: launcher shows the Bonded adaptive icon (two buns in the basket on cream), not the Expo template | **pass** | `AND-icon-drawer-light.png` (hotseat "Predicted app: Bonded"; the yellow ring is the Pixel predicted-app ring); widget picker header icon `AND-picker-previews-light.png` |
| A3 | #327: themed / monochrome icon (Wallpaper & style > Icons > "Minimal", Android 17's themed style) | **pass** | `AND-icon-themed-dark.png`: Bonded monochrome silhouette tinted like the other themed icons. Style set back to Default afterwards |
| A4 | #327: splash, light and dark | **pass** | `AND-splash-light-2.png` (buns on cream), `AND-splash-dark-2.png` (buns on dark), then 01 (`AND-splash-light-4.png`) |
| A5 | #302: 38b yourTurn, light, default font: timer fully left of the mascot, all digits | **pass** | `AND-home-yourTurn-light-default.png` ("Your turn · 11:04:23 · to keep your streak · Answer now") |
| A6 | #302: 38b yourTurn, dark, default font | **pass** | `AND-home-yourTurn-dark-default.png` |
| A7 | #302: 38b napping, light and dark, default font | **pass** | `AND-home-napping-light-default.png`, `AND-home-napping-dark-default.png` ("to start a streak", sleeping mascot) |
| A8 | #302: 38b at font scale 1.3, 1.5, 1.8 | **pass** | `AND-home-yourTurn-light-font1.3.png`, `-font1.5.png`, `-font1.8.png` (1.8 fits with no margin) |
| A9 | #302: 38b at the largest font size (font scale 2.0), yourTurn + napping, light + dark | **FAIL** -> #340 | `AND-home-yourTurn-light-font200.png`, `-font200-b.png`, `AND-home-yourTurn-dark-font200.png`, `AND-home-napping-{light,dark}-font200.png`: timer shows "11:03:2" (text "11:03:21", `AND-yourTurn-font200-hierarchy.txt`) |
| A10 | #302: picker preview of "Your turn", light, dark and font 2.0 | **pass** | `AND-picker-previews-light.png`, `AND-picker-previews-dark.png`, `AND-picker-previews-light-font200.png` ("00:00" left of the mascot) |
| A11 | 38b Partner answered (unchanged by #302, seen on the way) | **pass** | `AND-home-partnerAnswered-light.png` |
| A12 | MOB-25: hardware back closes the little-things fan (24c) and stays on Today | **pass** | animations on: `AND-MOB25-fan-open-3btn.png`, `AND-MOB25-fan-after-back.png`; flow `flows/mob25-back.yaml` (`AND-MOB25-back-maestro-3btn.txt`) |
| A13 | MOB-25: hardware back closes every sheet reached: 40 ritual, 40 sign-out, 41 quiet hours, 42 stage, 42 names, 42 topics, 42 unpair, 22 emoji picker; one back closes only the sheet (screen stays) | **pass** | `AND-MOB25-back-maestro-3btn.txt` (all asserts COMPLETED), screenshots `mob25-3btn/*/takeScreenshot/`; picker `AND-3btn-22-picker-open.png`, `-after-back.png` |
| A14 | MOB-25: 3-button navigation: every sheet above and the fan clear the nav bar (edge-to-edge) | **pass** | `mob25-3btn/.../AND-MOB25-3btn-*-open.png`, `AND-3btn-22-picker-open.png`: sheet content and buttons end above the 3-button bar |
| A15 | Gesture navigation: edge-swipe back closes the sheet (40 sign-out), sheet clears the gesture handle | **pass** | `AND-gesture-40-signout-open.png`, `AND-gesture-40-signout-after-edge-swipe.png` |
| A16 | MOB-25: back with TalkBack running | **blocked** | TalkBack's first start on this AVD opens its own permission dialog over the app, so the back press went to that dialog; TalkBack's Back action sends the same system back the hardware-back checks above prove. Needs a hand check with TalkBack set up (or a phone) |
| A17 | Sheets not reachable in this build: 17 exit sheet, 57 payment failed (need RevenueCat offerings), badge 52 / check-in sheets (need their triggers), 12 pairing confirm | **n/a here** | same `Sheet` component (`onRequestClose`) as A13 |

Notes:
- Sheet checks A12-A14 ran with "Remove animations" on (animator/transition/window scales 0), because Maestro and
  `uiautomator dump` never see an idle screen while the napping mascot animates. A12 was also checked with
  animations on (screenshots). Scales were set back to 1 afterwards.
- `enableOnBackInvokedCallback="false"` in the manifest: predictive back is off by design; plain back works.

### 2.2 iOS (REL-B)
The lead stopped the session (time limit) right after the iOS build; only the build and install ran.

| # | Check | Result | Evidence / reason |
|---|---|---|---|
| I1 | Release build arm64, install on REL-B | **pass** | `IOS-xcodebuild.log`: `** BUILD SUCCEEDED **` (about 35 min: host load 60-620 from other workloads); bundle points at the local stack (`strings` count 1); `simctl install` OK |
| I2 | #327: Bonded icon on the home screen, light and dark (iOS 18 dark variant) | **not run (time)** | the Maestro springboard flow failed to start at load ~620 (other workloads); then the session ended |
| I3 | #327: splash light and dark | **not run (time)** | |
| I4 | MOB-25: largest text size (AX5; AX2 = ~200 %) on 02, 18-21, 22, 33/34: no clipping or truncation | **not run (time)** | flows ready: `flows/ios-02.yaml`, `flows/ios-shots.yaml` |
| I5 | MOB-25: Reduce Motion on: still mascot, no confetti, hold becomes tap + confirm on 20 | **not run (time)** | |
| I6 | MOB-25: VoiceOver two-finger escape closes sheets + fan | **blocked** | needs a real iPhone (PO) |

## 3. Failed checks
| Check | Platform | Issue | Severity |
|---|---|---|---|
| A9: 38b countdown cuts its last digit at the largest font size | Android | #340 (new) | sev-3 (suggested) |

## 4. Blocked checks
| Check | Platform | Reason | Needed to unblock |
|---|---|---|---|
| A16 back with TalkBack running | Android | TalkBack first-run dialog on the AVD | hand check with TalkBack set up, or a phone |
| VoiceOver two-finger escape closes sheets + fan | iOS | VoiceOver gestures are not available in the Simulator | real iPhone (PO) |
| I2-I5 icon, splash, AX5 text, Reduce Motion | iOS | not run: session time limit (host overloaded by other workloads during the iOS build) | next run on REL-B |

## 5. Evidence index
`qa/release/evidence/fec1933-rel07e2/` (git-ignored, local only): `AND-*`, `IOS-*`, build logs, Maestro flows in
`flows/` and their outputs in `mob25-3btn/`, `picker/`. No answer or message text in any log; the 21/22 screenshots
show seeded fixture answers, which is the screen under test.

## 6. Residual risks
- Android only on the Pixel launcher of an Android 17 emulator at 420 dpi; narrower cells or other launchers may
  hit #340 at smaller font scales than 2.0.
- TalkBack-specific back not driven (A16).
- The whole iOS half (I2-I5) is still owed.

## 7. Decision
#302: **pass** at default and enlarged font sizes and in the picker; **fail at the largest font size** (#340, sev-3
suggested). #327: **pass on Android**, iOS not run. MOB-25 Android: back closes the fan and every reachable sheet, sheets
clear the 3-button bar and the gesture handle: **pass**; TalkBack-running back blocked. MOB-25 iOS: not run (time);
VoiceOver escape needs a phone. Not a release GO/NO-GO (local builds).

## 8. Devices
emulator-5554 (started by this session) killed 14:42; REL-B booted 15:21, shut down 15:35. Emulator nav mode set back
to gestural, animation scales 1, font scale 1.0, light mode, icon style Default. Stack `rel07e2` stopped.

Validated by: Release Validator · Date: 2026-11-12 15:35 EET
