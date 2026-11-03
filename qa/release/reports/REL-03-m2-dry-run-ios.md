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
_not yet filled. Working notes so far (raw, to be folded into the tables):_

```
FUN-01 pass: 01-07 -> 08 email OTP (admin generate_link fallback, #28 mail has no code: evidence mail-otp-check.txt) -> 09 soft ask -> system prompt -> deny -> 10 code BND-3320. DB: stage long_distance, goals deep_talks,romance, partner_name Riley, invite 48h (db-noor-onboarding.txt)
SCR-01 UI pass light/dark (A-01-light/dark); 01-BEH via QA typed suite
SCR-02 UI pass (A-02-light); bubbles visible; 02-bubbles testID not in a11y tree (fine)
SCR-03 UI pass (A-03-light); DATA: last_learned only local store, no DB column/contract -> lead
SCR-04 UI pass (A-04-light) 3 steps copy matches
SCR-05 UI pass (A-05-empty/selected); missing caption not seen on device (unit test covers) 
SCR-06 pass (A-06-empty/selected)
SCR-07 UI: missing "Your bond starts on day 1" line vs board (sev4); 
SCR-08 pass light/dark, Apple button native black/white
Taps on Continue sometimes dropped by driver (02, 07) - second tap works. risk.
09 soft ask before system prompt pass (A-09-light, A-09-system-prompt), deny -> 10 graceful (A-after-09-deny)
10 pass light/dark (A-10-dark), share sheet (A-10-share-sheet) link bonded://j/BND3320?t=<32 chars> (A-10-share-text.txt)
11 FAIL UI: no day-1 question card (board has card + "Sam's answer appears here"); mascot a11y label "Riley hasn't answered yet" while not joined; same on 02 onboarding mascot label "Your partner hasn't answered yet" (sev4)
11-BEH pass: Answer first -> 18 solo -> 19 -> 23 (A-18-solo, A-19-solo, A-23-solo)
18 solo: "You" avatar initial "Y" not "N" (sev4)
solo Today has no path back to invite 10/11 (QA question already)
PRIV-03: Terms/Privacy go to placeholder domain (GAPS) -> blocked
PAIR link: A Maya 11 -> 13 by itself (A-11-maya, A-13-maya) PASS; B Sam cold link -> J3 prefilled (B-J3-light/dark) -> J4 (B-J4-light/dark) email -> J5 (B-J5-light, B-J5-filled; partner avatar sky; no stage/date summary line vs board sev4) -> J6 fallback list (B-after-J5; partner ritual unset so no "Same as Maya") -> Not now -> 13 (B-13-sam, B-13-dark). DB 2 members paired (db-pair-link.txt). Day 1 chip left-aligned on 13 (sev4)
J7 B: 18 then J7 (B-J7, B-J7-draft-after-relaunch) -> 21 instantly (B-21-J7-reveal) PASS; no Maya text before lock in.
ISSUE #32 sev2 SE keyboard J7/19. ISSUE #33 sev3 SE 18 CTA under tab bar.
FUN-14 partial: draft survived kill/relaunch; session survived relaunch.
History/Packs/Us tabs are placeholders showing "29 History /history" (not in build; HYG note)
24 A day1 (A-24-day1) pass; badge ladder last badge cut at edge (scrolls?) 
20 A light + dark 64 (A-20-light, A-20-dark-64) match; short tap stays on 20; long press -> 21 (A-21-light) PASS. haptics blocked.
21 reactions: first love tap ignored (no DB row), second persisted 06:04:05; B shows "Maya loved this" within ~3 s (B-21-sees-love). 
22 thread: A send -> B received <=2s (B-22-received); B reply -> A (A-22-two); dark 65 (B-22-dark-65) partner bubble navy; client_id unique per message (no dupes). Composer stays above keyboard on SE. Typing presence: not seen (driver timing).
First tap on a control is often ignored (02 Continue, 07 Continue, J6 Not now, 21 love, 22 send): repeated pattern -> residual risk / ask mobile+QA to check on device.
```

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
