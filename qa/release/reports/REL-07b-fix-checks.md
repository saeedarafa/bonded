# Release validation: REL-07b device checks of the REL-07 and #264 fixes (main e3589e9)

Re-check on devices of the fixes merged in #276 (fixes #270 past-day title on 19, #271 dark launch screen,
#272 no background audio) and #268 (fixes #264, Android 15+ keyboard covering fields). **Not a store
GO/NO-GO**: local Release builds against a local stack. Run 2026-11-12 03:15-04:40 EET (couple timezone
Europe/Berlin).

## 1. Build identity
| Field | iOS | Android |
|---|---|---|
| Version / build | 0.1.0 (1), `com.trybonded.app` | 0.1.0 (versionCode 1), `com.trybonded.app`, targetSdk 36, compileSdk 37 |
| Commit | `main` e3589e9 (Merge #278; includes #276 and #268) | same |
| EAS profile / channel | none: local `xcodebuild -configuration Release -sdk iphonesimulator`, ad-hoc signed (qa/e2e/README.md recipe) | none: local `./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a`; `android:usesCleartextTraffic="true"` added to the generated manifest after prebuild (local build output only, as in QA-38d) |
| Build env | `EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:57521`, local demo anon key, `EXPO_PUBLIC_SHIP_LITTLE_THINGS=1`, `EXPO_PUBLIC_SHIP_PREMIUM_HISTORY=1`, `EXPO_PUBLIC_SHIP_VOICE=1`; no RevenueCat / PostHog key | same with `http://10.0.2.2:57521` |
| Backend (Supabase project) | isolated local stack `rel07b` (copy of `supabase/` in /tmp, ports 575xx, edge-runtime/studio off), all migrations to `20261111330000`; seeded with `qa:scenario` / the QA runner | same stack |
| RevenueCat environment | none | none |
| Devices + OS versions | REL-A iPhone 16 Pro Max, iOS 18.0 (only device booted; shut down after) | emulator-5554, AVD `Medium_Phone_API_37.0`, Android 17 (API 37), 1080x2400; started for this run with `-cores 4 -memory 4096` (runtime flags only; the AVD's 1-core config did not finish a cold boot in 50 min), shut down after |

`app.bonded.mobile` was not installed on either device; any old `com.trybonded.app` was uninstalled first.

## 2. Scope
#270 (19 title), #271 (UI-08 dark cold start), #272 (MOB-65 / store: no background audio, sounds still play
in the foreground), #264 (Android keyboard on 08, 19, 22, 27). Nothing else.

## 3. Results
| Check | Platform | Result | Evidence (under `qa/release/evidence/e3589e9-rel07b/`) |
|---|---|---|---|
| #270: 19 for a past **daily** day is titled "Daily question" | iOS | **pass** | QA-38 runner `daily day-ended` on REL-A, both cases PASS (`daily-day-ended-past.xml`, `daily-day-ended-late-*.xml`, `IOS-day-ended-run.log`); `qa38-19-day-ended.png`: top bar "Daily question" above "This day has ended" (was "Pack question") |
| #271 / UI-08: cold start in dark mode, no white frame | iOS | **pass** | `IOS-cold-dark.mp4` (simctl recordVideo, 30 fps): mean luma of every frame 34-70, never above the dark home screen (REL-07 white frame was 234) (`IOS-cold-dark-luma-per-frame.txt`); the launch screen is the dark `#1B140F` with the glyph (`IOS-cold-dark-splash-f070.png`), then dark Today (`IOS-cold-dark-today-f240.png`) |
| #272: built Info.plist has no `UIBackgroundModes` | iOS | **pass** | `IOS-infoplist-background-modes.txt`: `Print: Entry, ":UIBackgroundModes", Does Not Exist` on the built `Bonded.app/Info.plist` |
| #272: little-things sound still plays in the foreground | iOS | **pass** (playback detected, not heard) | Sam's kiss inserted while Maya is on Today: 24d bubble (`IOS-kiss-24d.png`), Bonded's CoreAudio log has an AudioQueue output `1 ch, 11025 Hz, Int16` (the bundled WAV format), 39 AudioQueue lines (`IOS-kiss-foreground-audio-log.txt`) |
| #272: voice playback still plays in the foreground | iOS | **pass** (playback detected, not heard) | Sam's voice answer (1.4 s test tone uploaded as m4a, Maya on Premium), Maya holds to reveal, taps `21-partner-voice-play`: signed URL request to `storage/v1/object/sign/voice/…`, AVPlayer `timeControlStatus=2` (playing) for 1.7 s, AudioQueue output `1 ch, 11025 Hz, aac` (`IOS-voice-foreground-playback-log.txt`, path redacted; `IOS-voice-21-revealed.png`, `IOS-voice-21-playing.png`). Note: the first tap on play after the reveal produced no request; the second did. Not filed (single occurrence, Maestro tap; watch for it) |
| #271 / UI-08: cold start in dark mode, no white frame | Android | **pass** | `AND-cold-dark.mp4` (`screenrecord`, every frame): mean luma 78-80 on the home screen, 33-34 on the splash (`AND-cold-dark-splash.png`, dark `#1B140F` with the glyph), 58 on dark Today (`AND-cold-dark-today.png`); no light frame (`AND-cold-dark-luma-per-frame.txt`). `am start -W`: COLD, 6.2 s on this emulator |
| #272: merged manifest has no `FOREGROUND_SERVICE*` / playback service | Android | **pass** | `AND-merged-manifest-audio.txt`: `aapt2 dump permissions` of the APK has no `FOREGROUND_SERVICE` or `FOREGROUND_SERVICE_MEDIA_PLAYBACK`; merged manifest: 0 matches for `FOREGROUND_SERVICE`, 0 for `AudioControlsService` / `mediaPlayback`; the six services are notifications, Firebase, Google sign-in and datatransport only. Full file: `AND-merged-AndroidManifest.xml` |
| #264: 08 email field and "Send code" above the keyboard | Android | **pass** (extra; the screen #264 was filed on) | keyboard up (`mInputShown=true`): `08-scroll` [0,210][1080,1517] (was full height to 2337), `08-email-field` [63,1119][1017,1256], `08-send-code` [63,1287][1017,1433] (`AND-08-keyboard-up-bounds.txt`, `AND-08-keyboard-up.png`); Maestro `assertVisible` on both passed with the keyboard up. Code step also stays above it (`AND-08-code-keyboard-up.png`) |
| #264: 19 answer field and "Lock in my answer" above the keyboard | Android | **pass** | `19-screen-scroll` ends at 1328, `19-field` [63,707][1017,948], footer `19-submit` [63,1328][1017,1475], keyboard top about 1517 (`AND-19-keyboard-up-bounds.txt`, `AND-19-keyboard-up.png`) |
| #264: 22 thread composer above the keyboard | Android | **pass** | `22-composer` [86,1293][700,1461], send [720,1346][836,1462], keyboard top about 1517 (`AND-22-keyboard-up-bounds.txt`, `AND-22-keyboard-up.png`) |
| #264: 27 feedback field above the keyboard | Android | **pass** | `27-body` [63,1275][1017,1517] stays visible while typing; "Send to the team" is under the keyboard until the user scrolls, then it shows above it (`AND-27-keyboard-up.png`, `AND-27-keyboard-up-scrolled.png`, `AND-27-keyboard-up-bounds.txt`). Normal scroll-form behaviour, not filed |

Counts: iOS pass 5, Android pass 7 (incl. 08), fail 0, blocked 0.

## 4. Failed checks
None of the checks in scope. New finding outside the scope, seen while checking 22:

| Finding | Platform | Issue | Severity |
|---|---|---|---|
| 22 for a past day (History -> yesterday's thread) is titled "Today's thread" | Android (same code on iOS) | #280 | sev-4 |

## 5. Blocked checks
| Check | Platform | Reason | Needed to unblock |
|---|---|---|---|
| Sounds and voice actually **heard**, on a device with the silent switch | iOS / Android | simulator and emulator only; playback is proven by the audio system logs, not by ear | an EAS build on a phone |
| Sounds / voice in the foreground on Android | Android | not in this task's scope; the manifest check covers the background part | next Android run |

## 6. Evidence index
`qa/release/evidence/e3589e9-rel07b/` (git-ignored, local only): `IOS-*` and `qa38-*` (iOS), `AND-*` (Android),
JUnit `daily-day-ended-*.xml`. No answer or message text in any log; typed text starts with `FIXTURE-E2E`.

## 7. Residual risks
- Emulator Android 17 only; Android 15/16 phones and other keyboards (Samsung, SwiftKey) not checked.
- The AVD `Medium_Phone_API_37.0` has `hw.cpu.ncore=1` and 2 GB RAM and its quick-boot snapshot is gone: a cold
  boot did not complete in 50 minutes (system_server restarted once). Booting it with `-cores 4 -memory 4096`
  works in seconds. Worth fixing in Device Manager (QA / founder), not by creating a new AVD.
- Maestro on this emulator was too slow for `eraseText` (the sign-in subflow stalled); sign-in was finished with
  `adb input`. QA may want a faster path for Android runs.

## 8. Decision
All four fixes verified: #270, #271, #272 and #264 **pass** on the devices in scope. Not a release GO/NO-GO
(dry run, local builds). One new sev-4 (#280).

Validated by: Release Validator · Date: 2026-11-12 04:45 EET
