# Release validation: 0.1.0 (REL-03d iPhone SE re-run of MOB-41, 16 Pro Max pass, token links; iOS simulator, 6f8b851)

> **Follow-up to REL-03c** (`REL-03c-se-mob34.md`). This is not a release candidate and not a store GO. Three runs on one build: (1) the iPhone SE re-run of the MOB-41 fixes (#84 #85 #86) and the 48 h milestone rule; (2) an iPhone 16 Pro Max pass of the screens touched since MOB-34 in light, dark and 200%; (3) the MOB-40 invite-link checks (token and tokenless). Android: not in scope.

## 1. Build identity
| Field | iOS | Android |
|---|---|---|
| Version / build | 0.1.0 (`CFBundleShortVersionString`), `CFBundleVersion` 1; bundle id `app.bonded.mobile` | not built |
| Commit | App code of `main` @ 6f8b851. Built in `~/dev/bonded-release` on 2026-11-04 19:10 (incremental Release build, `ios/` reused from e47fb70; no native dependency change) | — |
| Build | The `qa/e2e/README.md` "iOS simulator build" recipe (Release, iphonesimulator, ad-hoc signing). Checks: bundle points at `127.0.0.1:54321`; `__entitlements` section present; sha256 of `main.jsbundle` starts `f948d626` | — |
| EAS profile / channel | none (no EAS build, no EAS Update channel) | — |
| Backend (Supabase project) | Shared **local** stack in `~/dev/bonded-qa`, owned by QA; not reset, stopped or migrated by the validator. Scenarios seeded only with `npm run qa:scenario`: `streak-11-your-turn`, `streak-6-milestone`, `paired-day1-partner-answered`, `solo-invite-pending` (x4) | — |
| Email sign-in | Six-digit code from the local mail catcher | — |
| RevenueCat environment | none (no keys in the build) | — |
| Devices + OS versions | B = "REL-B iPhone SE 3rd" `D057FF7E`, iOS 18.0, 375 x 667 pt (run 1). A = "REL-A iPhone 16 Pro Max" `E90AE3CD`, iOS 18.0, 440 x 956 pt (runs 2 and 3). QA's simulators 3932C65B and 02B00957 not used | not in scope |
| Drivers | Maestro one-step flows in the validator's scratch space, QA's link-prompt subflow, `xcrun simctl openurl`, `simctl io screenshot`, `simctl ui appearance`, `simctl ui content_size` (`large` = default, `accessibility-large` = AX2 ~200%, fontScale 1.94; `accessibility-extra-extra-extra-large` = AX5). Frames from `maestro hierarchy` (ids and bounds only, no text) | — |
| Date | 2026-11-04 19:10 to 2026-11-05 12:15 UTC, with stops for usage limits | — |

## 2. Scope
- **Run 1, iPhone SE (B):** #84 (19 at AX5 with the keyboard), #85 (J7 and 19 counter and privacy line while typing), #86 (20 at AX5 sealed-card name), and the MOB-41 48 h rule (no milestone sheet 25/52b on a sign-in session; still shown after answering).
- **Run 2, iPhone 16 Pro Max (A):** screens whose frames changed since MOB-34 (OnboardingFrame, DailyFrame, Today, 47, 01 sign-in path, J2): 01-08, 47, 18, 19, J7, 24, 20, J2 in light, dark and 200% (AX2).
- **Run 3, MOB-40 invite links on A:** `bonded://j/BND4827?t=<seed token>` cold signed out, warm signed out, signed in solo; `bonded://j/BND4827` without a token.

Paywall mapping (BIZ-03) and tap paths (BIZ-12): not in this build, unchanged from REL-03.

### Run 1: iPhone SE (B), evidence `B-*`
| Check | Issue | Result | Evidence (`qa/release/evidence/6f8b851-ios-sim/`) | Note |
|---|---|---|---|---|
| 19 at AX5, keyboard open, light + dark | #84 | **pass** | B-19-AX5-keyboard-light, B-19-AX5-keyboard-dark (+hierarchy), B-19-AX5-kb-end (+hierarchy), B-19-AX5-closed-light (+hierarchy) | Top bar y 20-76; field y 90-407 visible while typing. Comment: https://github.com/saeedarafa/bonded/issues/84#issuecomment-6654421559 |
| J7 and 19 at default size, keyboard open, light + dark | #85 | **pass** | B-J7-kb-light, B-J7-kb-dark, B-19-kb-default-light, B-19-kb-default-dark (+hierarchy each) | Counter y 276-295 and privacy line y 303-323 above the footer (y 335). Comment: https://github.com/saeedarafa/bonded/issues/85#issuecomment-6654421990 |
| 20 at AX5, light + dark | #86 | **pass** | B-20-AX5-dark-top, B-20-AX5-sealed-name-light, B-20-AX5-sealed-name-dark, B-20-AX5-sealed-hierarchy.txt, B-20-AX5-hold-light (+hierarchy) | "Locked" chip stacked; partner name on one line. Comment: https://github.com/saeedarafa/bonded/issues/86#issuecomment-6654422490 |
| 48 h rule: `streak-11-your-turn`, Maya signs in | MOB-41 | **pass** | B-48h-s11-after-signin, B-48h-s11-after-signin-15s | Today, no 25 (checked again after 15 s) |
| 48 h rule: `streak-6-milestone`, sign in, then answer | MOB-41 | **pass** | B-48h-s6-after-signin (+hierarchy), B-48h-s6-after-signin-15s, B-48h-s6-21, B-48h-s6-25, B-48h-s6-after-keep-going | No 52b on sign-in; after answering: 21 -> 25 -> Today |
| 08 email and code entry with the keyboard (seen while signing in) | — | **fail**, new #ISSUE_SE08 | B-08-kb-typed (+hierarchy), B-08-code-kb (+hierarchy), B-08-after-send-key | Email field y 517-565 and "Send code" y 579-635 are behind the keyboard (top about y 451); code field y 406-454 is behind the number pad. Return key still sends |
| 29 History at AX5 (seen while checking 24) | — | **fail**, new #ISSUE_SE29 | B-26-AX5-title-light (file name says 26; the screen is 29 History) | Large title breaks mid-word ("Histor" / "y") |

All three issues were already closed; nothing in their scope failed, so no reopen request.

### Run 2: iPhone 16 Pro Max (A), evidence `A-*`
200% = AX2. At AX2 the Pro Max is not "cramped", so footers stay pinned (MOB-34 rule).

| Screen | Light | Dark | 200% | Evidence | Note |
|---|---|---|---|---|---|
| 01 Welcome | pass | pass | pass | A-01-light, -dark, -AX2-light (+hierarchy) | |
| 02 | pass | pass | pass | A-02-* | |
| 03 | pass | pass | pass | A-03-* | |
| 04 How it works | pass | pass | pass, sev-4 note | A-04-*, A-04-AX2-step-crop | Step numbers overflow their circles: #ISSUE_04 |
| 05 | pass | pass | pass | A-05-*, A-05-missing-light, A-05-selected-light | Missing-choice hint shown |
| 06 | pass | pass | pass | A-06-* | |
| 07 | pass | pass | pass | A-07-*, A-07-AX2-kb-light | AX2 keyboard: focused field and Continue above the keyboard |
| 47 Key dates | pass | pass | **fail** | A-47-*, A-47-AX2-scrolled-light, A-47-AX2-scrolled2-light, A-47-AX2-scrolled-hierarchy.txt | Letter-by-letter breaks: #ISSUE_47 |
| 08 (onboarding variant) | — | — | pass | A-08-AX2-light, A-08-AX2-scrolled-light (+hierarchy), A-08-email-kb, A-08-code-kb (+hierarchy) | Scrolls to email and terms; on the Pro Max the fields clear the keyboard |
| 01 "I already have an account" -> 08 "Welcome back" | pass | pass | pass | A-08-returning-* | No progress bar |
| 18 | pass | pass | pass | A-18-* | |
| 19 | pass | pass | pass | A-19-*, A-19-kb-*, A-19-AX2-kb-* | Includes keyboard |
| J7 | pass | pass | pass, sev-4 note | A-J7-*, A-J7-AX2-kb-light (+hierarchy) | Keyboard: two-line button covers the privacy line: #ISSUE_J7 |
| 24 Today | pass | pass | pass | A-24-*, A-24-AX2-scrolled-light (+hierarchy) | Scrolls; countdown reachable |
| 20 Hold to reveal | pass | pass | pass, sev-4 note | A-20-*, A-20-AX2-scrolled-light (+hierarchy) | Sealed card reachable by scroll; label not centred once wrapped: #ISSUE_20 |
| J2 Personal welcome | pass | pass | **fail** | A-J2-*, A-J2-AX2-ids.txt, A-J2-AX2-swiped-light, A-J2-AX2-swiped-ids.txt | No scroll; secondary button cut off: #ISSUE_J2 |

### Run 3: MOB-40 invite links on A, evidence `A-tok-*`
No "Open in" prompt appeared for any `xcrun simctl openurl` call.

| Check | Result | Evidence | Note |
|---|---|---|---|
| (a) cold start, signed out, link with token | **pass** | A-tok-a-cold-J2 (+hierarchy), A-tok-a-cold-J4, A-tok-a-cold-J5 | Clear state, app stopped, then openurl: J2 "Maya invited you" with initial avatar -> Join Maya -> J4 "Save your answers" 1/3 -> email code as a new account -> J5 2/3. The token string was not found anywhere in the app data container after sign-in. Join not confirmed |
| (b) warm start, signed out, link with token | **pass** | A-tok-b-warm-01, A-tok-b-warm-J2 | App open on 01, then openurl: J2 with Maya's name and initial |
| (c) signed in solo (Lea), link with token | **pass** | A-tok-c-lea-home, A-tok-c-lea-J2, A-tok-c-lea-after-join, A-tok-c-lea-J5-confirm (+hierarchy) | J2 -> Join Maya -> J5 2/3 (no J4) -> name -> Join Maya -> D37 sheet "Join Maya?" (space archived read-only for 30 days, Maya never sees it, own code stops working; "Join and archive my space" / "Cancel"). Not confirmed by the validator |
| (d) cold start, signed out, link without token | **pass** | A-tok-d-01, A-tok-d-after-open, A-tok-d-J3 (+hierarchy) | J3 "You're joining Maya" with BND 4 8 2 7 filled in, found row with initial M, Continue enabled (`join-code-input`, `join-code-found`, `join-code-continue`) |

Note on (c): the D37 sheet was left open on A during a stop. When work resumed, A showed Today as "Lea & Maya" (A-tok-d-pre) and the database had Lea joined to Maya's couple at 11:28:40Z, about an hour later. The validator did not tap "Join and archive my space"; the cause is unknown (a killed `maestro hierarchy` process or a stray input are possible). It is not counted as a finding; `solo-invite-pending` was reseeded before (d).

## 3. Summary
| Area | iOS pass / fail / blocked | Android pass / fail / blocked |
|---|---|---|
| Run 1: MOB-41 re-run on SE (#84 #85 #86, 48 h rule) | 5 / 0 / 0 | not in scope |
| Run 1: other SE observations (08, 29) | 0 / 2 / 0 | not in scope |
| Run 2: Pro Max screens x light/dark/200% | 44 / 2 / 0 (46 screen x mode cells; fails: 47 and J2 at 200%) | not in scope |
| Run 3: MOB-40 links | 4 / 0 / 0 | not in scope |

## 4. Failed checks
| Check | Platform | Issue | Severity |
|---|---|---|---|
| J2 at 200% (A11Y-02, UI-05): no scroll, "This invite isn't for me" runs past the screen bottom | iOS, 16 Pro Max | #ISSUE_J2 | sev-3 |
| 47 at 200% (A11Y-02): partner-birthday label breaks one letter per line, "Anniversary" mid-word | iOS, 16 Pro Max | #ISSUE_47 | sev-3 |
| 08 email/code fields behind the keyboard (UI-05) | iOS, iPhone SE | #ISSUE_SE08 | sev-3 |
| 29 History title breaks mid-word at AX5 (M3) | iOS, iPhone SE | #ISSUE_SE29 | sev-4 |

Other new issues (no row fails on them):
| Observation | Issue | Severity |
|---|---|---|
| J7 at 200% with the keyboard: two-line pinned button covers "Private until you both answer" | #ISSUE_J7 | sev-4 |
| 20 at 200%: "Hold to reveal" label left-aligned once it wraps | #ISSUE_20 | sev-4 |
| 04 at 200%: step numbers overflow their circles | #ISSUE_04 | sev-4 |

## 5. Blocked checks
| Check | Platform | Reason | Needed to unblock |
|---|---|---|---|
| 20 hold haptics and selection ticks, VoiceOver order | iOS | simulator | device build |
| Apple and Google sign-in buttons (shown, not pressed), keyboard autofill | iOS | simulator, no accounts | device build + PO test accounts |
| Universal links (https) | iOS | no real domain (IOS-03); only the `bonded://` scheme was checked | PO: domain |
| Everything Android | Android | emulator not set up | PO |

## 6. Evidence index
All under `qa/release/evidence/6f8b851-ios-sim/` on the validator's machine (git-ignored). `B-*` = iPhone SE (run 1), `A-*` = 16 Pro Max (run 2), `A-tok-*` = links (run 3). `*-hierarchy.txt` / `*-ids.txt` = testID + bounds only, no text. `tmp.png` and `x.txt` are scratch, not evidence. QA automated suites were not re-run.

## 7. Residual risks
- **200% on M3 screens.** J2 and 47 have no scroll or no shrinking value column at AX2 even on the largest phone; on the SE they will be worse. Not checked on the SE at 200% in this run.
- **Keyboard avoidance on 08.** On the SE the sign-in fields are hidden while typing; the Return key still works, so sign-in is possible but the typed email cannot be seen.
- **Unexplained join in (c).** Lea's join was committed while the D37 sheet was unattended. Most likely the harness; if it happens again with no input, it would be a sev-1 (D37 confirmation bypassed). Worth a check by QA with an automated test that leaves the sheet open.
- Load on the shared Mac made `maestro hierarchy` hang once (>200 s). Each step was checked by screenshot.

## 8. Decision
**Re-run: findings list, no store decision.** #84, #85, #86 and the MOB-41 48 h rule pass on 6f8b851 on the SE; the four MOB-40 link checks pass on the Pro Max. New: three sev-3 (J2, 47, SE 08) and four sev-4 (SE 29, J7, 20, 04). No sev-1 or sev-2 bug. If this were an RC it would still be **NO-GO** under "missing evidence for a P0 check" (Android and device-only checks have no evidence).

Validated by: Release Validator · Date: 2026-11-05
