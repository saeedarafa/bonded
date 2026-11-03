# Release validation: 0.1.0 (REL-03b iPhone SE re-run, iOS simulator, 1f59f57)

> **Follow-up to the REL-03 dry run** (`REL-03-m2-dry-run-ios.md`). This is not a release candidate and not a store GO. It re-runs the iPhone SE rows that failed on f9765da (#32, #33), checks #36 and #37, and covers some of the "not yet checked" rows. Android: not in scope (emulator not set up, PO).

## 1. Build identity
| Field | iOS | Android |
|---|---|---|
| Version / build | 0.1.0 (`CFBundleShortVersionString`), `CFBundleVersion` 1; bundle id `app.bonded.mobile` | not built |
| Commit | `main` @ 1f59f57 ("[LEAD-05] #41 merged via #54; BE-30 (#57); status"). Includes #42 (fixes for #32 #33 #36 #37) and BE-26/#41 (typed-code approval, backend). **Does not include MOB-32** (PR #56, the typed-code approval UI) | — |
| Build | The `qa/e2e/README.md` "iOS simulator build" recipe, run in `~/dev/bonded-release`: `npm ci`, `npx expo prebuild -p ios --no-install`, `pod install` (new native dependency `expo-store-review`), `git checkout -- package.json`, `xcodebuild ... -configuration Release -sdk iphonesimulator CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER=` (ad-hoc signing, not `CODE_SIGNING_ALLOWED=NO`; `DEVELOPER_DIR` not set). Anon key from `(cd ~/dev/bonded-qa && supabase status -o env)`. Checks: `strings main.jsbundle \| grep -c 127.0.0.1:54321` = 1; `__entitlements` section present | — |
| EAS profile / channel | none (no EAS build, no EAS Update channel) | — |
| Backend (Supabase project) | Shared **local** stack in `~/dev/bonded-qa` (project id `bonded`), not reset or migrated by the validator. Scenarios seeded with `npm run qa:scenario`: `paired-day1-partner-answered`, `streak-11-your-turn` (x3), `solo-invite-pending` (x2), `streak-11-both-answered`. One direct test-data edit: Maya's `notification_prefs.ritual_time` set to 08:00 to test the J6 default. One new local test account created through the app: `noor.rel03b@bonded.test` (09-DATA) | — |
| Email sign-in | Six-digit code read from the local mail catcher (QA's `sign-in-email.yaml` subflow; #28 fixed) | — |
| RevenueCat environment | none (no keys in the build) | — |
| Devices + OS versions | The REL-03 simulators (7CF5DC3B, 9B4414FE) **no longer exist** on this Mac. New validator-only simulators on iOS 18.0: A = "REL-A iPhone 16 Pro Max" `E90AE3CD-873E-4237-89DC-5211A5D03243` (installed, not used for checks), B = "REL-B iPhone SE 3rd" `D057FF7E-0B4C-4831-A818-AF41BB1796C7` (375 x 667 pt). Xcode 27.2, Apple Silicon | not in scope |
| Drivers | Maestro 2.12.1 one-step flows (taps by testID, swipes, QA subflows for sign-in, links and hold-to-reveal), kept in the validator's scratch space, not the repo. `xcrun simctl io screenshot`, `simctl ui appearance`, `simctl ui content_size` (`accessibility-large` = AX2 ~200%, `accessibility-extra-extra-extra-large` = AX5 ~310%). Frames are from `maestro hierarchy` (ids and bounds only, no text) | — |
| Date | 2026-11-03, 17:55-18:55 device time. The Mac's load average was 120-670 during the run (other agents' builds and simulators) | — |

## 2. Scope
Milestone: **M2** (re-run). Rows: the SE rows that failed in REL-03, **18, 19, J7, 20, 23, 24** (light, dark, and 200% where REL-03 checked large text), plus **#36** (11) and **#37** (07, 13, "You" avatar, 02 label, AX5 tab bar). Extra: SCR-09-DATA, SCR-J6-BEH and SCR-J6-DATA from the REL-03 "not yet checked" list.
Pairing by typed code: **not in build**. BE-26/#41 now needs the inviter to approve a typed-code join; the approval UI (MOB-32, PR #56) is not in 1f59f57. The token-link join (no approval, D02) was used to reach J6/13.

### Paywall mapping (BIZ-03) and tap paths (BIZ-12)
Not in build (no paywall, gift, settings or delete account in this build); unchanged from REL-03.

### Screen rows re-run on iPhone SE (iOS)
| Row | REL-03 (f9765da) | REL-03b (1f59f57) | Evidence (`qa/release/evidence/1f59f57-ios-sim/`) | Note |
|---|---|---|---|---|
| SCR-18-UI | fail #33 | **pass** | B-18-day1-light (+hierarchy), B-18-your-turn-light (+hierarchy), B-18-AX2-dark | `18-answer` pinned at y 519-575, tab bar at y 588; tap opens J7/19, not History. Dark at default size: `B-18-your-turn-dark` was captured mid-transition, so dark is shown at 200% (`B-18-AX2-dark`) |
| SCR-18-BEH | pass | pass | B-18-day1-light, B-18-your-turn-light | "New in" countdown visible (07:06:11, 06:51:10) |
| SCR-18-DATA | pass | pass | B-18-your-turn-light, B-23-light | partner status "Answered · locked until you reply", streak 11 |
| SCR-J7-UI | pass (SE fail via #32) | **pass**, see #65 | B-J7-light, B-J7-keyboard-open (+hierarchy), B-J7-keyboard-scrolled | "Lock in and reveal Maya's" stays above the keyboard. **New #65 (sev-3):** the focused field sits behind the pinned button until you scroll by hand |
| SCR-J7-BEH | pass | pass | B-J7-keyboard-before-lockin, B-J7-after-lockin | Lock in with the keyboard open goes straight to 21 (no 20) |
| SCR-J7-DATA | pass | pass | B-J7-after-lockin | Maya's answer shown only after Sam's |
| SCR-19-UI | fail #32 | **pass** | B-19-dark, B-19-keyboard-dark (+hierarchy), B-19-AX2-keyboard-dark, B-19-AX2-field-under-button | Field and "Lock in my answer" both above the keyboard; a tap outside and a drag into the keyboard close it (on J7). At 200% the field is under the button until you scroll (#65) |
| SCR-19-BEH | pass | pass | B-19-dark, B-19-keyboard-dark | "Private until you both answer" visible |
| SCR-19-DATA | pass | not re-run | - | RLS proof from REL-03 stands (no backend change to `answers` RLS since) |
| SCR-20-UI | pass (SE overlap noted in #33) | **pass**, see #65 | B-20-dark (+hierarchy), B-20-AX2-dark (+hierarchy) | Hold ring in the footer (y 371-511) with both labels above the tab bar. At 200% the body is only 125 pt (title and sealed card need a scroll, #65) |
| SCR-20-BEH | pass | pass | B-21-dark, B-21-AX2-dark | Long press opened 21 (default and 200%); haptics: blocked (device) |
| SCR-20-DATA | pass | not re-run | - | REL-03 network proof stands |
| SCR-23-UI (M3 row) | fail via #33 | **pass** | B-23-light, B-23-light-scrolled, B-23-dark (+hierarchy) | Nudges off in this build (BE-10), so nothing is pinned. The midnight line is in the body and scrolls clear of the tab bar |
| SCR-24-UI | pass (SE CTA below the fold) | **pass** | B-24-day1-light, B-24-day1-scrolled, B-24-d12-dark, B-24-d12-AX2-dark, B-24-d12-AX2-scrolled | "Revisit today's thread" pinned at y 519-575; it opens 22 (`B-24-thread-tap-hierarchy`). At AX5 (~310%) the header doesn't scroll (#66, sev-4) |
| SCR-24-BEH | pass | pass | B-24-day1-light, B-24-d12-dark | Next badge 3 (day 1) and 14 (day 12) with ring |
| SCR-24-DATA | pass | pass | B-24-day1-scrolled, B-24-d12-dark | Streak 1/12, next badge, "Next question in" countdown |

### #36 and #37
| Row / item | REL-03 | REL-03b | Evidence | Note |
|---|---|---|---|---|
| SCR-11-UI | fail #36 | **pass** | B-11-light, B-11-light-scrolled, B-11-dark, B-11-hierarchy | Card "Day 1 · Today's question", the question, "Sam's answer appears here once you've both replied"; scrolls on the SE |
| SCR-11-DATA | fail #36 | **pass** (question part) | B-11-light | Day-1 question shown; realtime 11 -> 13 not re-run (passed in REL-03) |
| 11 mascot label (#36) | fail | **pass** | B-11-mascot-label.txt | "Bao and Bun, waiting. Sam hasn't joined yet." |
| SCR-07-UI (#37) | fail | **pass** | B-07-filled-light, B-07-hierarchy | "Your bond starts on day 1" present. New on SE: keyboard covers Continue and only Return closes it (#66) |
| SCR-13-UI (#37) | fail | **pass** | B-13-light, B-13-hierarchy | "Day 1" chip centred (x 153-222) |
| "You" avatar initial (#37) | fail | **pass** | B-18-your-turn-light, B-18-day1-light, B-23-light, B-J7-after-lockin | M / S, not "Y" |
| 02 mascot label (#37) | fail | **pass** | B-02-light, B-02-mascot-label.txt | "Bao and Bun, waiting for a quiet moment together." |
| Tab bar at AX5 (#37) | fail | **pass** | B-24-AX5-310pct | Labels whole; the 24 header at AX5 is a new item (#66) |
| SCR-J5-UI, SCR-J10-UI, SCR-56-UI/BEH (#37) | fail | not re-checked | - | Not changed in #42 (need backend data or a lead DESIGN_DELTA decision, PR #42) |

### "Not yet checked" rows from REL-03 §5
| Row | Result | Evidence | Note |
|---|---|---|---|
| SCR-09-DATA | **pass** | B-09-morning-selected, db-09-notification-prefs.txt | New account `noor.rel03b@bonded.test`, picked Morning on 09, then Turn on reminders -> `notification_prefs.ritual_time` = 08:00, `daily_reminder` true |
| SCR-J6-BEH | **pass** | B-J6-light, B-J6-after-accept | System notification prompt appears only after "Turn on reminders" |
| SCR-J6-DATA | blocked | B-J6-maya-0800, db-J6-notification-prefs.txt | With Maya at 08:00, Sam's J6 still preselects 21:00 (the column default). `PARTNER_RITUAL_AVAILABLE = false` in `src/features/push/api.ts`: waits on the backend partner ritual-time RPC |
| FUN-02 typed-code join to 13 | not in build | - | Needs MOB-32 (PR #56) since BE-26/#41 |
| UI-04 loading skeletons, 22 typing presence, warm-start links | not yet checked | - | Time; carried over |

## 3. Summary
Counts are rows of this re-run (iOS, iPhone SE).

| Area | iOS pass / fail / blocked | Android pass / fail / blocked |
|---|---|---|
| SE screen rows (18, J7, 19, 20, 23, 24: 16 rows, 2 not re-run) | 14 / 0 / 0 (2 not re-run: 19-DATA, 20-DATA) | not in scope |
| #36 / #37 items (9 rows) | 8 / 0 / 0 (1 row not re-checked: J5, J10, 56) | not in scope |
| Not-yet-checked rows (7) | 2 / 0 / 1 (1 not in build, 3 still not checked) | not in scope |
| UI-05 small devices | **pass** for the REL-03 findings; open follow-ups #65 (sev-3), #66 (sev-4) | not in scope |
| A11Y-02 200% on SE | pass (18, 19, 20, 21, 24 reachable; 19/20 body cramped, #65) | not in scope |

## 4. Failed checks
No re-run row fails. New issues filed:
| Check | Platform | Issue | Severity |
|---|---|---|---|
| SCR-J7-UI (keyboard), SCR-19-UI / SCR-20-UI at 200% (follow-up to #32/#33) | iOS, iPhone SE | #65 the focused field is hidden behind the pinned "Lock in" until you scroll. At 200% the 19/20 body is very short | sev-3 |
| SCR-07-UI on SE; 24 at AX5 | iOS, iPhone SE | #66 07 keyboard covers Continue (tap outside or drag doesn't close it; Return does); at AX5 the Today header doesn't scroll and covers most of the action | sev-4 |

Issues verified fixed (comment posted on each; they were already closed): #32, #33, #36, #37 (app side).

## 5. Blocked checks
| Check | Platform | Reason | Needed to unblock |
|---|---|---|---|
| SCR-J6-DATA | iOS | Partner ritual time not wired (`PARTNER_RITUAL_AVAILABLE = false`) | backend RPC + mobile flag |
| Haptics on 20/21 | iOS | needs device | device build |
| Everything Android | Android | emulator not set up | PO |
Other blocked rows from REL-03 §5 are unchanged and were not re-run.

## 6. Evidence index
All under `qa/release/evidence/1f59f57-ios-sim/` on the validator's machine (git-ignored). Every file is from simulator B (iPhone SE). `*-hierarchy.txt` = testID + bounds only.
- 18: `B-18-day1-light`, `B-18-day1-hierarchy.txt`, `B-18-your-turn-light`, `B-18-your-turn-hierarchy.txt`, `B-18-your-turn-dark` (mid-transition), `B-18-AX2-dark`, `B-18-AX2-hierarchy.txt`.
- J7: `B-J7-light`, `B-J7-keyboard-open`, `B-J7-keyboard-open-2`, `B-J7-keyboard-hierarchy.txt`, `B-J7-keyboard-scrolled`, `B-J7-after-tap-outside`, `B-J7-keyboard-reopen`, `B-J7-after-drag-down` (drag above the keyboard: stays open), `B-J7-after-drag-into-keyboard` (closes), `B-J7-keyboard-before-lockin`, `B-J7-after-lockin`.
- 19: `B-19-dark`, `B-19-hierarchy.txt`, `B-19-keyboard-dark`, `B-19-keyboard-hierarchy.txt`, `B-19-AX2-field-under-button` (+hierarchy), `B-19-AX2-scrolled` (+hierarchy), `B-19-AX2-field-visible`, `B-19-AX2-keyboard-dark`.
- 20/21: `B-20-dark`, `B-20-hierarchy.txt`, `B-20-AX2-dark`, `B-20-AX2-hierarchy.txt`, `B-21-dark`, `B-21-hierarchy.txt`, `B-21-AX2-dark`.
- 23: `B-23-light`, `B-23-hierarchy.txt`, `B-23-light-scrolled`, `B-23-scrolled-hierarchy.txt`, `B-23-dark`.
- 24: `B-24-day1-light`, `B-24-day1-hierarchy.txt`, `B-24-day1-scrolled`, `B-24-thread-tap-hierarchy.txt`, `B-24-d12-dark`, `B-24-d12-hierarchy.txt`, `B-24-d12-AX2-dark`, `B-24-d12-AX2-hierarchy.txt`, `B-24-d12-AX2-scrolled`, `B-24-AX5-310pct`, `B-24-AX5-hierarchy.txt`, `B-24-AX5-after-swipe` (+hierarchy), `B-24-AX5-after-tap` (+hierarchy).
- 11: `B-11-light`, `B-11-light-scrolled`, `B-11-dark`, `B-11-hierarchy.txt`, `B-11-mascot-label.txt`, `B-11-answer-first-tap`, `B-maya-solo-after-signin` (+hierarchy).
- #37: `B-02-light`, `B-02-mascot-label.txt`, `B-07-filled-light`, `B-07-hierarchy.txt`, `B-13-light`, `B-13-hierarchy.txt`.
- 07 keyboard (#66): `B-07-keyboard-covers-continue`, `B-07-after-tap-outside`, `B-07-after-drag`, `B-07-after-return-1`.
- 09/J6: `B-09-morning-selected`, `B-after-09-accept`, `db-09-notification-prefs.txt`, `B-J6-light`, `B-J6-hierarchy.txt`, `B-J6-after-accept`, `B-J6-maya-0800`, `db-J6-notification-prefs.txt`.
- Other screens seen: `B-52b-day1-light` (+hierarchy, badge sheet after day 1), `B-25-after-signin` (+hierarchy), `B-25-AX2-dark`, `B-25-AX2-after-swipe` (+hierarchy), `B-store-review-prompt-after-25`.
- QA automated suites were not re-run (the run was by hand, one device).

## 7. Residual risks
- **Small screens at large text.** Pinning the actions fixed #32/#33 at the default size. At 200% the pinned footers leave little body on 19/20 (#65), and at AX5 the Today header takes the whole screen (#66). A11Y-02 (200%) still passes because everything is reachable by scrolling.
- **Store review prompt.** After "Keep going" on 25 (7-day milestone) the OS rating sheet ("Enjoying Bonded?") appeared (`B-store-review-prompt-after-25`). This is the system `SKStoreReviewController` from the new `expo-store-review` dependency, not an in-app rating (BIZ-06 not affected). On a fresh sign-in the seeded 7-day badge showed 25 before Today. The lead may want to confirm when the prompt is meant to show.
- **Dropped taps** happened again under the heavy machine load (sign-in email step, a back button on 21). Each was retried and the screen checked after every tap; REL-03 §7 still applies.
- Typed-code pairing is not validated on this build (MOB-32 not merged). It must be re-run when PR #56 lands.
- Pro Max (A) was not re-run; #42 changed shared layout (`DailyFrame`, `TodayActions`), so a large-screen pass is worth doing in the next full run.

## 8. Decision
**Re-run: findings list, no store decision.** The REL-03 SE failures are fixed on 1f59f57: #32 (sev-2) and #33 (sev-3) pass on the iPhone SE, and #36 and the app-side #37 items pass. No sev-1 or sev-2 bug came out of this run. If this were an RC, it would still be **NO-GO** under "missing evidence for a P0 check": Android, the device-only checks and typed-code pairing (not in build) have no evidence.

Validated by: Release Validator · Date: 2026-11-03
