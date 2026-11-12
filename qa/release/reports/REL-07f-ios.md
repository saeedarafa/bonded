# Release validation: REL-07f, iOS half of REL-07e on REL-B (main a8e2a96)

The iOS checks that REL-07e (`REL-07e-rerun.md`, section 2.2, I2-I5) did not run: #327 app icon and splash, the
largest Dynamic Type size on 02, 18-21, 22, 33, 34 and Reduce Motion (MOB-25). **Not a store GO/NO-GO**: local
Release build against a local stack. Run 2026-11-12 from 15:53 EET on REL-B only (no other device touched).

## 1. Build identity
| Field | iOS |
|---|---|
| Device | REL-B, iPhone SE 3rd gen, iOS 18.0 Simulator (D057FF7E) |
| Icon + splash build (I2, I3) | the REL-07e install: `main` fec1933, Release, `com.hellobonded.app` 0.1.0 (1). `app.config.ts`, `plugins/` and `assets/` are identical on fec1933 and a8e2a96 (`git diff --stat` empty), so the icon and launch screen are the same on current main |
| Text + motion build (I4, I5) | IN PROGRESS: `main` a8e2a96, `npm ci`, `expo prebuild -p ios`, `pod install`, `xcodebuild -configuration Release -sdk iphonesimulator ARCHS=arm64 ONLY_ACTIVE_ARCH=YES` (ad-hoc) |
| Build env | `EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:57521`, local demo anon key, `EXPO_PUBLIC_SHIP_LITTLE_THINGS=1`, `EXPO_PUBLIC_SHIP_PREMIUM_HISTORY=1`, `EXPO_PUBLIC_SHIP_VOICE=1`; no RevenueCat / PostHog key |
| Backend | isolated local stack `rel07f` (copy of `supabase/` in /tmp/rel07f, ports 575xx); scenarios from `qa:scenario` |

## 2. Results (iOS, REL-B)
Evidence lives in `qa/release/evidence/a8e2a96-rel07f/` (local, gitignored as for every report); Maestro flows in `flows/`.

| # | Check | Result | Evidence / reason |
|---|---|---|---|
| I2a | #327: Bonded icon on the home screen, light | **pass** | `home-light/.../IOS-icon-home-light.png`: "Bonded" with the two buns in the basket on cream, not the Expo template; bundle icon `IOS-bundle-AppIcon60x60@2x-hellobonded.png` |
| I2b | #327: iOS 18 dark icon | **pass (asset), not shown on the home screen** | `IOS-assetutil-info.json`: `AppIcon` has `App-Icon-1024x1024@1x.png` (light) and `App-Icon-dark-1024x1024@1x.png` with `Appearance: UIAppearanceDark`. On the Simulator the home screen keeps light icons in dark mode (Apple's Files icon too, `home-dark/.../IOS-icon-home-dark.png`) and Edit > Customize opens no sheet on iOS 18.0 (`cust-dark/`), so the dark/tinted style cannot be switched here. Hand check on a phone (PO) |
| I2c | #327: tinted icon | **not checkable here** | no tinted art by design (`app.config.ts`: iOS derives it from the light icon); Customize sheet unavailable in the Simulator (I2b) |
| I3 | #327: splash light and dark | **pass** | dark: `IOS-splash-dark-3.png` (buns on the dark `bg`, no white frame); light: `IOS-splash-light.mov`, frame `IOS-splash-light-video-f14.png` (buns on cream), then 01 |
| I4 | MOB-25: largest text size (accessibility XXXL, AX5) on 02, 18-21, 22, 33, 34: text not cut, no overlap | IN PROGRESS | |
| I5 | MOB-25: Reduce Motion on: still mascot, no confetti, hold becomes tap + confirm on 20 | IN PROGRESS | |
| I6 | MOB-25: VoiceOver two-finger escape closes sheets + fan | **blocked** | needs a real iPhone (PO) |

Notes:
- REL-B also carries a stale app `app.bonded.mobile` (installed 2026-11-04, the old bundle id, Expo template icon),
  which also shows as "Bonded" on page 2. Not this build; left in place (not installed by this session).
