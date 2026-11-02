# Design delta: what the hand-off changes in the contracts

The approved design (`design-handoff/`, 77 screens) goes further than the first contracts (`docs/CONTRACTS.md`, `supabase/migrations/0001_mvp.sql`). Each row below is a **decision** that the backend/data and mobile agents build against.

**Owner:** lead architect. **Status values:**
- `decided`: the default chosen here; build it.
- `needs-PO`: build the default, but the product owner may still change it.
- `needs-security`: the security reviewer must sign off before release.

When a row lands, the lead moves its contract text into `docs/CONTRACTS.md` and marks the row `done (task id)`.

## Pairing and couples

| # | Design says | Current contract | Decision | Status | Tasks |
|---|---|---|---|---|---|
| D01 | Code is `BND·4827`: a fixed "BND" prefix plus 4 digits. Valid 48 h. (10, 56) | 6 characters from a 32-letter alphabet, 7 days | Store 4 digits; show and accept `BND` as a prefix (case and separators ignored). Unique among **unexpired, unused** invites. 48 h expiry. One active invite per inviter; a new one revokes the old one. | decided | BE-04 |
| D02 | A 4-digit code can be guessed (10,000 values) and leads into a stranger's couple, where the inviter's day-1 answer is revealed. | — | `accept_invite` and `invite_preview`: at most **5 failed attempts per user per 15 min**, and a global cap of failed attempts per hour that triggers an alert. Error `RATE_LIMITED`. The inviter gets a "Sam joined" push and can unpair. Option the PO can pick later: a long random token in the invite link (`/j/BND4827?t=…`) that skips the limit. | needs-security | BE-04, SEC-01 |
| D03 | The inviter answers day 1 **before** the partner joins (11). Onboarding sets stage, goals, names and dates before pairing. | A couple exists only after `accept_invite`. | A user creates a **solo couple** (1 member) at the end of onboarding: `create_couple(stage, goals, partner_name)`. `get_daily_question()` works for a 1-member couple. Joining = joining the inviter's couple. | decided | BE-03 |
| D04 | A joiner who tapped "Start my own" can still join later. (J9, J10) | `ALREADY_PAIRED` if the caller is in any couple. | `accept_invite` is allowed when the caller's own couple has only them. That solo couple is deleted, along with any solo answers. `ALREADY_PAIRED` only when the caller's couple has 2 members. | decided | BE-04 |
| D05 | Errors: wrong code (J9), couple full (J10), expired (56). | `INVALID_CODE` covered all of them. | Codes: `INVALID_CODE`, `INVITE_EXPIRED`, `COUPLE_FULL`, `OWN_CODE`, `ALREADY_PAIRED`, `RATE_LIMITED`. | decided | BE-02, BE-04 |
| D06 | J2 shows the inviter's name and avatar **before** the joiner signs in. | No anonymous access. | `invite_preview(p_code)` is callable by `anon`. It returns only the inviter's first name, avatar URL, whether they have answered today, and the expiry. Rate-limited as in D02. | needs-security | BE-04 |
| D07 | Deferred deep link "survives install" (J2). | Custom scheme only. | **P0:** universal and app links on `https://[your-domain]/j/{code}` (AASA and assetlinks on a static site), store fallback, and manual code entry (J3/12). **P1:** deferred link (Android Install Referrer; iOS clipboard opt-in or a link service). | needs-PO | MOB-08, LEAD-04 |
| D08 | Unpair keeps history readable for **30 days**, with a PDF export (42, 58). | `unpair()` deletes the couple (cascade). | `couples.status` is `active` or `ended`, plus `ended_at`. Membership gets `left_at`. A user has at most one **active** membership but can read ended couples for 30 days. pg_cron purges ended couples after 30 days. PDF export is built on the client (P1). | decided | BE-09 |
| D09 | Deleting an account: "Sam keeps their own answers. Yours disappear." (43) | Cascade, and the couple is deleted. | Cascade deletes the user's profile, answers, messages and reactions. The couple becomes `ended`. The partner sees screen 58 and keeps their own answers for 30 days. | decided | BE-09, BE-16 |
| D10 | Stage, goals, names and key dates (05–07, 47). The joiner inherits them (J5). | Only `relationship_start_date`. | `couples.stage` (dating, living_together, engaged_married, long_distance), `couples.goals text[]`, `pair_invites.partner_name`. New `key_dates` table (kind: together_since, anniversary, birthday; `user_id` for birthdays; `remind_week_before`). | decided | BE-03 |

## Daily loop

| # | Design says | Current contract | Decision | Status | Tasks |
|---|---|---|---|---|---|
| D11 | Answer counter /500 (19). | 1–2000 | Answers 1–500 characters. Thread messages stay at 1–2000. | decided | BE-05 |
| D12 | The first question is special: "What did you notice first about me?" (11, J7) | Random daily question | Day 1 of every couple uses the special question `first_day`. | decided | BE-05 |
| D13 | Hold to reveal (20) only after both have answered. | A partner's answer is visible once I've answered. | Same data rule: the partner's row exists only once they've answered, and RLS shows it only after I've answered. Hold to reveal is UI only. Keep the reveal-rule tests as release blockers. | decided | — |
| D14 | 4 reactions: Love, Laugh, Wow, Spark (21). | Any emoji up to 16 characters | `reactions.kind` is `love`, `laugh`, `wow` or `spark`. One per user per target; changing it is an upsert. | decided | BE-05 |
| D15 | Typing indicator (22). | — | Realtime **presence/broadcast** on `couple:{couple_id}`, event `typing`. No database writes. | decided | MOB-12 |
| D16 | Nudge, at most once a day (23). | — | `send_nudge()` RPC: only while the partner hasn't answered today's question; at most 1 per sender per local day; enqueues a `nudge` push. Error `NUDGE_LIMIT`. | decided | BE-10 |
| D17 | Offline: "Answers count for the day you wrote them" (55). | The streak uses the time of the server insert. | Answers carry `client_written_at`. An answer to a daily question for local day D still counts for D if `client_written_at` falls on D and it arrives before the end of D+1. Later answers save but don't count toward the streak. | decided | BE-06 |
| D18 | Streak saver: premium; protects one missed day a month for both partners (28). | — | `use_streak_saver()`: the couple is premium, exactly one day was missed, and no use this calendar month. Errors `PREMIUM_REQUIRED` and `SAVER_UNAVAILABLE`. | decided | BE-11 |
| D19 | Badges at 1, 3, 7, 14, 21, 30, 50, 100 and 365 days, plus achievement badges (52, 52b). | — | `badge_awards` written by a trigger when the streak advances. The catalogue is in `supabase/content/badges.csv`. Achievement badges (Long talk, Hearts given, and so on) are P1. | decided | BE-12 |
| D20 | Anniversary or birthday replaces the daily question (51). | — | `get_daily_question()` picks the matching special question when a key date matches today. The streak counts as usual. | decided (P2) | BE-13 |
| D21 | Weekly recap every Sunday (31). Basic for free, full for premium. | — | `weekly_recap(p_week_start)` RPC returns days together, replies, reactions and the most-loved answer (the most reactions, ties go to the latest). Free tier: counts only. Plus a Sunday push. | needs-PO (what "basic" means) | BE-14 |
| D22 | Monthly check-in and private feedback (26, 27). | — | `feedback` table: insert only by the owner, read only by the service role. Fields: kind (check_in or feedback), score, tags, body, app_version. | decided | BE-15 |

## Notifications

| # | Design says | Decision | Status | Tasks |
|---|---|---|---|---|
| D23 | 5 push types, each with its own toggle (39, 41): ritual reminder, partner answered, replies and reactions (grouped within 5 min), last call (22:30 if a streak of 3+ days is at risk), nudge. Plus "tips and news" (opt-in). | `notification_prefs` table: `ritual_time`, one boolean per type, `quiet_start` 23:00, `quiet_end` 07:00. It replaces `profiles.reminder_time`. Copy and caps live in `supabase/content/notifications.json`. | decided | BE-07, BE-08 |
| D24 | At most 4 a day per person; quiet hours. | `push_log (user_id, type, local_date, sent_at)`. The `notify` function checks the daily cap, per-type caps, quiet hours and the 5-minute grouping before sending. In-app state still updates. | decided | BE-08 |
| D25 | Partner joined, both premium, and "celebrate your partner" pushes (13, 35, 50). | Push types `partner_joined` and `partner_premium` (P0), `celebration` (P2). | decided | BE-08 |
| D26 | Home and lock-screen widgets (38). | P2: needs native targets (WidgetKit, Glance) through an Expo config plugin. | needs-PO | MOB-30 |

## Money

| # | Design says | Decision | Status | Tasks |
|---|---|---|---|---|
| D27 | The paywall lists **streak saver** and **full weekly recap** as premium features. | Paywall rows must match shipped features. Any feature not shipped at launch is removed from the comparison table (release-blocking check REL-BIZ-03). | decided | REL-02 |
| D28 | Gift after pairing: 7 days free, with a **real** 24 h countdown, once per couple (14, 15). Win-back on day 3, shown once (36). | `couple_offers (couple_id, kind, first_shown_at, expires_at)`. `get_offer(kind)` is idempotent, and the server decides eligibility and expiry. RevenueCat offerings: `intro`, `default`, `winback`. Prices always come from RevenueCat (never hard-coded). | decided (gift P1, win-back P2) | BE-17, MOB-22 |
| D29 | The joiner sees "on Maya's plan" (J8); both get the "both premium" screen (35). | Already supported: `is_couple_premium`. Add the `partner_premium` push. | decided | BE-08 |

## Naming and placeholders

| # | Decision | Status |
|---|---|---|
| D30 | The app is **Bonded**. URL scheme `bonded://`, bundle id placeholder `app.bonded.mobile`, invite link domain `[your-domain]` until it's bought. These replace `couplesapp://` and `com.example.couples`. | needs-PO (bundle id and domain) |
| D31 | All prices are `[PRICE]` placeholders filled from RevenueCat offerings. No ratings, reviews or awards anywhere. | decided |
| D32 | Mascot animation: Rive (one state machine) is preferred over Lottie. Static SVGs ship first; animation is P1. | needs-PO |
| D33 | The "Spicy · 18+" pack (32) affects the store age rating. Default: keep it, with flirty and never explicit content, and answer the rating questionnaire honestly (likely 17+ on iOS, Mature on Play). Alternative: hold the pack until after launch to keep a lower rating. | needs-PO |
| D34 | Content: all questions, packs, badges and notification copy in `supabase/content/` are original **placeholders** (`status=placeholder`). The PO approves them before launch (HYG-05). | needs-PO |

## Open questions for the product owner
1. D02: put a long token in invite links (more secure), or keep the plain code?
2. D07: is a paid deferred deep link service acceptable, or is the free route (Android referrer, plus clipboard on iOS) enough?
3. D21: what does the free "basic" weekly recap show?
4. D26, D32: are widgets and animated mascots in or out of the launch scope?
5. D30: the final bundle id and invite domain.
6. D33: launch with the Spicy · 18+ pack (higher age rating), or hold it?
7. D34: who writes and approves the final question content, and by when?
