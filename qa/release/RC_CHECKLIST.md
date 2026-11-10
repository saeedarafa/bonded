# Release-candidate checklist

**Owner:** release validator. Run every row on **iOS and Android** unless the row says otherwise. Screen-level rows (one per P0/P1 screen) are in `screen-requirements.csv`. This file holds the cross-cutting checks. Method and report format: the `bonded-release-check` skill.

A P0 row that fails, or that has no evidence, makes the build **NO-GO**.

**Where Android rows run:** on the local emulator (AVD `Medium_Phone_API_37.0`, Android 17, Google Play image; `emulator -avd Medium_Phone_API_37.0`, wait for `adb shell getprop sys.boot_completed` = `1`, then `npm run android`). Only these stay blocked until a real device or an EAS build: push delivery (FUN-09, `offer_ending`, `trial_ending`), Apple and Google sign-in (IOS-01), haptics (UI-06), store purchases and restore (BIZ-02, BIZ-08, BIZ-10, BIZ-11, BIZ-18, the buy step of BIZ-13 and BIZ-16), and store checks (AND-03, AND-06, STORE-*). Everything else on Android is run on the emulator, never marked `blocked` for lack of a device.

## Coverage
- **Every P0/P1 screen:** the `-UI`, `-BEH` and `-DATA` rows in `screen-requirements.csv` (generated from `docs/plan/scope-map.json`; never hand-edit) plus UI-01 below. Regenerate with `node scripts/plan/generate.mjs`; `--check` must print `up to date` before a run.
- **Every P0 rule:** the IDs below. Scope decisions from the 2026-11-02 kickoff (`docs/plan/DESIGN_DELTA.md`) map to checks as follows:

| Decision | What changed | Checks |
|---|---|---|
| D02 | Invite links carry a long random token; typed codes stay rate-limited | FUN-02, FUN-03, FUN-16, PRIV-04 |
| D21 | Free weekly recap shows days together only | BIZ-09, BIZ-03 |
| D26 | Widgets (38) are P0 and follow the reveal rule | FUN-04, FUN-15, SCR-38-* |
| D27 | Paywall rows match shipped features (also voice and long answers D46, little things D48) | BIZ-03, BIZ-12, BIZ-15 |
| D31 | No ratings or reviews; prices only from RevenueCat | BIZ-01, BIZ-06, BIZ-10 |
| D32 | Animated Rive mascot at launch; still pose with reduced motion | UI-07, UI-08, A11Y-03 |
| D33 | Spicy · 18+ pack held at launch | STORE-02, STORE-06, BIZ-03 |
| D47 | Widgets 38b (Countdown, Partner answered): no answer text, still mascot pose per state | FUN-04, FUN-15, FUN-20, SCR-38b-* |
| D50 | New onboarding order with T1, N, L, P2 and the P3 soft trial paywall; joiner never sees P3 | FUN-01, FUN-17, FUN-18, FUN-19, BIZ-13, BIZ-14, BIZ-18, UI-09, AND-07 |
| D51 | 17 table lists every shipped Premium feature; no free pack question | BIZ-03, BIZ-04, BIZ-15 |
| D52 | 16 and 34 without trial; 17 trial button only when eligible; day-3 gift 14/15 with a real 12 h countdown; one full-screen offer per day | BIZ-01, BIZ-05, BIZ-10, BIZ-15, BIZ-16, BIZ-17 |
| D53 | 34 = 17 rows without unshipped rows, no trial; 35 lists only shipped features; 36 replaced by the Today gift chip | BIZ-03, BIZ-05, BIZ-16 |

D28 (gift after pairing, win-back 36, offerings `intro`/`winback`) is superseded by D52: any trace of it in the build is a BIZ-05 fail.

**Generated rows that are stale until the scope map catches up (LEAD-13).** `screen-requirements.csv` is generated from `docs/plan/scope-map.json` and `design-handoff/screens.json` and must not be hand-edited. Until those sources carry D50–D53, these checks override the generated rows; a run uses the override, not the CSV text:

| Generated row | CSV says | Use instead |
|---|---|---|
| SCR-14-BEH, SCR-14-DATA | Shown after pairing; eligibility "new couple" | BIZ-05 (day-3 gift on the first 3-day streak badge, replaces 52b for that badge) |
| SCR-15-BEH, SCR-15-DATA | Offering `intro`, real 24 h | BIZ-05 (offering `day3`, real 12 h from first open) |
| SCR-16-DATA | Yearly with 7-day trial | BIZ-16 (16 has no trial; never shown automatically) |
| SCR-17-BEH | Promises the daily question stays free | BIZ-15 (D51 table, trial button only when eligible) |
| SCR-33-BEH, SCR-33-DATA | First question of every pack is free | BIZ-04 (no free pack question, D51) |
| SCR-34-DATA | Offering `default` | BIZ-16 (no trial shown on 34) |
| SCR-36-* | Win-back | n/a: 36 retired (D52/D53); BIZ-05 checks it never appears |
| T1, N, L, P2, P3 | no rows yet | UI-09, FUN-17, FUN-18, FUN-19, BIZ-13, BIZ-14 |

## FUN: functional
| ID | Check | Prio | Evidence |
|---|---|---|---|
| FUN-01 | New user completes onboarding in the D50 order 01 → 05 → 07 → 02 → 03 → 04 → 06 → T1 → N → L → P2 → P3 → sign-in (08) → solo couple → invite code shown (10), on the free plan (P3 closed via 17) and with a sandbox trial started on P3 | P0 | E2E run + screenshot per step |
| FUN-02 | Joiner via link (with token, D02) and via typed code, cold and warm start (J2–J6, 12) | P0 | video/screens |
| FUN-03 | Joiner errors: wrong code (J9), full (J10), expired (56), rate limit (`RATE_LIMITED`) after 5 failed **typed** codes in 15 min | P0 | E2E run |
| FUN-04 | **Reveal rule:** the partner's answer is never visible (UI, network response, push, home and lock-screen widgets 38 and 38b, widget timeline data) before I answer. Release blocker. | P0 | contract test id + proxy capture + widget screenshots |
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
| FUN-17 | **Onboarding order and content (D50):** quiz progress 1/4 on 05 (2×2 stage tiles), 2/4 on 07, 3/4 on 03, 4/4 on 06; 02 shows the version for the stage picked on 05 (Dating / Living together (also the default with no stage) / Engaged or married / Long-distance) and names the partner from 07; 03 asks about the partner by name; 04 shows the revealed-answer cards of 21 with an everyday example question (not the day-1 question); answers from 05, 03, 06 and the names sync after sign-in (questionnaire version 2). A returning user ("I already have an account") skips onboarding (D40). A **joiner arriving by invite link or code never sees T1, N, L, P2 or P3** (D29): check the cold link, warm link and typed-code paths | P0 | screenshots per step + `onboarding_answers` row (no free text) |
| FUN-18 | **T1 day-1 answer (D50, D12):** T1 asks "What did you notice first about <partner>?"; the typed answer stays on the device (survives app kill and relaunch before sign-in), is submitted once after sign-in as the day-1 answer of the solo couple through the answer RPC, and Today shows it locked until the partner answers. The partner never sees it before answering (FUN-04). Exactly one answer row is written, even after a kill during sign-in. The answer text never appears in logs, analytics or crash reports | P0 | E2E run + DB row count + log grep |
| FUN-19 | **N daily moment and L plan (D50):** picking 08:00 / 12:30 / 21:00 / other stores that `ritual_time` (D23) after sign-in; "Turn on reminders" shows the OS permission dialog (iOS; Android 13+ `POST_NOTIFICATIONS`), "Not now" continues with no dialog. L runs about 4 s, lists the stage, goals and time picked, reads "Daily moment set for 21:00" (the chosen time) when reminders were declined, and cannot be skipped into a broken state by back or a kill | P0 | screenshots (allowed + declined) + DB row |
| FUN-20 | **Widgets 38b (D47):** Countdown ("Your turn · <time> · to keep your streak" + "Answer now") while I haven't answered today; Partner answered (lock icon, "<partner> answered · Reply to see theirs.", "Your partner" when the name is unknown) when they have and I haven't. The countdown matches the couple-day deadline; the mascot is a still pose that changes with the state; tap opens Today. **No answer text in the widget, the lock screen or the widget timeline data**, which holds only booleans, the deadline and the streak (FUN-04) | P0 | screenshots per state + widget data dump (no user text) |

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
| UI-09 | **New onboarding screens (D50):** T1, N, L, P2 and P3 match the S01 board in light and dark, on the SE and the Pro Max (and a 360 dp Android emulator skin), and at 200% font scale with nothing clipped; P3's CTA, "$0 today. Cancel anytime in 2 taps", Restore, Terms and Privacy are reachable without hidden content. Interim row until these screens get generated `SCR-` rows | P0 |

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
| BIZ-01 | **Prices from RevenueCat (D28, D31):** every price, per-person price, save %, trial length and period on P3, 15, 16, 17, 34, the Today gift chip, the Settings/Us Premium row and 57 comes from the RevenueCat offerings `default` (yearly with the 7-day trial, monthly without) and `day3` (25% first-year intro on yearly), and matches the store product in the sandbox purchase sheet. No hard-coded amount or currency in the JS bundle or native strings (search the release bundle for `[PRICE]` and currency patterns). Change the price in a sandbox/test offering: the app shows the new price without a new build. With offerings unavailable (airplane mode), the paywall shows an error state, never a fallback price. The build never requests the retired offerings `intro` or `winback` (D52) | P0 | screenshots per platform + bundle search output |
| BIZ-02 | One purchase makes both partners premium (J8, 35), and the `partner_premium` push arrives; "one plan covers you both" is true | P0 | two-device screenshots + `push_log` row |
| BIZ-03 | **Paywall matches the build (D27):** every row and benefit on P3, the paywalls (16, 34), the exit-sheet comparison table (17), the coupon's six features (15), "You're both Premium" (35), the napping premium card (28), the settings premium row (40) and the store listing describes a feature that is **in this build** and works for a premium couple. Specifically: streak saver only if `use_streak_saver` ships (BE-11, MOB-21); "full weekly recap" only if screen 31 ships, and then the free column says "days together" only (D21); packs count excludes the held Spicy pack (D33); "Voice answers and messages" and "Longer answers 500 / 2,000" only if D46 ships (BE-41–43, MOB-54–56); "Hugs, kisses and goodnights" only if D48 ships (MOB-58, MOB-59); "Couple report" never on 34 (D53); nothing from phase 2 (AI report, 44–46). Write the row-by-row mapping in the report | P0 | annotated screenshots + mapping table |
| BIZ-04 | **No free pack questions (D51):** the daily question stays free; a free couple can start **no** pack question: 33 shows "A question from this pack" as a sample to read with no answer field, 32 says "New this week" (never "Free this week") and "Packs come with Premium, for both of you", and calling `start_pack_question` directly as a free couple returns `PREMIUM_REQUIRED` for every pack question (DB, not only the app). A pack question a free couple already started under D43 stays answerable and revealable. A premium couple can start any pack question | P0 | free-couple run + RPC call output + premium run |
| BIZ-05 | **Day-3 gift (D52):** shown once per couple, to both partners, when a free couple that never subscribed and never used an intro offer earns its first 3-day streak badge (14 replaces 52b for that badge; if the streak broke first, the first time they reach 3). 15 shows a **real 12-hour countdown that starts when the gift is first opened** (server `couple_offers` kind `day3` `expires_at`; reopening, relaunching, reinstalling, changing the device clock or opening on the partner's phone never restarts or extends it). Struck yearly price, first-year offer price and per-person monthly price come from the `day3` offering (BIZ-01) and the math is right (first-year price ÷ 12 ÷ 2). "Not now" just closes (no 17 after the gift) and the gold Today chip ("25% off · ends in <hh:mm> · Open") reopens 15; the Settings/Us Premium row shows the same offer. **On expiry the chip and the row offer disappear**, with no extension, second chance, "last chance" screen or re-issued gift. One `offer_ending` push 2 h before the end (quiet hours and D24 cap respected). Old gift-after-pairing and win-back 36 never appear | P0 | screenshots at open, mid-window and after expiry + `couple_offers` row + `push_log` |
| BIZ-06 | **No fake social proof (D31):** no star ratings, review quotes, testimonials, awards, "#1", or user/couple counts anywhere in the app (onboarding incl. P2 and P3, paywalls 16/17/34, gift 14/15, Today chip, settings, empty states), the store listing, screenshots (60–62) or the feature graphic | P0 | screenshot sweep + listing review |
| BIZ-07 | The in-app review prompt only follows a milestone, never on first session; the monthly check-in never routes to the store | P1 | manual |
| BIZ-08 | Payment failed shows "Nothing was charged" and doesn't grant premium (57) | P0 | sandbox declined purchase |
| BIZ-09 | **Free recap (D21):** for a free couple the weekly recap (31) and its Sunday push show days together only; replies, reactions and the most-loved answer are locked as premium **and absent from the `weekly_recap` response** (proxy capture). A premium couple sees all four. P0 if screen 31 ships, else `n/a` | P0 | proxy capture + screenshots |
| BIZ-10 | **Trial copy is accurate (D50, D52):** trial copy appears **only** on P3 and on 17's main button, and only for a trial-eligible person (RevenueCat eligibility). On P3 the yearly plan shows the 7-day trial, the price after the trial, the billing period and when the first charge happens, all from the `default` offering; the Today / Day 5 reminder / Day 7 timeline dates match the sandbox purchase sheet; "$0 today" is true. Monthly reads "No free trial". An account that already used its trial (store-ineligible) sees no trial copy anywhere: 17 reads "Get Premium". Auto-renew and cancel-anytime text is present before the buy button (STORE-03) | P0 | screenshots: eligible + ineligible account |
| BIZ-11 | **Restore works:** "Restore" is visible top-left on 16 and on 34 (IOS-05), and in settings (40). On a fresh install with a sandbox purchaser it restores premium for both partners; with no purchase it says nothing was found and grants nothing; it never starts a new purchase | P0 | screen recording per platform |
| BIZ-12 | **Reachable in ≤ 3 taps** from Today, on both platforms, for a free user: (a) a paywall with prices and subscription terms (16 via a Premium touchpoint, BIZ-16); (b) Restore; (c) Delete account (43, STORE-01). For a premium user: (d) Manage subscription (store settings). Record the tap path; more than 3 taps is a fail | P0 | tap path + screen recording |
| BIZ-13 | **P3 soft paywall (D50):** shown only to the person who starts the couple, after P2 and before sign-in. Headline "Get closer to <partner>, starting tonight", 3 benefits (each a shipped feature, BIZ-03), Yearly pre-selected with "Best value · save [X]%", Monthly "No free trial", CTA "Try 7 days free", "$0 today. Cancel anytime in 2 taps", Restore, Terms, Privacy. **Prices:** every amount and the save % come from the `default` offering (BIZ-01); the per-person monthly price = yearly price ÷ 12 ÷ 2; the yearly total for both = the store's yearly price; save % = 1 − yearly ÷ (12 × monthly) to the nearest whole percent and never overstated. Check in two sandbox storefronts with different currencies. **Close:** × top-left (and Android back, AND-07) opens exit sheet 17 **once**; 17 never opens another paywall; "Continue with free" goes to sign-in (08) on the free plan; P3 never reappears in that install or after sign-in. No ratings, reviews, testimonials or user/couple counts (BIZ-06). A joiner by invite never sees P3 (FUN-17) | P0 | screenshots (eligible, ineligible, two currencies) + price arithmetic in the report |
| BIZ-14 | **P2 "Your plan" claims (D50, LEAD-13):** every figure (86%, 33% or whatever LEAD-13 settles), study name and year (Gottman & Driver; Aron et al. 1997; Gable et al. 2004/2006) and the "proven relationship psychology" line on P2 match the LEAD-13 source note in `design-handoff` word for word; no figure or claim on P2, P3, L or the store listing lacks a source line; no invented numbers. The chart bars match the stated percentages; "3 minutes a day for <names>, at <time>" uses the names from 07 and the time from N. Fail if LEAD-13 has not landed its source note | P0 | screenshot + row-by-row comparison with the source note |
| BIZ-15 | **Exit sheet 17 (D51, D52, D27):** table Free / Premium lists, in order, only rows whose feature is in this build: Daily question Yes / Yes · Question packs — / All · Voice answers and messages — / Yes · Longer answers 500 / 2,000 · Hugs, kisses and goodnights "A few a day" / "Lots more" · Streak saver — / Yes · Weekly recap Basic / Full; a row whose feature missed the build is absent (not greyed). Subtitle "You'll always get one new question a day together. Premium adds everything below." Main button reads "Try Premium free for 7 days" **only** while the person is trial-eligible, else "Get Premium". 17 opens once per paywall close and never chains to another paywall | P0 | screenshots (eligible + ineligible) + row mapping |
| BIZ-16 | **16 and 34 have no trial (D52, D53):** 16 uses the P3 layout without any trial copy (Yearly per-person / Monthly "Flexible, cancel anytime", "<partner> included · Cancel anytime in 2 taps", "Get Premium for both", "Billed yearly. Cancel anytime."); its × opens 17. 34 shows the 17 rows (minus unshipped rows; never "Couple report"), "Save [X]%" and "Get Premium for both", no trial. **16 is never shown automatically** (not after onboarding, pairing, sign-in or a reveal); it opens only from a Premium touchpoint (Voice tab, 19d, little-things limit, streak saver, Settings/Us Premium row, dark 66). The dark variants (66) match | P0 | screenshots light + dark + touchpoint list |
| BIZ-17 | **Offer pacing (D52):** at most **one full-screen offer per person per local day** (P3 and the 14/15 gift; 16 is never automatic, BIZ-16); 14 is never stacked with another full-screen sheet (52b, 25, review prompt) on the same open; a couple that used the P3 trial, ever subscribed or used an intro offer never sees the day-3 gift, chip or `offer_ending` push | P0 | scenario runs (trial-used, subscribed, fresh free couple) + `couple_offers` rows |
| BIZ-18 | **P3 purchase before sign-in (D50 lead decision 1):** a sandbox trial started on P3 under the anonymous RevenueCat id moves to the account at sign-in (`Purchases.logIn`), the couple becomes Premium only after the RevenueCat webhook (never a client flag; check the `subscriptions`/couple row source), and the partner is Premium after pairing (BIZ-02). Killing the app between purchase and sign-in loses nothing. The `trial_ending` push arrives on day 5 of the trial (sandbox accelerated clock; quiet hours and D24 cap respected) | P0 | sandbox run + webhook event id + DB rows |

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
| AND-07 | **Back in the new flows (D50, D52):** system and predictive back through 01 → … → P3 never loses entered names, T1 text or the N choice; back on P3 acts like × (opens 17 once) and never skips to a paid state; back on 17 continues on the free plan without looping to P3; back on 15 acts like "Not now"; back from the Today gift chip's 15 returns to Today. Run on the emulator (AVD `Medium_Phone_API_37.0`) | P0 |

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
| STORE-03 | Subscription disclosure before purchase on P3, 16, 17, 34 and 15: price, period, trial (P3 and an eligible 17 only), first-charge date, intro price duration ("for your first year", 15), auto-renew, cancel | P0 |
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
