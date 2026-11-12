# Release validation: REL-08 iOS smoke of the hellobonded rename (main 2deddd0)

Smoke of D30 (PO 2026-11-12: domain `hellobonded.com`, app id `com.hellobonded.app`) on a fresh iOS build.
**Not a store GO/NO-GO**: local Release simulator build against a local stack. Run 2026-11-12 11:35-12:05 EET.

## 1. Build identity
| Field | iOS |
|---|---|
| Version / build | 0.1.0 (1), `com.hellobonded.app`; widget extension `BondedWidgetExtension.appex` = `com.hellobonded.app.widgets` |
| Commit | `main` 2deddd0 (detached worktree) |
| EAS profile / channel | none: `expo prebuild -p ios --no-install`, `pod install`, `xcodebuild -configuration Release -sdk iphonesimulator ARCHS=arm64 ONLY_ACTIVE_ARCH=YES` (22 min clean) |
| Build env | `EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:57521`, local demo anon key, `EXPO_PUBLIC_INVITE_DOMAIN=hellobonded.com`, `EXPO_PUBLIC_SHIP_LITTLE_THINGS=1`, `EXPO_PUBLIC_SHIP_PREMIUM_HISTORY=1`, `EXPO_PUBLIC_SHIP_VOICE=1`; no RevenueCat / PostHog key |
| Backend | isolated local stack `rel08` (copy of `supabase/`, ports 575xx); scenario `paired-day1-partner-answered` |
| Device | REL-A iPhone 16 Pro Max, iOS 18.0 (only device used; shut down after). Old `com.trybonded.app` was uninstalled earlier, so this is a clean install |

## 2. Results (evidence under `qa/release/evidence/2deddd0-rel08/`)
| Check | Result | Evidence |
|---|---|---|
| Release build of app + widget extension | **pass** | `IOS-xcodebuild-result.txt`: `** BUILD SUCCEEDED **` |
| App `CFBundleIdentifier` = `com.hellobonded.app`; appex = `com.hellobonded.app.widgets`; URL schemes `bonded`, `com.hellobonded.app` | **pass** | `IOS-static-checks.txt` |
| Entitlements: `applinks:hellobonded.com`, App Group `group.com.hellobonded.app` (app and widget) | **pass** | `IOS-Bonded.entitlements`, `IOS-WidgetExtension.entitlements` (prebuild output); installed app reports group container `group.com.hellobonded.app` in `IOS-listapps.txt` |
| HYG-07 (app half): `trybonded` in app binary, appex binary, `main.jsbundle`, Info.plist, whole `.app` (`grep -rli`) = 0 | **pass** | `IOS-static-checks.txt`, `IOS-entitlements-embedded.txt` |
| Invite domain baked in the JS bundle is `hellobonded.com` | **pass** | `IOS-entitlements-embedded.txt` (Hermes string table contains `hellobonded.com`) |
| Install + cold launch on REL-A | **pass** | `A-launch.png` |
| Email-link sign-in (maya): 08 request via Maestro `auth/link-request.yaml`, link from Mailpit, `simctl openurl`, "Open in Bonded" -> Today (Maya & Sam, Day 1, "You answered. Now it's Sam's turn.") | **pass** | `A-maestro-link-request.txt`, `A-signin-link.txt` (token redacted), `A-after-signin.png` |
| `bonded://j/BND4827` opens the app's join route (signed-in paired user -> "That couple is already bonded", expected for Maya) | **pass** | `A-link-bonded-scheme.png` |
| `https://hellobonded.com/j/BND4827?t=x` opens the app (universal link) | **blocked**: the site and its `apple-app-site-association` are not hosted yet (LEAD-04); Safari opens and shows "Safari can't open the page". Re-run IOS-03 when hellobonded.com serves the AASA | `A-link-hellobonded-https.png` |

Not run in this session (time): widget add on the home screen with the new App Group (REL-07c covered the widget on the old id; the snapshot path now is `group.com.hellobonded.app`), Android smoke.

## 3. Failed checks
None. No bug filed.

## 4. Residual risks
- Universal links and the site half of HYG-07 / IOS-03 / AND-03 / PRIV-03 stay open until LEAD-04 hosts hellobonded.com.
- Widget timeline with the new App Group not seen on screen in this run (entitlement and container are correct).

## 5. Verdict
Smoke **pass** for the app-side rename on iOS. Not a release GO/NO-GO.
