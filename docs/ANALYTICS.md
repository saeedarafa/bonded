# Analytics: PostHog events, funnels and privacy rules

**Owner:** lead architect. Mobile implements the events (MOB-24, MOB-24b), backend handles deletion (BE-51), QA checks privacy (QA-08). The decision behind this file is D54 in [plan/DESIGN_DELTA.md](plan/DESIGN_DELTA.md). If you add, rename or remove an event, change this file in the same PR and add a line to the change log at the bottom.

**Why we collect analytics:** so the founder can see where people drop off and whether couples come back every day. We count what people *do*. We never record what they *say*.

## 1. Privacy rules (D54, release blockers)

1. **Never send content.** No answer text, thread messages, voice recordings or their file paths, names (yours, your partner's, the couple's), email addresses, key-date titles, feedback text, invite codes, invite tokens or links, push tokens, or any other free text. Properties hold only ids from a fixed list (screen ids, option ids, pack ids, gesture kinds), numbers, booleans and dates. `track()` takes a typed property object per event, so a free-text field can't compile.
2. **Pseudonymous identity.** Before sign-in PostHog's anonymous id is used. After sign-in we call `identify(<Supabase user uuid>)`. Person properties never include an email or a name. Couples use `couple_id` (uuid) as a plain event property. PostHog group analytics is not needed.
3. **No autocapture, no session replay, no surveys, no heatmaps.** We only send the events listed below and screen views of the route name (`app/(tabs)/today/answer`), never parameters or text from the screen. Screen recording would capture answers on screen, so replay stays off for good.
4. **No cross-app tracking, so no ATT prompt.** We don't collect the IDFA or the Android advertising id. Nothing goes to ad networks or data brokers.
5. **EU hosting** (`https://eu.i.posthog.com`). In the PostHog project settings: "Discard client IP data" on. Country comes from PostHog GeoIP before the IP is discarded. Nothing finer than country is kept.
6. **People can switch it off.** Settings (Us) gets a row "Share usage data" (default on), with the explanation "Anonymous counts of what you tap, never what you write. Helps us improve Bonded." Switching it off calls `optOut()` straight away and is stored on the device. Signing out resets the PostHog id (`reset()`). It is not on a design board (like D42): mobile uses the existing settings toggle row.
7. **Deleting the account deletes the analytics.** `delete-account` asks PostHog to delete the person and their events (BE-51).
8. **Store labels and the privacy policy say so** (PRIV-02, PRIV-03). App Store: "Usage Data → Product Interaction" and "Diagnostics" (Sentry), linked to the user, used for analytics and app functionality, **not** used for tracking. Play Data safety: "App activity → App interactions" and "App info and performance", collected, not shared, can be deleted on request. The privacy policy names PostHog (EU) and Sentry as processors.
9. **Turned off outside real builds.** No key → no-op (dev and CI). E2E and test accounts set `is_test_account: true` so they can be filtered out.

## 2. Properties on every event

| Property | Example | Notes |
|---|---|---|
| `app_version`, `build`, `platform`, `os_version` | `1.0.0`, `42`, `ios` | PostHog adds most of these |
| `signed_in` | `true` | |
| `couple_state` | `none` \| `solo` \| `paired` \| `ended` | |
| `couple_id` | uuid | only when there's a couple |
| `is_premium` | `false` | couple's server-side state (never a client flag) |
| `days_since_signup`, `days_since_paired` | `3`, `1` | whole days |
| `streak` | `5` | current couple streak |
| `is_test_account` | `false` | |

**Person properties** (set with `identify` / `$set`): `signup_method` (`apple`\|`google`\|`email`), `signed_up_at`, `stage`, `goals` (option ids), `ritual_time` (`08:00`\|`12:30`\|`21:00`\|`other`), `push_enabled`, `paired_at`, `is_premium`, `plan` (`yearly`\|`monthly`\|`none`), `role` (`starter`\|`joiner`).

## 3. Events

Names are `object_action`, past tense, snake_case. Option ids and screen ids are the ones in `design-handoff/screens.json` and the onboarding store.

### 3.1 App and session
| Event | When | Properties |
|---|---|---|
| `app_opened` | cold start or back after 30 min in the background (the same session rule as the review prompt) | `source`: `icon`\|`push`\|`widget`\|`link`, `push_type` (if push) |
| `screen_viewed` | each route change | `screen` (route name), `screen_id` (board id, e.g. `21`) |
| `deep_link_opened` | `bonded://` or invite link | `kind`: `invite`\|`auth`\|`push`\|`widget`\|`other`, `valid` |
| `analytics_opted_out` | right before `optOut()` | (the last event this person sends) |

### 3.2 Onboarding funnel (D50; starter only)
| Event | When | Properties |
|---|---|---|
| `onboarding_started` | 01 Welcome shown for the first time | `resumed` (MOB-61b resume) |
| `onboarding_step_viewed` | each onboarding screen | `step`: `01`\|`05`\|`07`\|`02`\|`03`\|`04`\|`06`\|`T1`\|`N`\|`L`\|`P2`\|`P3`, `step_index` |
| `onboarding_step_completed` | the user moves on | `step`, option ids only: `stage` (05), `last_learned` (03), `goals` (06), `ritual_time` (N), `names_given` (07, boolean) |
| `onboarding_back_pressed` | back on any step | `step` |
| `first_answer_written` | T1 submitted on the device | `length_bucket`: `<50`\|`50-150`\|`150+` (length only, never text) |
| `reminder_permission_requested` | the OS prompt shows (N, 09, J-reminders) | `screen` |
| `reminder_permission_result` | after the OS prompt | `granted`, `screen` |
| `reminder_soft_ask_declined` | "Not now" | `screen` |
| `plan_viewed` | P2 shown | |
| `onboarding_completed` | sign-in done after P3 | `duration_s`, `purchased_on_p3` |

### 3.3 Sign-in and account
| Event | When | Properties |
|---|---|---|
| `sign_in_viewed` | 08 or J4 | `context`: `onboarding`\|`join`\|`returning` |
| `sign_in_started` | a method is tapped | `method` |
| `email_code_requested` | code sent | `resend` |
| `sign_in_failed` | error | `method`, `error_code` (from `src/lib/errors.ts`, never the message) |
| `signed_up` | first sign-in of a new account | `method` |
| `signed_in` | returning account | `method` |
| `signed_out` | | |
| `onboarding_synced` | the device answers (D38) and T1 reached the server | `t1_saved` |
| `account_delete_started` | 43 opened | |
| `account_deleted` | after the server confirms, sent **after** `reset()` so it is anonymous (BE-51: PostHog deletes only events captured before the server's delete request; an event under the deleted uuid would survive and re-create the person; lead 2026-11-11) | |

### 3.4 Pairing funnel
Starter: `pair_invite_viewed` → `pair_invite_shared` → (partner joins) → `paired`.
Joiner: `invite_link_opened` → `join_started` → `signed_up` → `join_completed` → `paired`.

| Event | When | Properties |
|---|---|---|
| `solo_couple_created` | SetupBond created the solo couple | |
| `pair_invite_viewed` | invite screen shown | |
| `pair_invite_created` | new link/code made | `kind`: `link`\|`code` |
| `pair_invite_shared` | share sheet finished, or code copied | `channel`: `share_sheet`\|`copy_link`\|`copy_code` (no app name) |
| `pair_waiting_viewed` | waiting screen | `hours_since_invite` |
| `invite_link_opened` | joiner opens `/j/{code}` | `signed_in`, `valid` |
| `join_code_entered` | typed code submitted | `result`: `ok`\|`invalid`\|`rate_limited`\|`full` |
| `join_started` | J1 welcome | `via`: `link`\|`code` |
| `join_request_pending` | typed code needs the inviter's OK (D02) | |
| `join_request_answered` | inviter approves or declines | `approved` |
| `join_archive_confirm_shown` | D37 sheet (solo user joining) | |
| `join_completed` | joiner is in the couple | `via`, `archived_solo` |
| `paired` | both sides, when the couple becomes paired | `role`: `starter`\|`joiner`, `hours_from_signup` |
| `partner_left_viewed` | partner unpaired (D08) | |
| `unpaired` | this user ends the couple | `days_paired` |

### 3.5 Daily loop (the core)
| Event | When | Properties |
|---|---|---|
| `daily_question_viewed` | Today shows the day's question | `question_id`, `pack_id` (null for daily), `partner_answered`, `i_answered`, `hours_after_ritual` |
| `answer_started` | first keystroke or recording starts | `question_id`, `kind`: `text`\|`voice` |
| `answer_draft_restored` | an MMKV draft was restored | |
| `answer_submitted` | the server accepted it | `question_id`, `pack_id`, `kind`, `length_bucket` or `duration_bucket` (`<15s`\|`15-45s`\|`45s+`), `partner_answered` (**true = this answer completes a both-answered day**), `edited`, `offline_queued` |
| `answer_queued_offline` | outbox held it ("Waiting to send") | |
| `answer_edited` | | `question_id` |
| `answer_locked_viewed` | waiting for the partner | `question_id` |
| `reveal_started` | hold-to-reveal begins | `question_id` |
| `answer_revealed` | the reveal finished | `question_id`, `pack_id`, `hours_since_both_answered` |
| `reaction_added` | | `emoji` (the emoji itself, from the fixed picker), `target`: `answer`\|`message` |
| `thread_opened` | | `question_id`, `unread_count` |
| `thread_message_sent` | | `question_id`, `kind`: `text`\|`voice`, `length_bucket`/`duration_bucket` |
| `voice_recording_started` / `voice_recording_finished` / `voice_recording_discarded` | | `context`: `answer`\|`message`, `duration_bucket` |
| `voice_played` | | `context`, `own` |
| `question_ended_viewed` | ended/archive view (D08 ended couples) | |

### 3.6 Streaks, badges, milestones, recap
| Event | When | Properties |
|---|---|---|
| `streak_extended` | the couple's streak went up today | `streak` |
| `streak_broken` | first open after the streak reset | `previous_streak` |
| `streak_saver_viewed` / `streak_saver_used` | 28 | `streak` |
| `badge_earned` | badge shown for the first time | `badge_id` |
| `badges_viewed` | | `earned_count` |
| `milestone_viewed` | 25 | `n` |
| `recap_viewed` | 31 | `week`, `full` (premium) |
| `review_prompt_requested` | we asked the OS (the OS decides if it shows) | |

### 3.7 History, packs, little things, key dates, widgets
| Event | When | Properties |
|---|---|---|
| `history_viewed` | | `items` |
| `history_item_opened` | | `question_id`, `days_ago` |
| `packs_viewed` | | |
| `pack_opened` | | `pack_id`, `locked` |
| `pack_question_started` | | `pack_id`, `question_id` |
| `pack_question_blocked` | `PREMIUM_REQUIRED` | `pack_id` |
| `little_thing_sent` | | `kind`: `hug`\|`kiss`\|`goodnight`\|`good_morning`\|`miss_you`, `amount` |
| `little_thing_undone` | | `kind` |
| `little_thing_received_viewed` | the partner's gesture played on Today | `kind` |
| `little_thing_limit_hit` | free limit reached | `kind` |
| `key_date_added` / `key_date_removed` | | `type` (option id), never the title or date |
| `widget_tapped` | app opened from a widget | `widget`: `today`\|`countdown`\|`partner_answered` |
| `feedback_opened` / `feedback_sent` | 27 | `rating` (option id if any), never the text |
| `check_in_answered` | 26 monthly check-in | option ids only |

### 3.8 Notifications
| Event | When | Properties |
|---|---|---|
| `push_opened` | a push was tapped | `type`: the push `type` the server sent (`ritual_reminder`, `partner_answered`, `thread_activity`, `last_call`, `little_thing`, `partner_joined`, `partner_premium`, `nudge`, `trial_ending`, `offer_ending`, …), `minutes_since_sent` |
| `push_setting_changed` | 39/41 toggles | `type`, `enabled` |
| `ritual_time_changed` | | `ritual_time` |
| `push_permission_changed` | detected on app open (the user changed it in OS settings) | `granted` |

### 3.9 Money funnel
P3 path (D58: `paywall_viewed(P3)` carries `goal_keys`, the goal keys whose feeling lines showed, never text; D57: the first × opens the exit offer instead of 17): `paywall_viewed(P3)` → `paywall_plan_selected` → `purchase_started` → `trial_started` / `subscribed`, or `paywall_closed` → `exit_sheet_viewed` → `continued_free`.

| Event | When | Properties |
|---|---|---|
| `paywall_viewed` | 16, 17, 34, P3, J8 | `paywall`: `P3`\|`16`\|`17`\|`34`\|`J8`\|`15` (`15` = the day-3 gift coupon: purchase events only, its view is `gift_offer_viewed`), `trigger`: `onboarding`\|`voice`\|`long_answer`\|`little_things_limit`\|`streak_saver`\|`settings`\|`pack`\|`recap`\|`dark`\|`gift`\|`history` (D55 locked day), `offering` (RevenueCat id), `trial_eligible` |
| `paywall_plan_selected` | | `paywall`, `product`: `yearly_trial`\|`monthly` |
| `paywall_closed` | × or back | `paywall` |
| `exit_sheet_viewed` | 17 after closing P3 | |
| `continued_free` | "Continue with free" | `paywall` |
| `purchase_started` | | `paywall`, `product`, `offering` |
| `purchase_cancelled` | user cancelled the store sheet | `paywall`, `product` |
| `purchase_failed` | | `paywall`, `product`, `error_code` |
| `purchase_completed` | the store returned success (server confirms later) | `paywall`, `product`, `is_trial`, `before_sign_in` |
| `premium_confirmed` | `usePremium` flips to true from the server | `seconds_after_purchase` |
| `restore_tapped` / `restore_completed` | | `found` |
| `gift_offer_viewed` / `gift_offer_claimed` / `gift_offer_dismissed` | day-3 gift 14/15 (D52) | `offer_kind` |
| `exit_offer_viewed` / `exit_offer_claimed` / `exit_offer_dismissed` | D57 exit offer (first × on P3/16; Manage subscription offer screen) | `trigger`: `paywall_close`\|`cancel`, `paywall`: `P3`\|`16` (paywall_close only) |
| `cancel_continued` | "Continue to cancel" opened the store page (D57) | `store` |
| `both_premium_viewed` | 35 | |

**Prices are not sent from the app.** Revenue, renewals, cancellations, refunds and billing problems come from RevenueCat's own PostHog integration, server to server (ACCOUNTS item 10b). It uses the same id (`app_user_id` = Supabase uuid), so it lands on the same person. Events from the app above show intent; RevenueCat is the source of truth for money.

## 4. Funnels and dashboards to build in PostHog

1. **Onboarding:** `onboarding_started` → each `onboarding_step_viewed` (01…P3) → `signed_up` → `onboarding_synced`. Shows the screen where people leave.
2. **Activation (pair rate):** `signed_up` → `pair_invite_shared` → `paired` (starters), 7-day window. **Key number 1.**
3. **Joiner:** `invite_link_opened` → `join_started` → `signed_up` → `join_completed`.
4. **First reveal:** `paired` → both `answer_submitted` → `answer_revealed` → `thread_message_sent`, 48 h window.
5. **Both-answered rate:** `answer_submitted where partner_answered = true` per couple-day ÷ paired couple-days. **Key number 2.**
6. **Trial:** `paywall_viewed` → `purchase_started` → `purchase_completed` → `premium_confirmed`, split by `paywall` and `trigger`. RevenueCat events add trial → paid conversion.
7. **Retention:** weekly retention on `answer_submitted` (people who come back to answer), split by `couple_state`.
8. **Notifications:** `push_opened` by `type`, and `daily_question_viewed.hours_after_ritual`.
9. **Lifecycle:** DAU/WAU of `app_opened`, active couples, `streak` distribution, `unpaired` and `account_deleted` counts.

Exclude `is_test_account = true` from every insight (a PostHog project filter).

## Change log
- 2026-11-11 (lead): first version, D54. Replaces the short list in ARCHITECTURE §8.
- 2026-11-11 (lead): `account_deleted` is sent after `reset()` (anonymous), so BE-51's PostHog deletion leaves nothing under the deleted uuid. MOB-24 readings accepted: `check_in_answered.score` 1–5, `recap_viewed.week` = week-start date, `feedback_sent.rating` = the 27 tag id, `paywall_viewed.offering`/`trial_eligible` optional, `couple_state: 'ended'` not sent yet.
- 2026-11-12 (lead, MOB-24c review): `paywall_viewed.trigger` gains `history` (16 from a locked History day, D55); `paywall` gains `15` for the gift coupon's purchase events. `pack_id` on daily-loop events = the first pack containing the question. `answer_edited` stays in the catalogue but does not fire today (no edit after lock-in).
- 2026-11-12 (lead, MOB-24d review): mobile's conservative readings accepted: `feedback_sent.rating` only when exactly one tag is picked; `streak_saver_viewed.streak` = current streak (0 while napping); `paired` once per phone, only within 24 h of `paired_at` (older couples not back-filled); `invite_link_opened.valid` = well-formed code + token (no server check); `join_started` from J2 (link) or J3 (code) only, not 12; `reminder_permission_*` also from 41 "Turn on" with `screen: '41'`; `key_date_added` also from the onboarding 47 setup; person property `push_enabled` = OS permission granted; `onboarding_synced` only when answers reach the server during setup; `streak_extended` also after a saver restore. Not wired yet (no screen): `key_date_removed` (48–51), `widget_tapped` (MOB-30).
- 2026-11-12 (lead, D57/D58): new `exit_offer_viewed`/`exit_offer_claimed`/`exit_offer_dismissed` (`trigger`, `paywall`) and `cancel_continued` (`store`); `paywall_viewed(P3)` gains `goal_keys` (keys only). MOB-75/MOB-76 send them.
