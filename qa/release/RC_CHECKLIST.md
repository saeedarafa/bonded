# Release-candidate checklist

**Owner:** release validator. Run every row on **iOS and Android** unless the row says otherwise. Screen-level rows (one per P0/P1 screen) are in `screen-requirements.csv`. This file holds the cross-cutting checks. Method and report format: the `bonded-release-check` skill.

A P0 row that fails, or that has no evidence, makes the build **NO-GO**.

## Coverage
- **Every P0/P1 screen:** the `-UI`, `-BEH` and `-DATA` rows in `screen-requirements.csv` (generated from `docs/plan/scope-map.json`; never hand-edit) plus UI-01 below. Regenerate with `node scripts/plan/generate.mjs`; `--check` must print `up to date` before a run.
- **Every P0 rule:** the IDs below. Scope decisions from the 2026-11-02 kickoff (`docs/plan/DESIGN_DELTA.md`) map to checks as follows:

| Decision | What changed | Checks |
|---|---|---|
| D02 | Invite links carry a long random token; typed codes stay rate-limited | FUN-02, FUN-03, FUN-16, PRIV-04 |
| D21 | Free weekly recap shows days together only | BIZ-09, BIZ-03 |
| D26 | Widgets (38) are P0 and follow the reveal rule | FUN-04, FUN-15, SCR-38-* |
| D27 | Paywall rows match shipped features | BIZ-03, BIZ-12 |
| D31 | No ratings or reviews; prices only from RevenueCat | BIZ-01, BIZ-06, BIZ-10 |
| D32 | Animated Rive mascot at launch; still pose with reduced motion | UI-07, UI-08, A11Y-03 |
| D33 | Spicy · 18+ pack held at launch | STORE-02, STORE-06, BIZ-03 |

## FUN: functional
| ID | Check | Prio | Evidence |
|---|---|---|---|
| FUN-01 | New user completes onboarding → sign in → solo couple → invite code shown (01–10) | P0 | E2E run + screenshot |
| FUN-02 | Joiner via link (with token, D02) and via typed code, cold and warm start (J2–J6, 12) | P0 | video/screens |
| FUN-03 | Joiner errors: wrong code (J9), full (J10), expired (56), rate limit (`RATE_LIMITED`) after 5 failed **typed** codes in 15 min | P0 | E2E run |
| FUN-04 | **Reveal rule:** the partner's answer is never visible (UI, network response, push, home and lock-screen widget, widget timeline data) before I answer. Release blocker. | P0 | contract test id + proxy capture + widget screenshots |
| FUN-05 | Same question on both phones on the same couple day, across timezones (Maya Berlin, Sam New York) | P0 | scenario run |
| FUN-06 | Hold to reveal → revealed → reactions → thread, live on the other phone within 2 s | P0 | E2E run |
| FUN-07 | Streak +1 when both answer; resets after a missed day; milestones 1/3/7 awarded once | P0 | contract tests |
| FUN-08 | Offline answer queued, sent on reconnect, counts for the day written (55) | P0 | manual, airplane mode |
| FUN-09 | Each push type arrives, routes correctly (cold start included), respects toggles, quiet hours and the 4/day cap | P0 | device + `push_log` |
| FUN-10 | Nudge: once a day, only while the partner hasn't answered | P0 | manual |
| FUN-11 | History heatmap and past question match the data (29, 30) | P0 | scenario history-month |
| FUN-12 | Unpair → both see ended state; history readable; new invite possible (42, 58) | P0 | manual |
| FUN-13 | Delete account completes in-app; the partner keeps their own answers (43) | P0 | manual + DB check |
| FUN-14 | Session survives kill/relaunch and app update (EAS Update) | P0 | manual |
| FUN-15 | **Widgets (38, D26):** home (small, medium) and lock-screen widgets on iOS (WidgetKit) and Android (Glance) show whose turn, streak and next question; tap opens Today. After the partner answers and before I answer, the widget shows at most "Sam answered", never their text, including after a timeline refresh, a reboot and with the app killed. After I answer it never shows answer text on the lock screen. | P0 | screenshots per state + widget data dump (no user text) |
| FUN-16 | **Invite token (D02):** the shared link is `https://[your-domain]/j/BND####?t=<token>`; the token is ≥128 bits (≥22 base64url or 32 hex chars) and differs per invite. A valid link joins even after 5 failed typed codes. The link stops working after 48 h (56) and after the inviter makes a new invite (old token revoked). A typed code without a token is still rate-limited (FUN-03). | P0 | E2E run + contract test id |

## UI: design fidelity
| ID | Check | Prio |
|---|---|---|
| UI-01 | Every P0 screen matches its board in light **and** dark (`screen-requirements.csv` `-UI` rows) | P0 |
| UI-02 | Colours are relative to the viewer: on each phone, the viewer is orange and the partner sky | P0 |
| UI-03 | Gold appears only on premium elements; blush only on hearts, deadlines, errors and destructive actions | P0 |
| UI-04 | No spinner for content; skeletons everywhere (54) | P0 |
| UI-05 | Small (iPhone SE / 360 dp) and large (Pro Max / 412 dp) devices: nothing clipped or overlapping | P0 |
| UI-06 | Haptics per DESIGN.md §6 (reveal, badge, error) | P1 |
| UI-07 | Mascot moods match the state on Today (together, waiting, napping…) | P0 |
| UI-08 | **Animated mascot (D32):** the release build uses the Rive state machine, not the M1 static SVGs; every mood animates and switches on state changes on both platforms; no blank or flashing frame on first render, cold start or dark mode | P0 |

## A11Y: accessibility
| ID | Check | Prio |
|---|---|---|
| A11Y-01 | VoiceOver and TalkBack complete the core loop (answer, reveal, reply) | P0 |
| A11Y-02 | Font scale 200%: questions and answers are never truncated | P0 |
| A11Y-03 | Reduced motion (iOS Reduce Motion, Android Remove animations): mascots show the still pose of the current mood (not blank, not the wrong mood), no confetti, tap instead of hold | P0 |
| A11Y-04 | Touch targets ≥ 44 pt / 48 dp; contrast pairs per DESIGN.md | P0 |

## BIZ: business rules
Run with a free couple, a premium couple and a lapsed couple (`qa/fixtures/personas.json`), using Apple sandbox testers and Google license testers only. "Taps" are counted from the Today tab on a paired, signed-in account with no sheet open; record the path in the report.

| ID | Check | Prio | Evidence |
|---|---|---|---|
| BIZ-01 | **Prices from RevenueCat (D28, D31):** every price, trial length and period on 15, 16, 17, 34, 36 and 57 comes from the RevenueCat offering (`intro`, `default`, `winback`) and matches the store product in the sandbox purchase sheet. No hard-coded amount or currency in the JS bundle or native strings (search the release bundle for `[PRICE]` and currency patterns). Change the price in a sandbox/test offering: the app shows the new price without a new build. With offerings unavailable (airplane mode), the paywall shows an error state, never a fallback price | P0 | screenshots per platform + bundle search output |
| BIZ-02 | One purchase makes both partners premium (J8, 35), and the `partner_premium` push arrives; "one plan covers you both" is true | P0 | two-device screenshots + `push_log` row |
| BIZ-03 | **Paywall matches the build (D27):** every row on the paywall (16, 34), exit-sheet comparison table (17), gift perks (15), napping premium card (28), settings premium row (40) and store listing describes a feature that is **in this build** and works for a premium couple. Specifically: streak saver only if `use_streak_saver` ships (BE-11, MOB-21); "full weekly recap" only if screen 31 ships, and then the free column says "days together" only (D21); packs count excludes the held Spicy pack (D33); nothing from phase 2 (AI report, 44–46). Write the row-by-row mapping in the report | P0 | annotated screenshots + mapping table |
| BIZ-04 | The daily question stays free; the first question of each pack is free (17, 33) | P0 | free-couple run |
| BIZ-05 | Gift and win-back countdowns match server `expires_at` and show once per couple (14, 15, 36) | P1 | screenshots + DB row |
| BIZ-06 | **No fake social proof (D31):** no star ratings, review quotes, testimonials, awards, "#1", or user/couple counts anywhere in the app (onboarding, paywalls, gift, settings, empty states), the store listing, screenshots (60–62) or the feature graphic | P0 | screenshot sweep + listing review |
| BIZ-07 | The in-app review prompt only follows a milestone, never on first session; the monthly check-in never routes to the store | P1 | manual |
| BIZ-08 | Payment failed shows "Nothing was charged" and doesn't grant premium (57) | P0 | sandbox declined purchase |
| BIZ-09 | **Free recap (D21):** for a free couple the weekly recap (31) and its Sunday push show days together only; replies, reactions and the most-loved answer are locked as premium **and absent from the `weekly_recap` response** (proxy capture). A premium couple sees all four. P0 if screen 31 ships, else `n/a` | P0 | proxy capture + screenshots |
| BIZ-10 | **Trial copy is accurate:** the yearly plan shows the trial length, the price after the trial, the billing period and when the first charge happens, all from the RevenueCat intro offer; the trial stepper (16) dates match the sandbox purchase sheet. An account that already used its trial (store-ineligible) sees no trial copy. Auto-renew and cancel-anytime text is present before the buy button (STORE-03) | P0 | screenshots: eligible + ineligible account |
| BIZ-11 | **Restore works:** "Restore" is visible top-left on 16 and on 34 (IOS-05), and in settings (40). On a fresh install with a sandbox purchaser it restores premium for both partners; with no purchase it says nothing was found and grants nothing; it never starts a new purchase | P0 | screen recording per platform |
| BIZ-12 | **Reachable in ≤ 3 taps** from Today, on both platforms, for a free user: (a) a paywall showing the trial copy (BIZ-10); (b) Restore; (c) Delete account (43, STORE-01). For a premium user: (d) Manage subscription (store settings). Record the tap path; more than 3 taps is a fail | P0 | tap path + screen recording |

## IOS: iOS platform
| ID | Check | Prio |
|---|---|---|
| IOS-01 | Sign in with Apple present and HIG-compliant; works with Hide My Email | P0 |
| IOS-02 | Notification permission only after the soft ask; denial handled gracefully | P0 |
| IOS-03 | Universal links open the app (AASA served from `[your-domain]`) | P0 |
| IOS-04 | Privacy manifest present; required-reason APIs declared; no ATT prompt | P0 |
| IOS-05 | Manage subscription opens App Store subscriptions; restore button visible | P0 |
| IOS-06 | Runs on the lowest supported iOS version and the latest | P0 |

## AND: Android platform
| ID | Check | Prio |
|---|---|---|
| AND-01 | System and predictive back on every screen, sheet and modal | P0 |
| AND-02 | `POST_NOTIFICATIONS` runtime permission; a notification channel per push type | P0 |
| AND-03 | App links verified (`assetlinks.json`) | P0 |
| AND-04 | Edge-to-edge without clipped content; gesture and 3-button navigation | P0 |
| AND-05 | Process death restores state and drafts | P0 |
| AND-06 | Target SDK meets the current Play requirement; Play Billing via RevenueCat | P0 |

## PRIV / SEC: privacy and security
| ID | Check | Prio |
|---|---|---|
| PRIV-01 | No answer or message text in PostHog, Sentry or device logs (QA-08 result) | P0 |
| PRIV-02 | App Store privacy labels and Play Data safety match the real data flows | P0 |
| PRIV-03 | Privacy policy and terms URLs are live and linked on sign-in (08) and the paywall | P0 |
| SEC-01 | Security reviewer report for this commit: no open confirmed high/critical findings | P0 |
| SEC-02 | No service role key, test endpoints or dev menu in the release bundle | P0 |
| PRIV-04 | Invite tokens (D02) are stored hashed and never appear in PostHog, Sentry or device logs | P0 |

## STORE: submission
| ID | Check | Prio |
|---|---|---|
| STORE-01 | Account deletion in app, plus the Play web deletion URL | P0 |
| STORE-02 | Age rating questionnaire answered for the launch content **without** the Spicy · 18+ pack (D33); the resulting rating is the lower one the PO chose, on App Store and Play (IARC) | P0 |
| STORE-03 | Subscription disclosure before purchase: price, period, trial, auto-renew, cancel | P0 |
| STORE-04 | Review notes with a demo couple (two accounts, one has answered today) | P0 |
| STORE-05 | Screenshots, feature graphic and copy match this build and the limits (60–62) | P0 |
| STORE-06 | **Spicy pack held (D33):** the launch build and prod data contain no `age_gate = 18+` pack or question. Packs library (32) has no Spicy tile; a deep link to its pack id shows not-found, not the pack; prod `packs`/`questions` have zero 18+ rows; `CONTENT_INCLUDE_AGE_GATED` is unset or false for prod; paywall, listing and screenshots never mention it | P0 |

## HYG: release hygiene
| ID | Check | Prio |
|---|---|---|
| HYG-01 | Version and build numbers incremented; EAS channel matches the profile | P0 |
| HYG-02 | Prod Supabase URL and anon key, prod RevenueCat keys; no `dev` references | P0 |
| HYG-03 | Sentry release with source maps; a test crash symbolicates | P0 |
| HYG-04 | All prod migrations applied; prod functions deployed; RevenueCat prod webhook test event OK | P0 |
| HYG-05 | Content is PO-approved (no `status=placeholder` rows in prod) | P0 |
