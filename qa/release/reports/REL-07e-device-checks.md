# Release validation: REL-07e device checks for #302 (#295) and MOB-25 (main 1345e98)

Device re-check of PR #302 (fix for #295: Android 38b "Your turn" Countdown, timer in a header row left of the
mascot, autosize 28sp -> 14sp) and the MOB-25 release device checks. **Not a store GO/NO-GO**: local Release
build against a local stack. Run 2026-11-12 12:31-13:20 EET.

**Outcome: both checks BLOCKED (environment), no product failure found, no bug filed.** The host was overloaded
by other workloads during the whole session (load average 110-180; a container outside this task used ~700 % CPU),
so the Android Release build took 34 min (REL-07d: 5 min) and the emulator crashed twice on its hang watchdog.

## 1. Build identity
| Field | Android | iOS |
|---|---|---|
| Version / build | 0.1.0 (versionCode 1), `com.hellobonded.app` | not built (stopped, see 3) |
| Commit | `main` 1345e98 (contains #302, merged 2026-11-12 09:08 UTC) | same |
| EAS profile / channel | none: `CI=1 expo prebuild -p android --no-install`, `./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a`; local-only `android:usesCleartextTraffic="true"` (as REL-07b/c/d) | `expo prebuild -p ios`, `pod install` done; `xcodebuild` Release `ARCHS=arm64` stopped at 12:49 |
| Build env | `EXPO_PUBLIC_SUPABASE_URL=http://10.0.2.2:57521`, local demo anon key, `EXPO_PUBLIC_SHIP_LITTLE_THINGS=1`, `EXPO_PUBLIC_SHIP_PREMIUM_HISTORY=1`, `EXPO_PUBLIC_SHIP_VOICE=1`; no RevenueCat / PostHog key | same with `http://127.0.0.1:57521` |
| Backend | isolated local stack `rel07e` (copy of `supabase/` in /tmp/rel07e, ports 575xx); scenario `paired-day1-partner-answered` applied 10:34:42Z | same |
| Devices | emulator-5554, AVD `Medium_Phone_API_37.0`, Android 17 (API 37) | REL-B (iPhone SE 3rd, iOS 18.0): not booted |

## 2. Results
Evidence lives in `qa/release/evidence/1345e98-rel07e/` (local, gitignored as for every report).

| Check | Platform | Result | Evidence / reason |
|---|---|---|---|
| `assembleRelease` arm64-v8a from main | Android | **pass** | `AND-gradle-assembleRelease.log`: `BUILD SUCCESSFUL in 33m 56s` |
| APK installs on emulator-5554 | Android | **pass** | `adb install -r` -> `Success`; 01 renders (`AND-after-sign-in-attempt.png`) |
| #302 / #295: 38b Countdown digits left of the mascot (yourTurn + napping, light/dark, largest font, picker preview) | Android | **blocked** | Emulator unstable under host load: crashed twice at boot ("detected a hanging thread 'QEMU2 CPU2 thread'"), third boot came up at 13:08 but System UI showed "System UI isn't responding" (`AND-after-sign-in-attempt.png`) and the Maestro sign-in of maya@bonded.test did not finish before the 13:15 cut-off (`AND-sign-in-maestro.txt`, `AND-sign-in-maestro-2.txt`). At 13:13 the flow was still on 08 typing the email (`AND-1314-state.png`: 08 renders correctly in dark). No widget was added, so no screenshot of 38b. |
| MOB-25: TalkBack / hardware back closes every sheet and the 24b/24c fan | Android | **blocked** | same as above |
| MOB-25: 3-button nav, sheets clear the nav bar (edge-to-edge) | Android | **blocked** | same as above |
| MOB-25: reduced motion (still mascot, no confetti, hold becomes tap on 20) | iOS + Android | **blocked** | no stable device in the session |
| MOB-25: 200 % text on SE (REL-B) for 02, 18-21, 22, 33/34 | iOS | **blocked** | iOS Release build stopped at 12:49 to give the Android build and emulator the CPU (both builds at once pushed load to 180 and crashed the emulator) |
| MOB-25: VoiceOver two-finger escape closes sheets + fan | iOS | **blocked** | needs an iOS build; also VoiceOver gestures are not available in the Simulator, so this one needs a real iPhone (PO) |

## 3. Notes
- Not a regression signal: the app launched and rendered 01 correctly on the Release APK; the blocks are host
  capacity only.
- One orphaned `swift-frontend` from the stopped iOS build was still running at the end of the session (the
  permission system did not allow this session to kill it); it ends on its own.
- Next run: build only one platform at a time and only when no other agent is building; check `uptime` first
  (load < 30). The APK built here (`android/app/build/outputs/apk/release/app-release.apk`) was deleted with
  `android/` at cleanup, so the next run rebuilds (about 5 min on an idle machine).

## 4. Verdict
#302 / #295: **not verified** (blocked). MOB-25 release device checks: **not verified** (blocked). Issue #295
stays closed by #302 on the unit test (`plugin.test.ts` "#295"); the device recheck is still owed.
