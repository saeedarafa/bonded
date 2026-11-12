# Release validation: REL-07f, iOS half of REL-07e on REL-B + Android #340 recheck (main 913dea1)

The iOS checks that REL-07e (`REL-07e-rerun.md`, section 2.2, I2-I5) did not run: #327 app icon and splash, the
largest Dynamic Type size on 02, 18-21, 22, 33, 34 and Reduce Motion (MOB-25). Plus the Android recheck of #340
(fixed by #344: 38b timer at font scale 2.0). **Not a store GO/NO-GO**: local Release builds against a local
stack. Session 1: 2026-11-12 15:53-16:02 EET (I2, I3). Session 2: 18:04-19:45 EET (rest). REL-B and
emulator-5554 only; REL-A not touched.

## 1. Build identity
| Field | iOS | Android |
|---|---|---|
| Device | REL-B, iPhone SE 3rd gen, iOS 18.0 Simulator (D057FF7E), 375 x 667 pt | emulator-5554, AVD `Medium_Phone_API_37.0`, Android 17 (API 37), Pixel launcher, 1080x2400, started with `-cores 4 -memory 4096` |
| Commit | Release build of `main` a8e2a96 (`xcodebuild -configuration Release -sdk iphonesimulator ARCHS=arm64 ONLY_ACTIVE_ARCH=YES`, ad-hoc). `git diff a8e2a96 913dea1` touches no iOS or JS-bundle input: only `plugins/widgets/android/res/layout/bonded_widget_countdown.xml`, a unit test, `qa/web/**`, CI and docs. So the binary is what main 913dea1 builds for iOS | `main` 913dea1 (contains #344), branch `release/REL-07f-ios` merged with it. `CI=1 expo prebuild -p android --no-install`, local-only `android:usesCleartextTraffic="true"`, `./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a` (native build, not OTA): `BUILD SUCCESSFUL in 45m 58s` (host load 500-870 from other workloads) |
| Icon + splash build (I2, I3) | the REL-07e install of `main` fec1933; `app.config.ts`, `plugins/` and `assets/` are identical on fec1933, a8e2a96 and 913dea1 for iOS | — |
| Version | 0.1.0 (1), `com.hellobonded.app` | 0.1.0 (versionCode 1), `com.hellobonded.app` |
| Build env | `EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:57521`, local demo anon key, `EXPO_PUBLIC_SHIP_LITTLE_THINGS=1`, `EXPO_PUBLIC_SHIP_PREMIUM_HISTORY=1`, `EXPO_PUBLIC_SHIP_VOICE=1`; no RevenueCat / PostHog key | same with `http://10.0.2.2:57521` |
| Backend | isolated local stack `rel07f` (copy of `supabase/` in /tmp/rel07f, ports 575xx); scenarios `streak-11-your-turn`, `free-couple-packs`, `missed-day-napping` from `qa:scenario` | same stack |

## 2. Results
Evidence lives in `qa/release/evidence/a8e2a96-rel07f/` (I2, I3) and `qa/release/evidence/913dea1-rel07f/`
(local, gitignored as for every report). Maestro flows in `913dea1-rel07f/flows/`, their outputs in `ax5-02/`,
`ax5-daily/`, `ax5-packs/`, `and/`.

### 2.1 iOS (REL-B)
| # | Check | Result | Evidence / reason |
|---|---|---|---|
| I2a | #327: Bonded icon on the home screen, light | **pass** | `a8e2a96-rel07f/home-light/.../IOS-icon-home-light.png`: two buns in the basket on cream, not the Expo template; bundle icon `IOS-bundle-AppIcon60x60@2x-hellobonded.png` |
| I2b | #327: iOS 18 dark icon | **pass (asset), not shown on the home screen** | `IOS-assetutil-info.json`: `AppIcon` has `App-Icon-1024x1024@1x.png` (light) and `App-Icon-dark-1024x1024@1x.png` with `Appearance: UIAppearanceDark`. The Simulator home screen keeps light icons in dark mode (Apple's Files icon too) and Edit > Customize opens no sheet on iOS 18.0, so the dark/tinted style cannot be switched here. Hand check on a phone (PO) |
| I2c | #327: tinted icon | **not checkable here** | no tinted art by design (`app.config.ts`: iOS derives it); Customize sheet unavailable in the Simulator |
| I3 | #327: splash light and dark | **pass** | dark `IOS-splash-dark-3.png` (buns on the dark `bg`, no white frame); light `IOS-splash-light-video-f14.png` (buns on cream), then 01 |
| I4-02 | AX5 (`accessibility-extra-extra-extra-large`, largest size) on 02 story 1 | **pass** | `ax5-02/2026-11-12_184200/.../IOS-AX5-02-*.png`, `ax5-02/2026-11-12_184359/.../IOS-AX5-more-02-*.png`: bubbles, title "Life gets busy." and body wrap between words, the page scrolls, Continue reachable at the bottom |
| I4-18 | AX5 on 18 Today (your turn, Sam answered) | **FAIL** -> #357, #358 | (a) the 24b little-things tip ("Send Sam a little something. Tap for all five. ...") is taller than the room above the button: its frame is y -127..499 pt, so the first lines sit above the screen and cannot be read (`IOS-AX5-18-tip-overflow.png`, `ax5-daily/18-tip-hierarchy.json`: `24b-tip [79,-127][359,499]`). (b) the gift chip label breaks mid-word, "You / ear / ned / a / gift" (label 107 pt wide, `today-gift-chip-label [79,412][186,769]`; `IOS-AX5-18-gift-midword.png`). Header, streak chip, "Sam already answered" and Answer button fine (`ax5-daily/2026-11-12_190224/.../IOS-AX5RM-18-*.png`) |
| I4-19 | AX5 on 19 Answer (typing and typed) | **pass** | `ax5-daily/2026-11-12_190224/.../IOS-AX5RM-19-top.png`, `-19-s1.png`, `ax5-daily/2026-11-12_190353/.../IOS-AX5RM-19-keyboard.png`, `-19-typed.png`: title capped (MOB-41), question wraps between words, field + counter visible while typing |
| I4-20 | AX5 on 20 Hold to reveal | **FAIL (minor)** -> #358 | title breaks mid-word: "Sam's / answe / r is ..." (`IOS-AX5-20-title-midword.png`). Sealed card, "Locked" pill, name and the tap/hold control fine (`IOS-RM-20-armed.png`) |
| I4-21 | AX5 on 21 Revealed | **FAIL** -> #357 | the pinned "12 · bonded today" streak chip is wider than the screen: it runs off the right edge ("12 · bonde"), and its 2-line height covers the top of the question while scrolling (`IOS-AX5-21-chip-clipped.png`, `ax5-daily/2026-11-12_190524/.../IOS-AX5RM-21-*.png`) |
| I4-22 | AX5 on 22 Thread (free couple, voice gated) | **FAIL** -> #356 | the header title and subtitle are cut to one line each ("Today's th", "What's a sm") and the voice notice "Voice messages are for Premium couples. Anyone can listen." is drawn over the subtitle; notice + composer fill the whole screen, so no message is visible and the page does not scroll (`IOS-AX5-22-overlap.png`; `-22-top`, `-22-s1`, `-22-s2`, `-22-up` are identical) |
| I4-33/34 | AX5 on 33 pack detail and 34 paywall | **blocked (time)** | scenario `free-couple-packs` seeded; the run reached 32 and the 52b badge sheet, but the tap on the Gratitude pack landed on the History tab under host load (`ax5-packs/2026-11-12_191236/.../step-012-assertCondition-33-sample.png`), and the session hit its time limit. Flow `flows/ios-packs2.yaml` is ready for the next run |
| I5a | Reduce Motion: hold becomes tap + confirm on 20 | **pass** | `ios-daily4.yaml` with `REDUCED_MOTION=true`: first tap shows "Tap again to reveal" and keeps 20 (`assertVisible 20-sealed`, `assertNotVisible 21-screen` COMPLETED; `IOS-RM-20-armed.png`), second tap opens 21 (`ax5-daily/run6.txt`) |
| I5b | Reduce Motion: no confetti | **pass** | 21 after the reveal (`IOS-AX5RM-21-a.png`, `-21-b.png`) and the 1-day badge sheet show no confetti; on 52b `assertNotVisible 52b-confetti` COMPLETED (`ax5-packs/run3.txt`, `IOS-RM-AX5-52-badge-sheet.png`, `IOS-AX5RM-52b-bottom.png`). Also at AX5 the 52b sheet scrolls to "Keep it going" |
| I5c | Reduce Motion: still mascot | **pass (screenshots)** | mascot drawn without motion blur or offset in consecutive shots of 18 and 20 (`IOS-AX5RM-18-s2.png`, `IOS-AX5-20-title-midword.png`); a screenshot cannot prove the absence of animation, the REL-07 unit/sim check of MOB-66 covers the switch |
| I6 | VoiceOver two-finger escape closes sheets + fan | **blocked** | needs a real iPhone (PO) |

Also seen on the way (AX5, not in this task's screen list, filed as #358): 01 Welcome hero breaks
"questi / on" (`IOS-AX5-01-midword.png`), 05 "Wher / e are you two ..." (`IOS-AX5-05-midword.png`), 07
"toget / her?" (`ax5-02/2026-11-12_183018/.../step-017-scrollUntilVisible-07-me.png`). All are display titles
without the `TITLE_MAX_FONT_SCALE` cap that 19/21/24 already use (#84, #107).

### 2.2 Android (emulator-5554)
| # | Check | Result | Evidence |
|---|---|---|---|
| A1 | Native `assembleRelease` arm64-v8a of 913dea1, install on emulator-5554 | **pass** | `AND-gradle-assembleRelease.log` (`BUILD SUCCESSFUL in 45m 58s`); prebuilt `bonded_widget_countdown.xml` has `autoSizeMinTextSize="12dp"` (#344); `adb install -r` Success |
| A2 | #340: 38b yourTurn at font scale 2.0, light, 8 glyphs | **pass** | `AND-home-yourTurn-light-font2.0-8digit.png`: "16:42:43" fully left of the mascot (`bonded_timer` [87,523][357,623], mascot from x 368; `-hierarchy.txt`). To get a time left of 10 h or more, the local couple's timezone was set to Pacific/Honolulu (test data only) |
| A3 | #340: 38b yourTurn at 2.0, dark, 8 glyphs | **pass** | `AND-home-yourTurn-dark-font2.0-8digit.png` ("16:42:11") |
| A4 | #340: 38b napping at 2.0, light and dark | **pass** | `AND-home-napping-light-font2.0.png` ("16:41:28", sleeping mascot, "to start a streak"), `AND-home-napping-dark-font2.0.png` ("16:39:01") |
| A5 | 38b at 2.0 with 7 glyphs (Berlin time zone, < 10 h left), light and dark | **pass** | `AND-home-yourTurn-light-font2.0.png` ("5:44:43"), `AND-home-yourTurn-dark-font2.0.png` |
| A6 | 38b at font scale 1.0, unchanged | **pass** | `AND-home-light-font1.0.png` (yourTurn "5:45:14"), `AND-home-yourTurn-dark-font1.0.png`, `AND-home-napping-light-font1.0.png`, `AND-home-napping-dark-font1.0.png`: same layout as REL-07e A5-A7 |
| A7 | 38b at font scale 1.8, unchanged | **pass** | `AND-home-yourTurn-light-font1.8.png` ("5:43:54"), `AND-home-napping-light-font1.8.png` ("16:38:41"): all digits left of the mascot |
| A8 | Widget picker preview of "Your turn" at 2.0 | **pass** | `AND-picker-previews-light-font2.0.png`: "00:00" left of the mascot, button below |
| A9 | Restore: font scale 1.0, light mode, animation scales 1 | **done** | `settings get system font_scale` = 1.0 before the emulator was killed |

## 3. Summary
| Area | iOS | Android |
|---|---|---|
| #327 icon + splash | 3 pass, dark/tinted home icon blocked (Simulator) | (pass in REL-07e) |
| AX5 text (02, 18-22, 33/34) | 02, 19 pass; 18, 20, 21, 22 fail (#356, #357, #358); 33/34 blocked (time) | n/a |
| Reduce Motion | 3 pass (tap + confirm, no confetti, still mascot) | (pass in REL-07e) |
| #340 38b at font 2.0 (+1.0, 1.8, picker) | n/a | 8 pass |

## 4. Failed checks
| Check | Issue | Severity (suggested) |
|---|---|---|
| I4-22 thread header cut and covered by the voice notice, no message visible | #356 | sev-3 |
| I4-18 24b tip runs off the top; I4-21 streak chip runs off the right edge | #357 | sev-3 |
| I4-18 gift chip, I4-20 title, plus 01/05/07: mid-word breaks | #358 | sev-4 |

## 5. Blocked checks
| Check | Reason |
|---|---|
| I2b/I2c dark and tinted home-screen icon | Simulator home screen does not switch icon style on iOS 18.0; hand check on a phone (PO) |
| I6 VoiceOver escape | real iPhone (PO) |
| I4-33/34 AX5 on 33 and 34 | session time limit; the pack tap landed on History under host load. Next run: `flows/ios-packs2.yaml` after `qa:scenario free-couple-packs` |

## 6. Residual risks
- Host load 500-870 (other workloads) during the Android build and the first iOS flows: the emulator showed
  "Pixel Launcher / System UI isn't responding" after the cold boot; the launcher was restarted. No app ANR.
- iOS binary built from a8e2a96, not rebuilt at 913dea1; the diff between them has no iOS or JS-bundle input
  (section 1).
- Maestro's QA sign-in subflow cannot run at AX5 on the SE (01-code is below the fold); sign-in was done at the
  default size, then AX5 set and the app relaunched.

## 7. Decision
Not a store GO/NO-GO (local builds, no EAS build). For the checks in scope: #340 is fixed on Android (verify and close). iOS AX5 has two open sev-3 accessibility bugs (#356, #357) and one sev-4 (#358): no sev-1/2 and no P0 functional failure, but UI-level AX5 checks on 18, 20, 21, 22 fail until they are fixed.

Release validator, 2026-11-12 19:30 EET.
