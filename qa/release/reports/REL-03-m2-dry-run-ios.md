# Release validation: 0.1.0 (M2 dry run, iOS simulator, f9765da)

> **Dry run.** Not a release candidate and not a store GO. The verdict in §8 is a findings list.
> Status: IN PROGRESS. Rows marked `not yet checked` have not been run.

## 1. Build identity
| Field | iOS | Android |
|---|---|---|
| Version / build | 0.1.0 (app.config.ts); no build number (local build, not EAS) | not built |
| Commit | `main` @ f9765dae37a3b2a1e78686b07129c751cf5f190c ("Merge pull request #30 ... MOB-09-pairing-fixes") | — |
| Build | Local `xcodebuild -configuration Release -sdk iphonesimulator`, ad-hoc signed (`CODE_SIGN_IDENTITY=-`), exactly the recipe in `qa/e2e/README.md` "iOS simulator build". Built in `~/dev/bonded-release`. Only difference: `supabase status` was run in `~/dev/bonded-qa` (the shared stack) to read the anon key | — |
| EAS profile / channel | none (no EAS build; no EAS Update channel) | — |
| Backend (Supabase project) | Shared **local** stack (project id `bonded`, Supabase CLI 3.0.0) run from `~/dev/bonded-qa`; `EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`, local demo anon key. All 2026110x migrations on `main` applied, **plus one not on main: `20261103010000_history_realtime`** (from a backend branch). Seeded with `qa/scripts/seed-scenario.ts` scenarios | — |
| RevenueCat environment | none (no keys in the build) | — |
| Devices + OS versions | iPhone 16 Pro Max (A, 7CF5DC3B-1232-46D5-A0C9-F5787ABA2AEE) and iPhone SE 3rd gen (B, 9B4414FE-C7C8-4F18-8C88-B6ED711AADC6), both iOS 18.0 simulator; Xcode 27.2 (27B52), Apple Silicon | `blocked: emulator not set up (PO)` |
| Drivers | Taps through ad-hoc Maestro 2.12.1 flows (testIDs) and `xcrun simctl`; screenshots `xcrun simctl io <udid> screenshot` | — |

## 2. Scope
_not yet filled_

## 3. Summary
_not yet filled_

## 4. Failed checks
_not yet filled_

## 5. Blocked checks
_not yet filled_

## 6. Evidence index
`qa/release/evidence/f9765da-ios-sim/` (git-ignored).

## 7. Residual risks
_not yet filled_

## 8. Decision
_not yet filled_
