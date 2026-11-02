# Release-candidate checklist

**Owner:** release validator. Run every row on **iOS and Android** unless the row says otherwise. Screen-level rows (one per P0/P1 screen) are in `screen-requirements.csv`. This file holds the cross-cutting checks. Method and report format: the `bonded-release-check` skill.

A P0 row that fails, or that has no evidence, makes the build **NO-GO**.

## FUN: functional
| ID | Check | Prio | Evidence |
|---|---|---|---|
| FUN-01 | New user completes onboarding → sign in → solo couple → invite code shown (01–10) | P0 | E2E run + screenshot |
| FUN-02 | Joiner via link and via typed code, cold and warm start (J2–J6, 12) | P0 | video/screens |
| FUN-03 | Joiner errors: wrong code (J9), full (J10), expired (56), rate limit after 5 failures | P0 | E2E run |
| FUN-04 | **Reveal rule:** the partner's answer is never visible (UI, network response, push, widget) before I answer | P0 | contract test id + proxy capture |
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

## A11Y: accessibility
| ID | Check | Prio |
|---|---|---|
| A11Y-01 | VoiceOver and TalkBack complete the core loop (answer, reveal, reply) | P0 |
| A11Y-02 | Font scale 200%: questions and answers are never truncated | P0 |
| A11Y-03 | Reduced motion: still mascots, no confetti, tap instead of hold | P0 |
| A11Y-04 | Touch targets ≥ 44 pt / 48 dp; contrast pairs per DESIGN.md | P0 |

## BIZ: business rules
| ID | Check | Prio |
|---|---|---|
| BIZ-01 | Prices, trial length and period come from RevenueCat and match the store product (no hard-coded `[PRICE]` left) | P0 |
| BIZ-02 | One purchase makes both partners premium (J8, 35); restore works on a fresh install | P0 |
| BIZ-03 | Every paywall/comparison row describes a feature that is **in this build** (D27) | P0 |
| BIZ-04 | The daily question stays free; the first question of each pack is free | P0 |
| BIZ-05 | Gift and win-back countdowns match server `expires_at` and show once per couple (14, 15, 36) | P1 |
| BIZ-06 | No ratings, reviews, awards or user counts anywhere in the app or the listing (D31) | P0 |
| BIZ-07 | The in-app review prompt only follows a milestone, never on first session; the monthly check-in never routes to the store | P1 |
| BIZ-08 | Payment failed shows "Nothing was charged" and doesn't grant premium (57) | P0 |

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

## STORE: submission
| ID | Check | Prio |
|---|---|---|
| STORE-01 | Account deletion in app, plus the Play web deletion URL | P0 |
| STORE-02 | Age rating questionnaire answered for the Spicy · 18+ pack (PO decision) | P0 |
| STORE-03 | Subscription disclosure before purchase: price, period, trial, auto-renew, cancel | P0 |
| STORE-04 | Review notes with a demo couple (two accounts, one has answered today) | P0 |
| STORE-05 | Screenshots, feature graphic and copy match this build and the limits (60–62) | P0 |

## HYG: release hygiene
| ID | Check | Prio |
|---|---|---|
| HYG-01 | Version and build numbers incremented; EAS channel matches the profile | P0 |
| HYG-02 | Prod Supabase URL and anon key, prod RevenueCat keys; no `dev` references | P0 |
| HYG-03 | Sentry release with source maps; a test crash symbolicates | P0 |
| HYG-04 | All prod migrations applied; prod functions deployed; RevenueCat prod webhook test event OK | P0 |
| HYG-05 | Content is PO-approved (no `status=placeholder` rows in prod) | P0 |
