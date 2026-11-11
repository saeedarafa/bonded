# Release validation: REL-07 M5 device checks, iOS simulator (main 8e6b5d8)

Dry-run findings report on the merged M5 work that had no device evidence yet: MOB-71, MOB-73, MOB-70,
MOB-67, MOB-65, MOB-31, MOB-66, MOB-24b. **Not a store GO/NO-GO**: a local Release simulator build against a
local stack, iOS only. Run 2026-11-12 00:55-01:50 EET (couple timezone Europe/Berlin).

## 1. Build identity
| Field | iOS | Android |
|---|---|---|
| Version / build | 0.1.0 (1), `com.trybonded.app` (HYG-06 for the built binary only) | not run |
| Commit | `main` 8e6b5d8 (Merge #269) | — |
| EAS profile / channel | none: local `xcodebuild -configuration Release -sdk iphonesimulator`, ad-hoc signed (qa/e2e/README.md recipe) | — |
| Build env | `EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:57521`, local demo anon key, `EXPO_PUBLIC_SHIP_LITTLE_THINGS=1`, `EXPO_PUBLIC_SHIP_PREMIUM_HISTORY=1`; no RevenueCat key, no PostHog key, no EAS project id, `EXPO_PUBLIC_INVITE_DOMAIN` unset | — |
| Backend (Supabase project) | isolated local stack `rel07` (copy of `supabase/` in /tmp, ports 575xx, edge-runtime/studio off), all migrations to `20261111330000`; seeded only with `qa:scenario` / QA runners | — |
| RevenueCat environment | none (no key on this Mac): 16 shows "Not available right now" | — |
| Devices + OS versions | REL-A iPhone 16 Pro Max, iOS 18.0 (only device booted; shut down after) | — |

Bundle check: `strings main.jsbundle | grep -c 127.0.0.1:57521` = 1; `__entitlements` present; five
`little_thing_*.wav` in the app bundle; `PrivacyInfo.xcprivacy` present.

## 2. Scope
Milestone M5. Checks: FUN-21, FUN-22, FUN-23, FUN-24, BIZ-19, BIZ-20, UI-08, A11Y-03, plus the BACKLOG
acceptance of MOB-65 (sounds), MOB-66 (gesture moments, frame rate), MOB-67 (41 switch on the server) and
MOB-24b (40 "Share usage data"). Everything else in RC_CHECKLIST is out of scope for this run.

## 3. Summary (iOS simulator; Android not run)
| Task / check | Result | Evidence (under `qa/release/evidence/8e6b5d8-sim/`) |
|---|---|---|
| **MOB-71 / FUN-21** History locked days, free | **pass** (sim part) | QA-39 runner `history all`: `history-locked-free.xml`, `history-premium-open.xml`, `history-ended-locked.xml`, `history-locked-rerun.log`; `qa39-29-locked-row.png`, `qa39-30-locked.png`, `qa39-22-locked.png`, `qa39-16-from-history.png`, `qa39-30-premium-open.png` |
| FUN-21 Premium opens / lapse relocks, nothing deleted | **pass** | runner: answers 52 / messages 18 / reactions 11 before and after the lapse |
| FUN-21 proxy capture, PDF page, renew via a sandbox purchase | blocked | no proxy on this run; PDF share needs a device; renewal needs RevenueCat (see 5) |
| **MOB-73 / FUN-22** answer only on the day (free) | **pass** | QA-38 runner `daily day-ended`: `daily-day-ended-past.xml`, `-late-type.xml`, `-late-send.xml`; `qa38-29-only-sam.png`, `qa38-30-partner-locked.png`, `qa38-19-day-ended.png`, `qa38-19-day-ended-online.png`; DB: Maya has no answer for the ended day |
| FUN-22 / **BIZ-20** same with Maya on Premium | **pass** (one copy defect, #270) | `premium-day-ended-past.xml`, `premium-qa38-19-day-ended.png`, `premium-qa38-29-only-sam.png`, `premium-qa38-30-partner-locked.png`: "This day has ended", no paywall, no Premium upsell |
| 19 day-ended title | **fail** sev-4 | #270: 19 for a past **daily** question is titled "Pack question" |
| **MOB-70 / FUN-23** ended note with real date | **pass** | `FUN23-ended-note-light.png`, `FUN23-ended-note-dark.png`, `FUN23-ended-hierarchy.json`: "You can read these until Dec 10. After that they're deleted."; DB `ended_at` 2026-11-09T23:21Z + 30 d = 2026-12-09T23:21Z = Dec 10 01:21 device time (EET). VoiceOver label = the full sentence (`ended-note` accessibilityText). 58 keeps the 30-day line (`FUN23-58-light.png`). 42 not re-checked |
| **MOB-67 / FUN-24** 41 "Little things sounds" on the server | **pass** (server + app half) | `MOB67-41-on.png` + `MOB67-41-on-hierarchy.json` (both switches on by default), tap -> `MOB67-pref-after-off.txt` (`little_things_sound=false`, `little_things=true`), uninstall + reinstall + sign in -> switch still off (`MOB67-41-after-reinstall.png/.txt`), back on -> `MOB67-pref-after-on.txt` |
| FUN-24 push arrives silent / with sound; "Little things" off stops pushes; "on another phone" | blocked | push delivery needs a device + EAS build (no push on the simulator, edge-runtime off) |
| **MOB-65** in-app gesture sounds honour the switch | **pass** (playback detected, not heard) | simulator CoreAudio log of the app while Sam's gesture arrives: switch on -> 143 AudioQueue lines (`MOB65-sound-on-kiss-audio-log.txt`); switch off -> 0 (`MOB65-sound-off-kiss-audio-log.txt`, `MOB65-sound-off-hug-audio-log.txt`); the 24d bubble shows each time (`MOB65-*-24d.png`). Files: 5 WAVs, 0.31-1.45 s, 6.9-32 KB (`MOB65-bundled-sounds.txt`) |
| MOB-65 real audio (heard, silent switch, volume, notification sounds) | blocked | simulator audio routes to the Mac; silent switch, ringer and push sounds need a device |
| MOB-65 binary declares background audio | **fail** sev-3 (store risk) | #272: `UIBackgroundModes = [audio]` from the `expo-audio` plugin default (`MOB65-infoplist-background-modes.txt`) |
| **MOB-66** five gesture moments play | **pass** | `MOB66-moments-grid.png` (kiss, goodnight, good morning, miss you at 3/4/5/6 s), `MOB66-hug-stack.png`; videos `MOB66-<kind>.mp4` |
| MOB-66 frame rate | **pass** (proxy) | release build, so no perf monitor; and `/dev/gestures` is `__DEV__`-only (redirects to `/` in Release). Proxy: unique frames per second in the simulator screen recording (`mpdecimate`): 57-60 fps through every moment (hug min 54/s in one half-second; kiss/goodnight/good morning/miss you 57-60 every second). Not a device measurement |
| MOB-66 reduce motion -> still pose | **pass** | `MOB66-RM-hug.mp4`, `MOB66-RM-kiss.mp4`: 1 changed frame/s (the countdown) while the bubble arrives; `MOB66-RM-hug-5s.png` still waiting pose |
| **MOB-31 / UI-08** mascot animates on both moods tried | **pass** | cold starts `MOB31-cold-together-light.mp4`, `-dark.mp4`, `MOB31-cold-napping-light.mp4`: 60 changed frames/s once Today shows; contact sheets `*-sheet.png`: the mascot is there on the first Today frame, no blank mascot, right mood |
| UI-08 no flashing frame on cold start in dark mode | **fail** sev-4 | #271: white launch screen (~0.5 s, luma 234) before the dark Today (`SPLASH-dark-white-frame.png`, `MOB31-cold-together-dark-sheet.png`) |
| **A11Y-03** reduce motion: still pose of the current mood, tap instead of hold | **pass** | `MOB31-RM-cold-together.mp4` (1 frame/s after load), `MOB31-RM-napping-still.png` + `MOB31-RM-cold-napping.mp4` (recording ends at 3.4 s: nothing moves); QA runner `daily reduced` PASS (`daily-reveal-reduced-motion.xml`, `daily-reduced.log`) |
| **MOB-24b** 40 "Share usage data", on by default | **pass** | `MOB24b-40-default.png/.txt` (value 1; copy matches ANALYTICS.md §1.6) |
| MOB-24b off survives restart | **pass** | `MOB24b-40-off.png/.txt` -> kill + relaunch `MOB24b-40-off-after-restart.png/.txt` -> simulator reboot `MOB24b-40-off-after-reboot.png/.txt` (value 0 each time); back on survives a restart (`MOB24b-40-on-again-after-restart.txt`) |
| MOB-24b off -> no further PostHog requests | blocked | the build has no PostHog key (analytics is a no-op), so there is no traffic to observe; needs a build with a test key + proxy (QA-08) |
| **BIZ-19** 16 `from=history` title, 17/34 row flag on/off, purchase from history | blocked | no RevenueCat key: 16 shows "Not available right now" (`qa39-16-from-history.png`), so neither the title nor 17 can be reached; the lock itself follows the server (FUN-21 pass) |

Counts (iOS, this scope): pass 14, fail 3 (#270 sev-4, #271 sev-4, #272 sev-3), blocked 5.

## 4. Failed checks
| Check | Platform | Issue | Severity |
|---|---|---|---|
| FUN-22 / 19 day-ended: past daily question titled "Pack question" | iOS | #270 | sev-4 |
| UI-08: white launch screen before dark Today on cold start | iOS | #271 | sev-4 |
| MOB-65 / store: `UIBackgroundModes audio` declared but unused (App Review 2.5.4; Android foreground-service permissions from the same plugin) | iOS (Android by config) | #272 | sev-3 |

## 5. Blocked checks
| Check | Platform | Reason | Needed to unblock |
|---|---|---|---|
| FUN-24 push half (silent little-thing push, quiet channel, "Little things" off stops pushes) | both | no push on the simulator; edge-runtime off on this stack | device + EAS build with the EAS project id, prod-like `notify` |
| MOB-65 sounds heard, silent switch, notification sounds per gesture | both | simulator audio, no ringer switch, no push | device |
| Haptics per gesture (MOB-59/66) | both | no haptic engine on the simulator | device |
| MOB-66 frame rate on a device / perf monitor | both | Release build has no perf monitor; `/dev/gestures` is dev-only | dev client on a device, or Instruments on a device |
| BIZ-19 title + 17/34 row + purchase from history; FUN-21 renewal via purchase | both | no RevenueCat key on this Mac | RevenueCat sandbox key + sandbox tester |
| MOB-24b / QA-08 no PostHog requests after opt-out | both | no PostHog key in the build | build with a test PostHog key + proxy capture |
| FUN-21 proxy capture, PDF export page | both | not run in this dry run | proxy session; device share sheet for the PDF |
| Android: every row above | Android | not in this task | emulator run (`Medium_Phone_API_37.0`) |

## 6. Evidence index
All under `qa/release/evidence/8e6b5d8-sim/` (git-ignored), named per row above. QA runners used (JUnit
copied): `npm --prefix qa/e2e run history -- all`, `history -- locked` (re-run), `daily -- day-ended`,
`daily -- reduced`, all with `SUPABASE_PROJECT_ID=rel07`; `.maestro/daily/day-ended-past.yaml` re-run by hand
with Maya on Premium.

Note on the first `history locked` run: it failed at 00:00:12 Europe/Berlin because the couple's day rolled
over mid-flow (the runner had picked day -1 at 23:58, and by the assertion that day was day -2 and correctly
locked). Re-run at 01:08: PASS. Debug copy in `first-run-fail/`. Not a product bug; suggest QA avoids
starting history/day-ended suites in the 5 minutes before couple-local midnight.

## 7. Residual risks
- Everything audio, push and haptic for little things is unverified on hardware (FUN-24, MOB-65, MOB-59).
- Frame rate is a simulator screen-recording proxy, not a device measurement; low-end Android untested.
- Observation, not filed: a cold start within 30 s of the last fetch shows the persisted cache without a
  refetch (`staleTime` 30 s in `src/lib/queryClient.ts`). Seeding the server between two quick cold starts
  left the old Today on screen for 20+ s. With a normal gap (40 s) the new state loads (`STALE-1-before.png`,
  `STALE-2-after-60s.png`). Realistic exposure is small (partner acts and you reopen within 30 s).
- 42 (unpair confirm) 30-day line not re-checked in this run.

## 8. Decision
**Not a GO/NO-GO** (dry run on a simulator build, iOS only, no RevenueCat/PostHog/push). For the next RC:
#272 (sev-3, store policy) should be fixed before a store submission; #270 and #271 are sev-4.

Validated by: Release Validator · Date: 2026-11-12 01:50 EET
