# Release validation: 0.1.0 (REL-03c iPhone SE re-run of MOB-34, iOS simulator, e47fb70)

> **Follow-up to REL-03b** (`REL-03b-se-rerun-ios.md`). This is not a release candidate and not a store GO. It re-runs the iPhone SE checks behind #65, #66 and #68 on the MOB-34 merge (#73), plus a smoke check of the 56 and J10 copy (#37 leftovers). Android: not in scope.

## 1. Build identity
| Field | iOS | Android |
|---|---|---|
| Version / build | 0.1.0 (`CFBundleShortVersionString`), `CFBundleVersion` 1; bundle id `app.bonded.mobile` | not built |
| Commit | App code of `main` @ e47fb70 (MOB-34, PR #73). Built in `~/dev/bonded-release` on 2026-11-03 22:14; `origin/main` had no app change after e47fb70 when the build was made | — |
| Build | The `qa/e2e/README.md` "iOS simulator build" recipe (Release, iphonesimulator, ad-hoc signing). Checks: `strings main.jsbundle \| grep -c 127.0.0.1:54321` = 1; `__entitlements` section present | — |
| EAS profile / channel | none (no EAS build, no EAS Update channel) | — |
| Backend (Supabase project) | Shared **local** stack in `~/dev/bonded-qa`, owned by QA; not reset, stopped or migrated by the validator. It lacks migration 20261103160000 (affects only join-request approval, not used here). Scenarios seeded only with `npm run qa:scenario`: `paired-day1-partner-answered`, `streak-11-your-turn` (x2), `streak-6-milestone`, `invite-expired`, `couple-full` | — |
| Email sign-in | Six-digit code from the local mail catcher (QA's `sign-in-persona.yaml` subflow) | — |
| RevenueCat environment | none (no keys in the build) | — |
| Devices + OS versions | B = "REL-B iPhone SE 3rd" `D057FF7E-0B4C-4831-A818-AF41BB1796C7`, iOS 18.0, 375 x 667 pt (all checks). A = "REL-A iPhone 16 Pro Max" `E90AE3CD` has the build installed, not used. QA's simulator 3932C65B not used | not in scope |
| Drivers | Maestro one-step flows (taps by testID, swipes, QA subflows for sign-in, links and hold-to-reveal) in the validator's scratch space. `xcrun simctl io screenshot`, `simctl ui appearance`, `simctl ui content_size` (`large` = default, `accessibility-large` = AX2 ~200%, `accessibility-extra-extra-extra-large` = AX5 ~310%). Frames are from `maestro hierarchy` (ids and bounds only, no text) | — |
| Date | Started 2026-11-03 22:15, stopped on PO order, resumed 2026-11-04 14:24-16:30 device time. Mac load average 6-520 during the run | — |

## 2. Scope
Re-run of the SE rows behind:
- **#65** (sev-3): J7 and 19 keyboard at the default size; 19 and 20 at 200% (AX2), and at AX5 (MOB-34 says its short-screen rule also covers "any phone at AX5").
- **#66** (sev-4): 07 keyboard (Continue reachable, Return/next moves to the partner field, tap outside and drag close it); Today (24) at AX5.
- **#68** (sev-3): no store review prompt in a session that started with sign-in; the prompt is still possible on a later app open after a milestone.
- **56 and J10** copy after MOB-34 (#37 leftovers, D37, `docs/design/GAPS.md` 2026-11-03 rows).

Paywall mapping (BIZ-03) and tap paths (BIZ-12): not in this build, unchanged from REL-03.

### Results (iOS, iPhone SE)
| Check | Issue | Result | Evidence (`qa/release/evidence/e47fb70-ios-sim/`) | Note |
|---|---|---|---|---|
| J7 keyboard, default size, light | #65 | **pass** | B-J7-light, B-J7-keyboard-open, B-J7-keyboard-hierarchy.txt | Field y 233-321 sits above the pinned "Lock in and reveal" (y 335-391); typed text visible. Before the fix: field 317-405, behind the button. The character counter (y 327-346) and "Private until you both answer" (354-374) are behind the button while typing: #77 |
| J7 keyboard, default size, dark | #65 | **pass** | B-J7-keyboard-dark, B-J7-keyboard-dark-hierarchy.txt | Same frames as light |
| 19 at AX2, keyboard closed | #65 | **pass** | B-19-AX2-light, B-19-AX2-hierarchy.txt | No pinned button: "Lock in" scrolls with the body; field starts at y 457 inside the body (was y 458 under the button). A tap on the field focuses it |
| 19 at AX2, keyboard open, light + dark | #65 | **pass** | B-19-AX2-keyboard-light (+hierarchy), B-19-AX2-keyboard-scrolled (+hierarchy), B-19-AX2-keyboard-scrolled2 (+hierarchy), B-19-AX2-keyboard-submit-reachable, B-19-AX2-keyboard-dark | Field scrolled into view (y 305-407, typed text visible). "Lock in my answer" reachable by scrolling (y 280-391) above the keyboard; tapping it locked the answer and opened 20 |
| 20 at AX2, dark | #65 | **pass** | B-20-AX2-dark, B-20-AX2-hierarchy.txt, B-20-AX2-dark-scrolled, B-20-AX2-scrolled-hierarchy.txt | Body is the full screen (y 76-585); "Sam's answer is ready" visible without scrolling (was a 125 pt body). Sealed card and hold ring reached by scrolling |
| 20 at AX5, dark | #65 | **pass** (layout) | B-20-AX5-dark-top, B-20-AX5-dark-scrolled, B-20-AX5-scrolled-hierarchy.txt, B-20-AX5-sealed-name | Hold ring reachable (y 326-466). The partner name on the sealed card breaks letter by letter next to the "Locked" chip: #78 |
| 19 at AX5, keyboard open, light + dark | #65 (short-screen rule) | **fail**, new #76 | B-19-AX5-light, B-19-AX5-field-closed, B-19-AX5-keyboard-light, B-19-AX5-keyboard-dark, B-19-AX5-keyboard-hierarchy.txt | The pinned top bar title "Today's question" is not capped: it breaks mid-word and fills y 20-406. With the keyboard open the scroll viewport is 1 pt (y 406-407), so the field being typed in is not visible at all. Different cause from #65 (header, not footer), so filed separately |
| 07 keyboard, light | #66 | **pass** | B-07-keyboard-me-light (+hierarchy), B-07-after-next-typed-partner (+hierarchy) | "Continue" (y 335-391) above the keyboard; field visible. Return ("next") moved focus to the partner field, which scrolled into view |
| 07 tap outside / drag | #66 | **pass** | B-07-after-tap-outside (+hierarchy), B-07-after-drag (+hierarchy) | Both close the keyboard (no `shift` key in the hierarchy; Continue back at y 595-651) |
| 07 Continue with keyboard open | #66 | **pass** | B-after-07-continue (+hierarchy) | Opens 08 |
| 07 keyboard, dark | #66 | **pass** | B-07-keyboard-dark (+hierarchy) | Same frames as light |
| 24 at AX5, dark + light (both answered, Maya) | #66 | **pass** | B-24-AX5-top (+hierarchy), B-24-AX5-dark, B-24-AX5-action (+hierarchy), B-24-AX5-action-full (+hierarchy), B-24-AX5-action-light, B-24-AX5-bottom (+hierarchy) | Header scrolls with the body; "Maya & Sam", "Day 12 together" break between words only. "See Sam's answer" (`24-reveal`) scrolls fully into view above the tab bar (y 374-548). Reached by Maya locking in on `streak-11-your-turn` (same state as `streak-11-both-answered`) |
| 25 review prompt, negative (session started with sign-in) | #68 | **pass** (x2) | B-68-neg-25-AX2, B-25-AX2-scrolled (+hierarchy), B-68-neg-after-keep-going (+hierarchy), B-68-neg2-after-keep-going-AX5 | Fresh install (clear state), sign in Maya on `streak-11-your-turn`: 25 shows, "Keep going" -> Today, no system sheet (hierarchy has no "Enjoying"/"Not Now"), checked again 5 s later. Repeated after reseeding (AX5) |
| 25 review prompt, negative after 52b | #68 | **pass** | B-68-pos-s1-after-signin | `streak-6-milestone`, fresh install + sign-in: the 3-day badge sheet (52b) "Keep it going" -> no system sheet |
| 25 review prompt, positive (later app open) | #68 | **pass** | B-68-pos-s2-launch, B-68-pos-after-reveal, B-68-pos-25, B-68-pos-after-keep-going | Same install, `simctl terminate` + relaunch (session 2), answer + hold to reveal -> 21 -> back -> 25 (7 days) -> "Keep going" -> the system sheet "Enjoying Bonded?" appears. Dismissed with "Not Now" |
| 56 copy and actions, light + dark | #37 | **pass** | B-56-light, B-56-hierarchy.txt, B-56-ask-share, B-56-after-retry (+hierarchy), B-56-dark | `invite-expired`, signed out, 01 -> "I have an invite code" -> 4827: "This invite has expired", "Code BND·4827 expired", "Ask your partner for a new code" (name unknown, as GAPS.md 2026-11-03), "Enter a different code". Ask opens the share sheet with one plain line (code only, no link or token). "Enter a different code" returns to the code field |
| J10 signed in | #37, D37 | see below | | |

## 3. Summary
| Area | iOS pass / fail / blocked | Android pass / fail / blocked |
|---|---|---|
| #65 (J7, 19, 20 at default/AX2/AX5) | 6 / 1 / 0 (the fail is the new AX5 header bug #76) | not in scope |
| #66 (07, 24 at AX5) | 5 / 0 / 0 | not in scope |
| #68 (review prompt timing) | 3 / 0 / 0 | not in scope |
| 56 / J10 smoke | see table | not in scope |

## 4. Failed checks
| Check | Platform | Issue | Severity |
|---|---|---|---|
| 19 at AX5 with the keyboard open (A11Y-02 extended, UI-05) | iOS, iPhone SE | #76 pinned top bar title fills the top 60% of the screen at AX5; with the keyboard open the field is invisible | sev-3 |

Other new issues (no row fails on them):
| Observation | Issue | Severity |
|---|---|---|
| J7/19 default size: counter and "Private until you both answer" hidden behind the pinned button while typing | #77 | sev-4 |
| 20 at AX5: partner name on the sealed card breaks letter by letter | #78 | sev-4 |

## 5. Blocked checks
| Check | Platform | Reason | Needed to unblock |
|---|---|---|---|
| Store review sheet on TestFlight / App Store builds | iOS | The simulator always shows `SKStoreReviewController`; on TestFlight it never shows and in production the OS decides | device + production build (only our timing rule is proven here) |
| Everything Android | Android | emulator not set up | PO |

## 6. Evidence index
All under `qa/release/evidence/e47fb70-ios-sim/` on the validator's machine (git-ignored), all from simulator B (iPhone SE). `*-hierarchy.txt` = testID + bounds only. Files dated before the 22:14 build were moved to `_stale-before-2214/` and are not used.
- J7: `B-18-day1-light` (+hierarchy), `B-J7-light` (+hierarchy), `B-J7-keyboard-open`, `B-J7-keyboard-hierarchy.txt`, `B-J7-keyboard-dark` (+hierarchy).
- 19/20 AX2: `B-18-AX2-light` (actually 25 on arrival), `B-19-AX2-light` (+hierarchy), `B-19-AX2-keyboard-light` (+hierarchy), `B-19-AX2-keyboard-scrolled` (+hierarchy), `B-19-AX2-keyboard-scrolled2` (+hierarchy), `B-19-AX2-keyboard-submit-reachable`, `B-19-AX2-keyboard-dark`, `B-20-AX2-dark` (+hierarchy), `B-20-AX2-dark-scrolled`, `B-20-AX2-scrolled-hierarchy.txt`.
- AX5: `B-20-AX5-dark-top`, `B-20-AX5-dark-scrolled`, `B-20-AX5-scrolled-hierarchy.txt`, `B-20-AX5-sealed-name`, `B-24-AX5-*`, `B-19-AX5-*`.
- 07: `B-07-keyboard-me-light` (+hierarchy), `B-07-after-next-typed-partner`, `B-07-after-next-hierarchy.txt`, `B-07-after-tap-outside` (+hierarchy), `B-07-after-drag` (+hierarchy), `B-after-07-continue` (+hierarchy), `B-07-keyboard-dark` (+hierarchy).
- #68: `B-68-neg-*`, `B-68-neg2-*`, `B-25-AX2-scrolled` (+hierarchy), `B-68-pos-*`.
- 56: `B-56-light`, `B-56-hierarchy.txt`, `B-56-ask-share`, `B-56-after-retry` (+hierarchy), `B-56-dark`.
- J10: see the J10 row.
- QA automated suites were not re-run (by hand, one device).

## 7. Residual risks
- **AX5 on short screens.** MOB-34's short-screen rule fixes the footers, but pinned top bars with large titles (19 "Today's question") are not covered (#76). Other screens with a titled top bar were not checked at AX5.
- **Seeded milestones on sign-in.** On a fresh sign-in, `streak-11-your-turn` shows the 7-day milestone (25) and `streak-6-milestone` the 3-day badge (52b) before Today. Probably the "unseen milestone" catch-up; not checked against a rule.
- **Dropped taps** under machine load (onboarding 04/05 Continue, back on 21, one sign-in). Each was retried and the screen checked after every step.
- After a simulator reboot the software keyboard appeared only after Maestro typed text (a tap alone left it hidden). Test-harness only, not an app issue.
- The Pro Max (A) was not re-run on MOB-34; DailyFrame, OnboardingFrame and Today changed.

## 8. Decision
**Re-run: findings list, no store decision.** #65 (in its scope: J7 at the default size, 19/20 at 200%), #66 and #68 pass on e47fb70; 56 passes. One new sev-3 (#76, 19 at AX5) and two sev-4 (#77, #78). No sev-1 or sev-2 bug. If this were an RC it would still be **NO-GO** under "missing evidence for a P0 check" (Android and device-only checks have no evidence).

Validated by: Release Validator · Date: 2026-11-04
