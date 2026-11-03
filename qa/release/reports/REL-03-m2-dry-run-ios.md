# Release validation: 0.1.0 (M2 dry run, iOS simulator, f9765da)

> **Dry run.** Not a release candidate and not a store GO. The verdict in §8 is a findings list.
> Android: every row `blocked: emulator not set up (PO)`. Simulator-impossible checks (real push, Apple/Google sign-in on a device, haptics, purchases, App Store items) are `blocked: needs device/EAS build`, never pass.

## 1. Build identity
| Field | iOS | Android |
|---|---|---|
| Version / build | 0.1.0 (`CFBundleShortVersionString`), `CFBundleVersion` 1; bundle id `app.bonded.mobile` | not built |
| Commit | `main` @ f9765dae37a3b2a1e78686b07129c751cf5f190c ("Merge pull request #30 ... MOB-09-pairing-fixes"): MOB-07..12, 14, 15 and the #26/#27 fixes | — |
| Build | Local `xcodebuild -workspace Bonded.xcworkspace -scheme Bonded -configuration Release -sdk iphonesimulator -derivedDataPath build CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER=` after `npm ci`, `npx expo prebuild -p ios --no-install`, `pod install`, `git checkout -- package.json`: exactly the recipe in `qa/e2e/README.md` "iOS simulator build" (ad-hoc signing; not `CODE_SIGNING_ALLOWED=NO`). Built in `~/dev/bonded-release`. Only difference: `supabase status` was run in `~/dev/bonded-qa` (the shared stack) to read the anon key. Checks: `strings main.jsbundle \| grep -c 127.0.0.1:54321` = 1; `__entitlements` section present | — |
| EAS profile / channel | none (no EAS build, no EAS Update channel) | — |
| Backend (Supabase project) | Shared **local** stack (project id `bonded`, Supabase CLI 3.0.0) run from `~/dev/bonded-qa`; `EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`, local demo anon key; `EXPO_PUBLIC_INVITE_DOMAIN` unset (links use `bonded://`). Every migration on `main` applied, **plus one not on main: `20261103010000_history_realtime`** (from a backend branch). Scenarios seeded with `qa/scripts/seed-scenario.ts` (`fresh-install`, `solo-invite-pending`, `streak-11-your-turn`, `couple-full`, `invite-expired`, `invite-wrong-code`); no `db reset` | — |
| Email sign-in | The local sign-in mail has no 6-digit code (#28; `mail-otp-check.txt`). Codes came from QA's `.maestro/scripts/fetch-otp.js` fallback: GoTrue admin `generate_link` against 127.0.0.1 only | — |
| RevenueCat environment | none (no keys in the build) | — |
| Devices + OS versions | A: iPhone 16 Pro Max (7CF5DC3B-1232-46D5-A0C9-F5787ABA2AEE), B: iPhone SE 3rd gen (9B4414FE-C7C8-4F18-8C88-B6ED711AADC6); both iOS 18.0 simulator; Xcode 27.2 (27B52), Apple Silicon | `blocked: emulator not set up (PO)` |
| Drivers | Ad-hoc Maestro 2.12.1 flows (testIDs, QA subflows for sign-in and links) kept outside the repo; `xcrun simctl io <udid> screenshot`, `simctl ui appearance` (light/dark), `simctl ui content_size` (AX2 ~200%, AX5 ~310%), Reduce Motion via `simctl spawn defaults write com.apple.Accessibility ReduceMotionEnabled` | — |
| Date | 2026-11-03, 07:20-09:30 device time | — |

## 2. Scope
Milestone: **M2**. Rows in scope: the 76 M2 rows of `qa/release/screen-requirements.csv` (tasks MOB-07..12 merged), plus as extra the MOB-14/15 rows (09, J6, 37, 55; milestone M3). Every other row: **not in build**.
Features not shipped in this build (must not appear on a paywall; there is no paywall yet): nudge (BE-10), history (MOB-16), packs, paywall, gift, settings, unpair, delete account, widgets, Rive mascot (MOB-31), push delivery on a device.

### Paywall mapping (BIZ-03)
Not in build (no paywall, gift or settings screen in M2). The tabs History, Packs and Us show placeholders ("29 History /history", "32 Packs library /packs").

### Tap paths (BIZ-12)
| Target | iOS path (taps) | Android path (taps) |
|---|---|---|
| Paywall with trial copy | not in build | blocked: emulator |
| Restore | not in build | blocked: emulator |
| Delete account (43) | not in build | blocked: emulator |
| Manage subscription | not in build | blocked: emulator |

### Screen rows, M2 (iOS)
| Row | iOS result | Evidence (`qa/release/evidence/f9765da-ios-sim/`) | Note |
|---|---|---|---|
| SCR-01-UI | pass | A-01-light, A-01-dark | copy, layout, tokens match S01 |
| SCR-01-BEH | pass | B-J9-light | 'I have an invite code' opens J3 code entry |
| SCR-02-UI | pass | A-02-light |  |
| SCR-02-BEH | pass | A-02-light | bubbles shown; 'once' not re-checked after back |
| SCR-03-UI | pass | A-03-light |  |
| SCR-03-BEH | pass | A-03-light | option selectable |
| SCR-03-DATA | blocked | - | last_learned stays in the local onboarding store; no column or CONTRACTS entry to write it to (lead) |
| SCR-04-UI | pass | A-04-light |  |
| SCR-04-BEH | pass | A-04-light | 3 steps match |
| SCR-05-UI | pass | A-05-empty, A-05-selected | 'pick a stage' caption not seen on device (unit test covers it) |
| SCR-05-BEH | pass | A-05-empty | 4 stages |
| SCR-05-DATA | pass | db-noor-onboarding.txt | couples.stage = long_distance |
| SCR-06-UI | pass | A-06-empty, A-06-selected |  |
| SCR-06-BEH | not in build | - | packs and paywall copy are M3 |
| SCR-06-DATA | pass | db-noor-onboarding.txt | couples.goals = {deep_talks,romance} |
| SCR-07-UI | fail #37 | A-07-filled | 'Your bond starts on day 1' missing (sev-4) |
| SCR-07-BEH | pass | A-10-share-text.txt, A-after-09-deny | partner name in 10 title and share text |
| SCR-07-DATA | pass | db-noor-onboarding.txt | profiles.display_name, couples/pair_invites.partner_name |
| SCR-08-UI | pass | A-08-light, A-08-dark, B-J4-light |  |
| SCR-08-BEH | pass | A-08-light | native Apple button style (visual only; Apple sign-in itself: blocked, device) |
| SCR-08-DATA | pass | mail-otp-check.txt | email OTP via admin generate_link fallback (#28) |
| SCR-10-UI | pass | A-after-09-deny, A-10-dark | button order differs from board (share first), fine |
| SCR-10-BEH | pass | A-10-share-sheet, A-10-share-text.txt | link bonded://j/BND3320?t=<32 chars> |
| SCR-10-DATA | pass | db-noor-onboarding.txt | code 3320, 48 h, link with token |
| SCR-11-UI | fail #36 | A-11-light, A-11-dark, A-11-maya | no day-1 question card |
| SCR-11-BEH | pass | A-18-solo, A-19-solo, A-23-solo | answered before partner joined |
| SCR-11-DATA | fail #36 | A-11-maya, A-13-maya | day-1 question not shown; invite status realtime works (11 -> 13 by itself) |
| SCR-12-UI | pass | B-12-light | generic copy before a code (inviter unknown) |
| SCR-12-BEH | pass | B-J5-filled, B-13-sam | partner is sky on the joiner's phone (12 itself shows no avatar before a code) |
| SCR-12-DATA | pass | B-12-typed, pairing JUnit signed-in | accept_invite: COUPLE_FULL shown; signed-in join 2/2 (QA suite device B ok) |
| SCR-13-UI | fail #37 | A-13-maya, B-13-sam, B-13-dark | 'Day 1' chip left-aligned (sev-4) |
| SCR-13-BEH | pass | A-13-maya, B-13-sam | shown on both phones; heavy haptic: blocked (device) |
| SCR-13-DATA | pass | db-pair-link.txt | paired_at set, 2 members |
| SCR-J3-UI | pass | B-J3-light, B-J3-dark |  |
| SCR-J3-BEH | pass | B-J9-light | manual entry from 01 |
| SCR-J3-DATA | pass | B-J3-light, db-pair-link.txt | code from link redeemed |
| SCR-J4-UI | pass | B-J4-light, B-J4-dark |  |
| SCR-J4-BEH | pass | B-J4-light, A-08-light | same SignInView as 08 |
| SCR-J4-DATA | pass | B-J5-light | email OTP (fallback, #28) |
| SCR-J5-UI | fail #37 | B-J5-light, B-J5-filled | no stage/date summary line (sev-4) |
| SCR-J5-BEH | pass | B-J5-filled | stage and dates not asked |
| SCR-J5-DATA | pass | B-21-J7-reveal | display_name 'Sam' used everywhere after join |
| SCR-J7-UI | pass | B-J7, B-J7-draft-after-relaunch |  |
| SCR-J7-BEH | pass | B-21-J7-reveal | lock in goes straight to 21 (no 20) |
| SCR-J7-DATA | pass | B-21-J7-reveal | partner answer only after mine |
| SCR-J9-UI | pass | B-J9-light, B-J9-dark |  |
| SCR-J9-BEH | pass | B-J9-light | 'Start my own instead' present; error haptic: blocked (device) |
| SCR-J9-DATA | pass | B-J9-light, B-J3-rate-limited | INVALID_CODE message; RATE_LIMITED after 5 |
| SCR-J10-UI | fail #37 | B-12-typed, B-J10-light | title generic, no 'Contact support' (known gap) |
| SCR-J10-BEH | pass | B-J10-light | couple stays at 2 members |
| SCR-J10-DATA | pass | B-12-typed | COUPLE_FULL -> J10 |
| SCR-18-UI | fail #33 | A-18-light, B-J7, B-18-after-swipe | matches on Pro Max; on SE 'Answer' sits under the tab bar |
| SCR-18-BEH | pass | A-18-countdown-ticks.txt | countdown ticks |
| SCR-18-DATA | pass | A-18-light, B-23-light, B-24-live | answer status x2 live, streak 11 |
| SCR-19-UI | fail #32 | A-19-light, A-19-dark, tmpB, tmpB2, tmpB3 | matches on Pro Max; on SE keyboard hides 'Lock in' and can't be dismissed |
| SCR-19-BEH | pass | A-19-light, A-19-solo | private line visible |
| SCR-19-DATA | pass | reveal-network-maya-before.json, reveal-network-maya-after.json | RLS hides partner answer until both exist |
| SCR-20-UI | pass | A-20-light, A-20-AX2-scrolled |  |
| SCR-20-BEH | pass | A-20-light, A-21-light, B-20-reduced-after-one-tap | short tap stays; long press reveals; reduced motion tap + confirm; ticks/success haptic: blocked (device) |
| SCR-20-DATA | pass | A-20-early-link, reveal-network-maya-before.json | 20 never shows text; early link = not-ready |
| SCR-21-UI | pass | A-21-light, A-21-day12, B-21-reduced, A-21-AX2 |  |
| SCR-21-BEH | pass | A-21-love, B-21-sees-love | selected state + partner sees 'Maya loved this'; heart beat animation not observable in screenshots |
| SCR-21-DATA | pass | B-21-sees-love, A-21-day12 | reaction row upserted; streak 11 -> 12 |
| SCR-22-UI | pass | A-22-empty, A-22-two, B-22-received |  |
| SCR-22-BEH | pass | B-22-received, A-22-two | messages appear once, no duplicates (client_id unique); animation itself not observable |
| SCR-22-DATA | pass | B-22-received | thread_message realtime within ~2 s; typing presence: not observed (driver timing), not yet checked |
| SCR-24-UI | pass | A-24-day1, B-24-live | on SE the CTA is below the fold (see #33 comment) |
| SCR-24-BEH | pass | B-24-live | next badge 14 with ring |
| SCR-24-DATA | pass | A-24-day1, B-24-live | streak, next badge, next question time |
| SCR-56-UI | fail #37 | B-56-light | generic copy (known: error body has no inviter name) |
| SCR-56-BEH | fail #37 | B-56-light | no 'Ask Maya for a new code' action |
| SCR-56-DATA | pass | B-56-light | INVITE_EXPIRED -> 56 |
| SCR-64-UI | pass | A-20-dark-64 |  |
| SCR-64-BEH | pass | A-20-dark-64 | dark tokens |
| SCR-65-UI | pass | B-22-dark-65 |  |
| SCR-65-BEH | pass | B-22-dark-65 | partner bubble dark navy (exact #1F2C3A not sampled) |

### Screen rows, extra (MOB-14, MOB-15; milestone M3)
| Row | iOS result | Evidence (`qa/release/evidence/f9765da-ios-sim/`) | Note |
|---|---|---|---|
| SCR-09-UI | pass | A-after-signin, A-09-light |  |
| SCR-09-BEH | pass | A-09-light, A-09-system-prompt, A-after-09-deny | system prompt only after 'Turn on reminders'; denial goes on to 10 |
| SCR-09-DATA | not yet checked | - | ritual_time row not inspected |
| SCR-J6-UI | pass | B-after-J5 | fallback variant (partner ritual time not available yet: mobile waits on a backend RPC) |
| SCR-J6-BEH | not yet checked | - | declined with 'Not now', so the prompt after it wasn't exercised |
| SCR-J6-DATA | blocked | - | default = partner's time needs a backend RPC (mobile status) |
| SCR-37-UI | blocked | - | needs device/EAS build (real push) |
| SCR-37-BEH | blocked | - | needs device/EAS build |
| SCR-37-DATA | blocked | - | needs device/EAS build |
| SCR-55-UI | blocked | - | simulator has no per-device offline switch; shared stack can't be stopped |
| SCR-55-BEH | blocked | - | as above |
| SCR-55-DATA | blocked | - | as above |

### RC_CHECKLIST (iOS)
| Area | Check | iOS result | Evidence / reason |
|---|---|---|---|
| FUN | FUN-01 | pass | 01-07 -> 08 (email OTP) -> 09 -> 10 with code; `A-01-light` ... `A-after-09-deny`, `db-noor-onboarding.txt` |
| FUN | FUN-02 | pass (partial) | link with token, cold start: J3 -> J4 -> J5 -> J6 -> 13 (`B-J3-light` ... `B-13-sam`); typed code on 12 by a signed-in solo user reached J10 path; QA `signed-in` flow passed on device B. Warm start and typed-code join to 13 not yet checked (QA `typed` flow failed on test side, see §7) |
| FUN | FUN-03 | pass | J9 (`B-J9-light`), J10 (`B-J10-light`), 56 (`B-56-light`), RATE_LIMITED after 5 typed failures (`B-J3-rate-limited`); QA `errors` J9 + 56 PASS on this build |
| FUN | FUN-04 | pass (in-build surfaces) | **Reveal rule, by hand, two simulators** (`streak-11-your-turn`): Maya's 18/19 show only 'Sam answered · locked' (`A-18-light`, `A-19-light`); deep links to 21, 20 and 22 before answering show not-ready, no text (`A-21-early-link`, `A-20-early-link`, `A-22-early-link`); PostgREST as Maya returns **no** row for today's question before she answers (`reveal-network-maya-before.json`), both after (`reveal-network-maya-after.json`); J7 day-1 path same (`B-J7` -> `B-21-J7-reveal`). Push, widgets and widget data: not in build (blocked/n-a) |
| FUN | FUN-05 | pass | Maya (Berlin) and Sam (New York) both on day 12 with the same question (`A-18-light`, `B-23-light`) |
| FUN | FUN-06 | pass | hold -> 21 -> reaction seen on the other phone in ~3 s (`B-21-sees-love`); thread messages both ways in <= 2 s (`B-22-received`, `A-22-two`); 23 -> 24 live on B (`B-24-live`, latency bounded by the driver, not measured) |
| FUN | FUN-07 | pass (partial) | +1 seen (11 -> 12, `A-21-day12`); reset and 1/3/7 once: QA contract tests (`qa/contract/streak.test.ts`), not repeated |
| FUN | FUN-08 | blocked | offline: simulator has no per-device network switch and the shared stack must not be stopped (MOB-14 is M3) |
| FUN | FUN-09 | blocked | needs device/EAS build (real push) |
| FUN | FUN-10 | not in build | no Nudge button: waits on BE-10 `send_nudge` (`B-23-scrolled`) |
| FUN | FUN-11 | not in build | History is a placeholder (MOB-16, M3) |
| FUN | FUN-12 | not in build | unpair (M3) |
| FUN | FUN-13 | not in build | delete account (M3) |
| FUN | FUN-14 | pass (partial) | kill/relaunch keeps the session and the J7 draft (`B-J7-draft-after-relaunch`); app update via EAS Update: blocked (no EAS build) |
| FUN | FUN-15 | not in build | widgets (M3+) |
| FUN | FUN-16 | pass (partial) | token in the shared link, 32 chars (`A-10-share-text.txt`); `bonded://` scheme because the invite domain is unset (expected locally); revoke/48 h/limiter bypass: QA contract tests |
| UI | UI-01 | fail | see screen rows: #36 (11), #37 (07, J5, 13, J10, 56); others match in light and dark |
| UI | UI-02 | pass | viewer orange, partner sky on both phones (`A-21-light`, `B-21-sees-love`, `B-J5-filled`, `B-22-dark-65`) |
| UI | UI-03 | pass | no gold on screen in M2 scope; blush only on heart and error states (`B-J9-light`) |
| UI | UI-04 | not yet checked | local stack answers too fast to see loading states |
| UI | UI-05 | fail | iPhone SE: #33 (CTA under tab bar on 18/23/20), #32 (keyboard hides 'Lock in') |
| UI | UI-06 | blocked | haptics need a device |
| UI | UI-07 | pass | waiting on 18/23/11, together on 24/13 (`A-18-light`, `A-24-day1`) |
| UI | UI-08 | not in build | Rive mascot is MOB-31 (M3); static SVGs in this build |
| A11Y | A11Y-01 | blocked | VoiceOver needs a device; labels exist in the accessibility tree (hierarchy dumps), e.g. 20 'Tap again to reveal' |
| A11Y | A11Y-02 | pass | 200% (AX2): 18, 19, 20, 21 wrap, nothing truncated (`A-18-AX2-200pct`, `A-19-AX2`, `A-20-AX2-scrolled`, `A-21-AX2`); at 310% tab labels split mid-word (#37) |
| A11Y | A11Y-03 | pass (partial) | Reduce Motion: one tap does not open, tap + confirm does (`B-20-reduced-after-one-tap`, `B-21-reduced`); mascot still pose: n/a (static mascot until MOB-31) |
| A11Y | A11Y-04 | pass (partial) | QA-07 gallery suite proves 44 pt targets and AA contrast; on device the SE overlap (#33) makes the visible part of CTAs smaller |
| BIZ | BIZ-01 | pass (partial) | bundle: no currency amounts, no RevenueCat keys, one `[PRICE]` token is from a library string table (`bundle-search.txt`); paywall not in build |
| BIZ | BIZ-02..05, 07..12 | not in build | paywall, gift, restore, settings are M3 |
| BIZ | BIZ-06 | pass (partial) | no ratings, reviews or counts on 01-08, 10-13, J-screens, 18-24 |
| IOS | IOS-01 | blocked | Apple button present and native style (`A-08-light`); Sign in with Apple needs a device/EAS build |
| IOS | IOS-02 | pass | soft ask 09 first, system prompt after 'Turn on reminders', denial handled (`A-09-system-prompt`, `A-after-09-deny`) |
| IOS | IOS-03 | blocked | universal links need the real domain + AASA; `bonded://` links work (cold start) |
| IOS | IOS-04 | pass | `PrivacyInfo.xcprivacy` present, tracking false, 3 required-reason categories (`privacyinfo.txt`); no ATT prompt seen |
| IOS | IOS-05 | not in build | paywall/settings M3 |
| IOS | IOS-06 | blocked | only iOS 18.0 simulators run; lowest/latest need the PO's device matrix |
| AND | AND-01..06 | blocked | emulator not set up (PO) |
| PRIV | PRIV-01 | pass (simulator) | 0 hits of answer/message text in both simulators' unified logs for the app (`device-log-scan.txt`); PostHog/Sentry not configured in this build |
| PRIV | PRIV-02 | blocked | store forms not in a dry run |
| PRIV | PRIV-03 | blocked | Terms/Privacy links point at the placeholder domain (GAPS 08/J4) |
| PRIV | SEC-01 | blocked | no security report for f9765da |
| PRIV | SEC-02 | pass | no service-role key or `SUPABASE_SERVICE_ROLE_KEY` in the bundle; `bonded://dev/gallery` redirects to Today (`A-dev-gallery-link`) |
| PRIV | PRIV-04 | fail #38 | iOS share sheet logs the share text with the token in the app's process (simulator, to confirm on device) |
| STORE | STORE-01..06 | not in build / blocked | dry run; no store build |
| HYG | HYG-01..05 | n/a | local build against a local stack by design (no EAS, no prod keys) |

## 3. Summary
Counts are rows; "pass (partial)" counts as pass and says what is still open.

| Area | iOS pass / fail / blocked | Android pass / fail / blocked |
|---|---|---|
| Screen rows, M2 (76) | 64 / 10 / 1 (1 not in build) | 0 / 0 / 76 (emulator not set up) |
| Screen rows, extra MOB-14/15 (12) | 3 / 0 / 7 (2 not yet checked) | 0 / 0 / 12 |
| FUN | 9 / 0 / 2 (5 not in build) | blocked: emulator not set up (PO) |
| UI | 3 / 2 / 1 (1 not in build, 1 not yet checked) | blocked: emulator not set up (PO) |
| A11Y | 3 / 0 / 1 | blocked: emulator not set up (PO) |
| BIZ | 2 / 0 / 0 (1 not in build) | blocked: emulator not set up (PO) |
| IOS | 2 / 0 / 3 (1 not in build) | blocked: emulator not set up (PO) |
| AND | 0 / 0 / 1 | blocked: emulator not set up (PO) |
| PRIV | 2 / 1 / 3 | blocked: emulator not set up (PO) |
| STORE | 0 / 0 / 0 (1 not in build) | blocked: emulator not set up (PO) |
| HYG | 0 / 0 / 0 (1 n/a) | blocked: emulator not set up (PO) |

## 4. Failed checks
| Check | Platform | Issue | Severity |
|---|---|---|---|
| SCR-19-UI (and J7), UI-05 | iOS, iPhone SE | #32 keyboard covers "Lock in" and can't be dismissed (tap outside, drag, Return all fail) | sev-2 |
| SCR-18-UI, UI-05 (also 23, 24, 20 on SE) | iOS, iPhone SE | #33 primary CTA under the tab bar; tap opens History | sev-3 |
| SCR-11-UI, SCR-11-DATA | iOS | #36 no day-1 question card on 11 | sev-3 |
| PRIV-04 | iOS | #38 share sheet logs the invite link with token (simulator; confirm on device) | sev-3 |
| SCR-07-UI, SCR-J5-UI, SCR-13-UI, SCR-J10-UI, SCR-56-UI, SCR-56-BEH, UI-01 | iOS | #37 minor copy/layout differences (incl. known gaps on 56 and J10) | sev-4 |

Also open and seen in this run: #28 (sev-2, backend) sign-in mail has no code; worked around, not a validator finding.

## 5. Blocked checks
| Check | Platform | Reason | Needed to unblock |
|---|---|---|---|
| every row | Android | emulator not set up | PO: Android emulator (or device) on this Mac |
| SCR-13-BEH haptic, SCR-20-BEH haptics, SCR-J9-BEH haptic, UI-06 | iOS | needs device/EAS build | device build |
| SCR-08-BEH Apple flow, IOS-01 | iOS | Sign in with Apple needs a device/EAS build and an Apple team | PO: Apple team + device |
| SCR-37-*, FUN-09 | iOS | real push needs device/EAS build | device build + push credentials |
| SCR-55-*, FUN-08 | iOS | simulator has no per-device offline switch; shared stack can't be stopped | device (airplane mode) or a private stack |
| SCR-03-DATA | iOS | `last_learned` has no destination in CONTRACTS or the schema | lead: decide (store it or drop the DATA row) |
| SCR-J6-DATA | iOS | partner ritual time needs a backend RPC (mobile status, MOB-15) | backend |
| IOS-03 | iOS | universal links need the real domain + AASA | PO: domain |
| IOS-06 | iOS | only iOS 18.0 simulators exercised | PO: supported-version matrix |
| A11Y-01 | iOS | VoiceOver needs a device | device |
| PRIV-02, STORE-* | iOS | no store build in a dry run | RC |
| PRIV-03 | iOS | Terms/Privacy links point at the placeholder domain | PO: domain + pages |
| SEC-01 | iOS | no security report for f9765da | security reviewer |
| FUN-14 (EAS Update part) | iOS | no EAS build | EAS build |

Not yet checked (time): SCR-09-DATA, SCR-J6-BEH, UI-04 loading skeletons, typing presence on 22, warm-start links, typed-code join to 13 by hand.

## 6. Evidence index
All under `qa/release/evidence/f9765da-ios-sim/` on the validator's machine (git-ignored). Prefix `A-` = iPhone 16 Pro Max, `B-` = iPhone SE.
- Onboarding/sign-in: `A-01-light/dark`, `A-02-light`, `A-03-light`, `A-04-light`, `A-05-*`, `A-06-*`, `A-07-filled`, `A-08-light/dark`, `A-after-signin`, `A-09-light`, `A-09-system-prompt`, `A-after-09-deny`, `mail-otp-check.txt`, `db-noor-onboarding.txt`.
- Pairing: `A-10-dark`, `A-10-share-sheet`, `A-10-share-text.txt` (token redacted), `A-11-light/dark`, `A-11-maya`, `A-13-maya`, `B-J3-light/dark`, `B-J4-light/dark`, `B-J5-light`, `B-J5-filled`, `B-after-J5` (J6), `B-13-sam`, `B-13-dark`, `db-pair-link.txt`, `B-12-light`, `B-12-typed` (J10), `B-J10-light`, `B-56-light`, `B-J9-light/dark`, `B-J3-rate-limited`.
- Daily loop: `A-18-solo`, `A-19-solo`, `A-23-solo`, `B-J7`, `B-18-scrolled`, `B-18-after-swipe`, `B-J7-draft-after-relaunch`, `B-21-J7-reveal`, `A-24-day1`, `A-20-light`, `A-20-dark-64`, `A-21-light`, `A-21-love`, `B-21-sees-love`, `A-22-empty`, `A-22-sent`, `B-22-received`, `A-22-two`, `B-22-dark-65`, `A-18-light`, `B-23-light`, `B-23-scrolled`, `A-18-countdown-ticks.txt`, `A-19-light/dark`, `B-24-live`, `A-21-day12`, `B-24-reduced`, `B-20-reduced`, `B-20-reduced-after-one-tap`, `B-21-reduced`, `tmpB.png`/`tmpB2.png`/`tmpB3.png` (#32).
- Reveal rule (network): `reveal-network-maya-before.json`, `reveal-network-maya-after.json` (shape only: who, body length; never text). Script kept outside the repo; it signs in a persona with the local admin `generate_link` (127.0.0.1 only) and reads `answers` through PostgREST with that user's JWT.
- Large text: `A-18-AX2-200pct`, `A-19-AX2`, `A-20-AX2`, `A-20-AX2-scrolled`, `A-21-AX2`, `A-18-AX5-310pct`.
- Hygiene/privacy: `bundle-search.txt`, `privacyinfo.txt`, `device-log-scan.txt`, `A-dev-gallery-link`.
- QA suites on this build: `npm --prefix qa/e2e run pairing -- all --a A --b B` (2026-11-03 08:35-08:46): **PASS** `errors` J9 and 56, `signed-in` device B (12 -> 13; device A failed the 11 race); **FAIL** `link` (joiner stops on J6, test-side), `typed` (inviter flow lost a tap on 08, test-side), J10 (lost tap on 08; J10 itself passed by hand). JUnit: `qa/e2e/out/pairing-*.xml` (git-ignored). Daily suite: _running, result below when done_.

## 7. Residual risks
- **Dropped first taps.** Across the run the first tap on a control was often ignored and a second one worked (02 and 07 Continue, J6 "Not now", 21 love, 22 send, 21 "Talk about it"). It may be the XCUITest driver, but it happened on idle screens too (21 love, 60 s after the reveal). Needs a check by hand on a device (mobile/QA).
- **QA's pairing flows predate MOB-15.** On this build `link` fails because the joiner now passes J6 after J5 (flows expect 13); `inviter-waits` can race (Maya already on 13 when the flow asserts 11). Test maintenance for QA, not app bugs; the same path passed by hand.
- **Shared stack drift.** The stack carries a migration not on main (`20261103010000_history_realtime`). Results hold for main + that migration.
- **Small screens.** Two of the four findings only show on the iPhone SE; nobody had run the app on a 375 x 667 pt screen before. Android small devices are untested.
- **Reveal rule surfaces not in build** (push, widgets) are untested; FUN-04 must be re-run when they land.
- Haptics, Apple/Google sign-in, push, offline and VoiceOver are unproven until a device/EAS build.

## 8. Decision
**Dry run: findings list, no store decision.** If this were an RC it would be **NO-GO** by the rule "any failed P0 check" (SCR-18-UI, SCR-19-UI and SCR-11-UI are P0 and fail; #32 is sev-2 open) and "missing evidence for a P0 check" (Android, device-only checks).
The release blocker **reveal rule passed** on iOS by hand (UI, deep links and network), plus QA's automated suite as listed above.

Findings, in order: #32 (sev-2, SE keyboard on 19/J7), #33 (sev-3, SE CTA under tab bar), #36 (sev-3, 11 question card), #38 (sev-3, token in OS log, confirm on device), #37 (sev-4 bundle). Lead decisions needed: SCR-03-DATA destination; whether 56/J10 copy variants go into DESIGN_DELTA.

Validated by: Release Validator · Date: 2026-11-03
