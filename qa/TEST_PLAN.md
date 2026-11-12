# Test plan

**Owner:** QA automation engineer. The method is in the `bonded-test-automation` skill; this file tracks **what** is covered.
Last updated: 2026-11-02 (QA-01, kickoff decisions D02 token, D26, D32, D33 in `docs/plan/DESIGN_DELTA.md`).

## Release blockers (must have a passing automated test at every merge)
1. Reveal rule: a partner's answer is invisible until I answer: select, RPC, realtime, push **and widgets** (D26: home and lock-screen widgets never show a partner answer I may not see yet).
2. Couple isolation: another couple's user never reads or writes our rows.
3. Same daily question for both partners on the couple's local day; one row under concurrency.
4. Pairing errors: `INVALID_CODE`, `INVITE_EXPIRED`, `COUPLE_FULL`, `OWN_CODE`, `ALREADY_PAIRED`, `RATE_LIMITED`; the D02 link token skips the failed-attempt limit only when valid.
5. Premium: either partner's entitlement unlocks packs for both; `entitlements` is not writable by clients.
6. Delete account removes the user's content and leaves the partner's.
7. No user text in analytics, Sentry or logs.
8. History lock (D55, BE-55, QA-37): a free couple never gets the content of a day older than couple-local yesterday (answers own and partner, voice objects, thread messages, reactions; select, embedded select, Storage and Realtime); writes there `PREMIUM_REQUIRED` (answers on a past daily day: `DAY_ENDED`, D56). Suite `qa/contract/premium-history.test.ts`, DB level `supabase/tests/premium-history.test.mjs`.

## Decision tests (kickoff 2026-11-02)
Each decision gets a named test in the layer listed. Until the feature lands, the test is committed as `test.todo('… (TASK)')` or a skipped Maestro flow, so the gap stays visible. Exact error codes follow CONTRACTS §2 once BE-04 records them.

### D02: invite link token (BE-04, SEC-01, MOB-08)
Invite links are `/j/BND4827?t=<token>`: ≥128-bit token, stored hashed, same 48 h expiry, revoked with the invite. Typed codes stay rate-limited (5 failed attempts per user per 15 min, plus a global hourly cap).
| Test | Layer | Expected |
|---|---|---|
| Valid code + valid token, after the user already has 5 failed attempts in the window | DB + contract | Accepted; no `RATE_LIMITED` |
| A valid-token accept never counts as a failed attempt | DB | Failed-attempt counter unchanged |
| Typed code, 6th failed attempt in 15 min | DB + contract | `RATE_LIMITED`; the 5 earlier ones were `INVALID_CODE` |
| Invalid token (random, another invite's token, truncated) with a valid code | DB + contract | Treated as a typed code: never skips the limit; `RATE_LIMITED` once the user has 5 failures |
| Invalid code with any token | DB + contract | `INVALID_CODE`, counted; `RATE_LIMITED` after 5 |
| Token of an expired (48 h, `p_now` pinned) or revoked invite (inviter made a new one) | DB + contract | Rejected with the CONTRACTS code; does not skip the limit |
| Window rolls over: 15 min after the first failure (`p_now`) | DB | Attempts allowed again |
| Global hourly cap of failed attempts reached | DB | Alert path fires (log row or function call), no user text |
| `invite_preview` as `anon` obeys the same rules | contract | Valid token previews; invalid token or code counts toward the limit |

### D02: typed codes need the inviter's approval (BE-26, SEC-04, QA-10)
A typed code without a token returns `{status:'pending', request_id, expires_at}` and pairs nobody until the inviter calls `approve_join`; a valid link token pairs at once. Contract: `qa/contract/join-requests.test.ts`; the pairing helper (`pair()`) uses typed code + approval by default and the link for one fixture couple.
| Test | Layer | Expected |
|---|---|---|
| Typed code, no approval | DB + contract | Pending object; requester not a member; invite unused; not counted |
| Inviter approves | DB + contract | Couple-id string; requester in the inviter's couple (inherits stage); request `approved`; re-approve `JOIN_REQUEST_EXPIRED`; retry `ALREADY_PAIRED` |
| Inviter declines | DB + contract | `{status:'declined', request_id}`; not paired; counted once; typed re-request on that invite `JOIN_REQUEST_FORBIDDEN` until it expires; valid link and a fresh invite still work |
| Retry while pending (any code format, pinned clock +5 min) | contract | Same `request_id` and `expires_at`; one row |
| Request expiry = min(15 min, invite expiry); at the boundary (pinned) | DB + contract | `JOIN_REQUEST_EXPIRED` as 400 body, counted once; 1 s before approves; re-request is a new id; slot reclaimable |
| 4th live requester on one invite | DB + contract | `RATE_LIMITED` 400 body, not counted; pending retries and a valid link bypass the cap; decline/expiry frees a slot |
| Approve/decline by requester, outsider or another inviter | DB + contract | `JOIN_REQUEST_FORBIDDEN`; anon 42501; unknown id `JOIN_REQUEST_EXPIRED` |
| Invite revoked after the request | contract | Approve `JOIN_REQUEST_EXPIRED`, not counted |
| `pending_join_requests()` | DB + contract | Inviter only: `{request_id, requester_name, expires_at}`, trimmed first name ≤30 chars, no email/ids; empty for everyone else and for decided/expired/revoked |
| `join_requests` RLS + Realtime | contract | Requester and inviter read their row; others nothing; no client writes; table in `supabase_realtime` |
| Token is stored hashed | DB | No column in `invites` equals the plaintext token |
| Deep link `https://…/j/BND4827?t=…` cold start | E2E (`pairing-joiner.yaml`), `qa/fixtures/deeplinks.json` | Lands on J3 with the code prefilled; accept succeeds |

### D26: widgets are in launch (MOB-30)
| Test | Layer | Expected |
|---|---|---|
| Widget data provider, scenario "partner answered, I haven't" | component (MOB-30 Jest) + contract on the data it reads | Waiting state; no partner answer text, length or preview |
| Same after I answer | component + E2E | Revealed state |
| Widget snapshot in the shared app-group / Glance store | E2E (device file check) | No partner answer before I answered |
| Push and background refresh don't leak the answer into the widget timeline | E2E | Timeline entries before my answer have no answer text |
| Tap opens Today | E2E | Deep link lands on Today |

### D32: animated mascot (MOB-05 stills, MOB-31 Rive)
| Test | Layer | Expected |
|---|---|---|
| `Mascot` with reduced motion on (iOS Reduce Motion, Android remove animations) | component (mock `AccessibilityInfo.isReduceMotionEnabled`) | Still pose for each of the 6 moods; no Rive player mounted |
| Reduced motion turned on while the screen is open | component | Switches to the still pose without remounting the screen |
| Accessibility label per mood | component + visual gallery | Same labels as the stills (A11Y-03) |
| Gallery screenshots with reduced motion | visual (`qa/visual/`, QA-07) | Still-pose baseline for every mood, light and dark |

### D33: Spicy pack held at launch (BE-05, REL-04)
| Test | Layer | Expected |
|---|---|---|
| Content loader without `CONTENT_INCLUDE_AGE_GATED` | DB / loader test | No `age_gate = 18+` pack, and none of its questions, in `question_packs`, `pack_questions` or `questions` |
| Loader with `CONTENT_INCLUDE_AGE_GATED=true` | DB / loader test | Spicy pack and its questions load (the flag works both ways) |
| Launch build pack list (premium user) | contract + E2E (`paywall-sandbox.yaml`, packs screen 32) | "Spicy" is not listed and not reachable by deep link |
| Daily question picker never selects a held question | DB | Over a seeded year of days, no 18+ question is assigned |
| Store age rating | release (REL-04) | Lower rating; nothing in the build needs 18+ |

### D51: no free pack questions (BE-46, QA-33; reverses D43/BE-36; CONTRACTS §2 `start_pack_question`)
Suite: `qa/contract/rpc.test.ts` "start_pack_question: no free pack questions".

| Test | Layer | Expected |
|---|---|---|
| Free couple starts q1 or q2 of a premium pack | contract (`rpc.test.ts`) + DB (`no-free-packs.test.mjs`) | `PREMIUM_REQUIRED` for both partners, no row |
| Free couple starts a question of a pack with `is_premium = false` | contract | `PREMIUM_REQUIRED`: the pack flag no longer grants access |
| Expired or inactive entitlement | contract | `PREMIUM_REQUIRED` for every pack question |
| Premium couple (either partner entitled) | contract | every question starts; the partner's call returns the same row, one row |
| Inactive question, free couple | contract | `QUESTION_UNAVAILABLE` (availability checked before premium) |
| Row the free couple already has (started under D43) | contract | returned as-is to both partners; still answerable, reveal rule holds, revealed to both, thread opens; other questions stay `PREMIUM_REQUIRED` |
| Another free couple | contract | `PREMIUM_REQUIRED`; never sees the first couple's row |
| Tests that need a pack row for a free couple (`tables.test.ts` thread + reaction reveal rule) | contract | use `preStartedPackRow` (admin insert, like a D43 row), not the RPC |
| Pack pair on devices (`pack` suite) | E2E | scenario `premium-couple`; Sam and Maya open row `33-question-1`; same row, reveal rule holds |
| Packs 32/33 / scenario `free-couple-packs` | E2E `.maestro/packs/free-couple-pack-locked.yaml` (one device, not in a runner; device-run PASS on REL-A 2026-11-11, QA-38d) + a11y cases `32 free`, `33 free-locked`, `33 free-pack`, `33 free-started` | 32: no free tile, first pack featured as "New this week" (`32-featured`); 33: read-only sample (`33-sample`), no `33-question-*` row, locked rows without text, a started question stays openable (`33-started-<pos>`); `33-locked-*` and `33-unlock` open 34 |
| Paywall 16/17 (D52) | a11y cases `16 plans`, `17 get-premium`, `17 trial` (fake RevenueCat `default` offering) | 17 main button (`17-main`): "Try Premium free for 7 days" only when trial-eligible, else "Get Premium" |

### D50: onboarding with T1/N/L/P2, purchase before sign-in (BE-48, BE-47b, MOB-61, QA-33, QA-34; CONTRACTS §2, §3, §6)
Suites: `qa/contract/purchases-be48.test.ts`, `qa/contract/offers.test.ts`, `qa/contract/onboarding.test.ts`, a11y cases `T1`/`N`/`L`/`P2`, `.maestro/onboarding/fresh-install.yaml`.

| Test | Layer | Expected |
|---|---|---|
| Webhook event for `$RCAnonymousID:…` after `logIn` (uid in `aliases` or `original_app_user_id`), legacy `SUBSCRIBER_ALIAS` | contract | only the uid is looked up and written |
| A second uuid in `aliases` | contract | gets its own snapshot only, never the buyer's premium |
| Anonymous-only event; TRANSFER anon -> uid; bad id lists (not an array, 51 aliases, 11 uuids, non-string) | contract | 200 no lookup / uid only / 400 no lookup |
| Upper-case spelling of a uid | contract (`it.fails`, #167) | must not overwrite the lower-case account |
| `revenuecat-sync` | contract (real handler, real Auth) | own entitlement only, body ignored; 401/405; 30 s per user; BE-48b 120 lookups per UTC minute, global refusal keeps the caller's slot; 500 `SYNC_FAILED` with no write; partner_premium once; `claim_revenuecat_sync` service-only |
| `trial_ending` | contract (`due_trial_endings` + real daily-reminder) | start + 4 days (3-day trial: end - 2 days), once, `days_left`; quiet hours wait; 24 h window; cancelled / billing issue / converted / transferred: none; push to the trial owner only, channel `trial_ending`, `bonded://today`, no price; not gated by tips; trial state not readable by the partner |
| `offer_ending` tips gate (BE-47b) | contract (`due_offer_endings` + real daily-reminder) | tips off: nothing, no ledger; tips on via own client: that partner only, once; turning on inside the window sends at the next tick; after the window: never; partner cannot toggle it |
| Approved push copy, no prices (BE-52, QA-36) | contract (real daily-reminder + real notify) | `trial_ending` exactly "Your free trial ends in 2 days" / "Keep Premium for both of you, or cancel anytime in Settings."; `offer_ending` exactly "Your gift ends soon" / "25% off Premium for you both. Open it before it's gone."; voice thread message (real `thread_messages.kind` and profile lookup) "<first name> sent a voice message" / "Tap to listen.", `bonded://question/<id>/thread`, no path, file name, duration, surname; no price in any of them. Price rule shared with the backend (`helpers.PRICE` = `_shared/copy_test.ts`): currency symbol or ISO code, decimal amount, number + currency word; **a percentage is not a price** (lead 2026-11-11). Every copy string in notifications.json, `status: approved` set and little_thing copy: backend Deno `copy_test.ts`. Mutation-checked: a price in the voice copy fails the case |
| Onboarding answers v2 | contract | documented keys accepted; unknown ids, labels, wrong types, duplicate/unknown goals -> `INVALID_ONBOARDING_ANSWER` on insert/upsert/update; v1 free-form still readable; own rows only |
| Finish after sign-in | contract | ritual time upsert, v2 answers, `get_daily_question` = `first_day`, T1 answer counts for day 1, retry idempotent, locked for the joiner until he answers; `ALREADY_PAIRED` for a paired account |
| T1, N, L, P2 screens | a11y (`qa/a11y`) | rules + snapshots (T1, N, P2); T1 empty error, kept answer; N picker, other time; L checklist; P2 one chart element with values and source |
| Fresh install on a device | E2E (`fresh-install.yaml`, not device-run yet) | 47 skip -> T1 -> N "Not now" -> L -> P2 -> 08 -> 10 (no 09) -> 11 -> 23 waiting; runner checks the T1 answer and ritual time in the DB. P3 (MOB-62): TODO in the flow |

### D52: day-3 gift 14/15 and Today chip; D46: free answer hint 19d (BE-47, MOB-64, MOB-54a, QA-34, QA-35)
Suites: a11y cases `14`/`15`/`18 gift-*` and `19d`, describes "D52 day-3 gift" and "19d free answer hint" in `qa/a11y/screens.test.tsx`; `qa/contract/e2e-seeds.test.ts`; `.maestro/offers/day3-gift.yaml`, `.maestro/offers/day3-gift-none.yaml`, `.maestro/daily/answer-hint-19d.yaml` (`qa/e2e/run-offers.ts`).

| Test | Layer | Expected |
|---|---|---|
| 19 free at 449 / 450 / 500, Premium at 1500 | a11y | no hint / "50 left. Premium: 2000" (spoken "50 characters left. Premium allows up to 2000") / "0 left." / no hint; typing across 450 adds and removes it |
| 19d hint tapped | a11y + E2E | paywall 16; nothing saved |
| Gift seed (free, never subscribed, first streak-3 now) | contract | unopened `day3` for both; no claim yet; first open = one shared 12 h clock; works after an earlier Premium scenario only because the runner clears `premium_history` |
| Ever-subscribed couple earns streak-3 | contract + E2E | no `day3` row, `open_offer` starts nothing; app shows 52b, no 14, no chip |
| Gift on a device | E2E (not device-run yet) | Today opens 14 by itself, "Not now" -> chip "You earned a gift" -> 14 -> 15 countdown 11-12 h -> "Not now" (no 17) -> chip counting down; DB `expires_at = first_opened_at + 12 h` |

### D58: P3 speaks to the goals picked on 06 (MOB-75, QA-48, REL-09; COPY_GUIDE § Goal feelings)
Suites: `qa/app/goal-feelings.test.ts` (QA-48; runs since MOB-75 #350 merged; the copy-vs-D58 case skips until the lead's D58 row is on main); a11y case `P3 trial` (`present` `P3-feelings`, `P3-closing`; snapshots dark, light, light-200); mobile's `src/features/onboarding/__tests__/trial.test.tsx` (0/1/2/3/4+ goals, board order, no-name, 200% on SE, price block).

| Test | Layer | Expected |
|---|---|---|
| Every 06 goal has its P3 line | Jest (`qa/app`) | each key in `GOALS` has a non-empty `premium.goalFeelings.<goal>`; en.json has no line for a goal 06 no longer has; the three `general.*` lines exist (a new goal fails CI until its line lands) |
| Copy = D58 | Jest (`qa/app`) | goal, general, headline and closing lines equal the D58 row in DESIGN_DELTA (read at run time; board emphasis ignored, `{{partner}}` = `{partner}`) |
| No features in the block | Jest (`qa/app`) | no pack title from `supabase/content/packs.csv`, no "Premium", "unlock", "unlimited", "pack", "feature", "subscription", "trial", "history", "voice note" in headline, lines or closing; only `{{partner}}` interpolated; solo variants have no name slot |
| Line choice | Jest (`qa/app`) | `goalFeelingLines` over all 64 goal subsets in 3 tap orders: 06 board order, at most 3, general lines when none (or only unknown keys) picked, duplicates ignored; each line's `i18nKey` exists, has an icon, `key` is a key, never copy |
| P3 on screen | a11y (`P3 trial`) + mobile Jest | headline with the partner name, 3 lines, closing; price, trial timeline and billing text still present (`P3-plan-*`, `P3-timeline*`, `P3-billing`); 200% text scrolls (`P3-scroll`) without truncation |
| `paywall_viewed(P3)` | mobile Jest (MOB-75) + `qa/app/privacy.test.ts` | `goal_keys` = goal keys or `['general']`, never the line text |
| Release check | REL-09 (`qa/release/`) | price, trial, renewal and cancel text at least as visible as the feelings block |

### D57: exit offers on paywall close and in-app cancel; day-3 gift at 50% (BE-59, MOB-76, QA-48, SEC-20, REL-09; CONTRACTS §2, §6)
Suites: `qa/contract/exit-offers.test.ts` (QA-48, 13 tests, real stack: runs in CI `db-reset` via `qa/ci/contract.sh`; RPC has no caller clock, so assertions are relative to the returned `server_now`); backend's `supabase/tests/exit-offers.test.mjs` (pinned clocks, a year later, delete cascade, grants). QA-48b (after MOB-76 #360): `qa/a11y` cases `P3/exit-offer`, `16/exit-offer`, `40/cancel-offer` (rules in light + light-200, structure snapshots) and the describe "D57 exit and cancel offers" in `qa/a11y/screens.test.tsx` (8 tests: % from the store prices, "No thanks" closes to 08 / off 16 with no 17 and no purchase, the second × = 17 per phone (P3) and per server (16), no intro price = 17 without asking the server, "Continue to cancel" opens the App Store page at once); Maestro `.maestro/offers/exit-offer-p3.yaml` and `exit-offer-16.yaml` (lint only until a sandbox build with `exit30` exists; 16 needs a fresh DB for Maya). QA-48c: runner `npm --prefix qa/e2e run offers -- exit --a <device> --rc` (suites `exit-p3`, `exit-16`, `exit-premium`, `exit-gift`, `cancel`; seeds in `qa/scripts/offer-seeds.ts` clear `private.exit_offers`, so no db reset needed) with new flows `offers/exit-offer-none-premium.yaml`, `exit-offer-none-gift.yaml`, `cancel-offer.yaml`; without `--rc` every suite SKIPs with "needs RC sandbox key (ACCOUNTS 9b)" (CI smoke in `qa/ci/app.sh`, plus `tsc -p qa/e2e`); the server answer of each state is proven in `qa/contract/e2e-seeds.test.ts` (CI `db-reset`). The new `exit_offer_*` / `cancel_continued` events go through QA-08's catalogue sweep (`qa/app/privacy.test.ts`) automatically.

| Test | Layer | Expected |
|---|---|---|
| Once per person per trigger | contract | `open_exit_offer('paywall_close')` first call -> `{eligible: true, reason: null}`, `first_shown_at` = `server_now`; later call -> `eligible: false`, `shown_before`, same `first_shown_at`; partner has their own once; solo person eligible; `paywall_close` does not use up `cancel`; `eligible: true` takes the D52 slot `exit_<trigger>` |
| Idempotent retry (`p_client_id`) | contract | same id -> original `eligible: true` and `first_shown_at`; another id or none -> `shown_before`; two concurrent first calls of one person -> one eligible, one `shown_before`, one row |
| Partner can't reuse the retry | contract | Sam (already shown) calling with Maya's client id -> `shown_before` with his own `first_shown_at`; Maya's row unchanged |
| Premium couple | contract | either partner entitled (any store) -> both `premium`; after it lapses the never-subscribed partner is eligible, the subscriber gets `not_intro_eligible` |
| Day-3 gift live | contract | earned-not-opened and opened-running gift -> `gift_live`; after it ends -> eligible |
| `cancel` | contract | eligible only with an own active `app_store` entitlement; partner covered by the other's purchase, Play subscriber, free person -> `no_subscription` |
| Daily limit | contract | another offer screen took today's slot -> `daily_limit`; once the slot is free -> eligible; after an exit offer, `claim_offer_screen('day3')` -> false |
| Refusal writes nothing | contract | every refusal above leaves no `private.exit_offers` row and no `private.offer_screens` slot |
| Unknown trigger | contract | `''`, `Paywall_Close`, `exit30`, `cancel30`, trailing space -> `{eligible: false, first_shown_at: null, reason: 'unknown_trigger'}`, nothing written |
| Access | contract | `anon` 42501; `open_exit_offer_at` and `exit_offers` not reachable through the API; no premium granted by any call |
| Delete account | DB (BE-59) | the person's rows go with the account (`supabase/tests/exit-offers.test.mjs`) |
| Exit sheet | a11y + Jest (MOB-76) | first × on P3/16 opens the sheet instead of 17; "Take 30% off", "No thanks, continue free" and × always close; prices and % from offering `exit30` (no hard-coded %); later × opens 17 |
| Never when not eligible | Jest (MOB-76) | Premium couple, gift live, RPC says no, or RevenueCat intro not eligible -> 17, no sheet |
| Cancel path | a11y + E2E | Settings/Us -> Manage subscription -> one offer screen -> "Continue to cancel" -> store subscription page (at most 1 extra screen); Android straight to Play until BE-59 says otherwise |
| Day-3 coupon 50% | a11y + E2E (sandbox) | 14/15 show the % from the `day3` offering (50% in the sandbox), not `DAY3_PERCENT`; fixtures updated |
| `offer_ending` push | contract (`purchases-be48`) | copy says 50% once the PO approves `notifications.json` |

### D46: voice answers and messages (BE-41/42/43/43b, QA-27; CONTRACTS §2 Answer, Send message, Voice upload, `start_voice_upload`; §3 `delete-account`, `voice-cleanup`)
Suites: `qa/contract/voice.test.ts` (39 tests; uploads always use the name from `start_voice_upload`; FIXTURE bytes, no audio); answer length by tier and after a lapse (BE-41) in `qa/contract/tables.test.ts`. `delete-account` and `voice-cleanup` run as the real handlers under Deno (`qa/functions/voice_functions.ts`, made-up FIXTURE internal secret).

| Test | Layer | Expected |
|---|---|---|
| **Reveal rule on voice answer objects (release blocker)** | contract | partner: download and signed URL refused and row hidden until they answered, then the same bytes; owner always; other couple and anon never; unattached take owner-only; lapsed couple keeps reading. Mutation-checked: a couple-wide read policy fails 3 tests |
| `start_voice_upload` | contract | `{couple}/{uid}/{uuid}.{ext}` for m4a/aac/ogg/opus (m4a default); other ext `INVALID_VOICE`; free `PREMIUM_REQUIRED`; no couple `NOT_PAIRED`; anon 42501 |
| Upload policy | contract | issued name only (self-made, partner's, other couple's: 403 `AccessDenied`); slot > 1 h refused; lapsed couple refused; MIME allow-list (415 `InvalidMimeType`, incl. supabase-js default type); 400 KB (413 `EntityTooLarge`) |
| Write-once (BE-43b) | contract | re-upload, `upsert: true` (403), `update`, `move` refused; signed upload URL with `upsert: true` made before the upload cannot overwrite the attached take (500 `DatabaseError`, P0001); bytes unchanged. Mutation-checked (trigger body emptied: 1 fails) |
| Text XOR voice | contract | answers and messages: 6 / 3 invalid shapes `23514`; switch to text needs the voice fields null |
| New reference | contract | partner's, missing, never uploaded, path traversal, already used (answer or message), other couple: `INVALID_VOICE`; > 23 h after upload `INVALID_VOICE`; free couple `PREMIUM_REQUIRED`; outsider 42501 only |
| Caps | contract | answer 90 000 ms / 400 KB ok, 90 001 `VOICE_TOO_LONG {max_ms:90000,max_bytes:409600}`; message 60 000 ms / 300 KB ok, 60 001 ms or 300 KB + 1 `VOICE_TOO_LONG {max_ms:60000,max_bytes:307200}` |
| After a lapse | contract | unchanged re-send and non-voice updates pass; switch to text passes; back to voice `PREMIUM_REQUIRED`; text messages still work |
| Messages | contract | partner reads, other couple and anon not; resend same `client_id` 23505 (not `INVALID_VOICE`); edit cannot change kind/path/duration |
| Owner delete | contract | own unreferenced take removed; attached take, partner's take (by partner, other couple, anon) kept |
| `VOICE_LIMIT` | contract | 35 slots per couple per local day across both partners (BE-54, D46 amended); 36th `VOICE_LIMIT {max:35}` and takes no slot; other couple unaffected; yesterday's slots don't count; retry of a failed upload reuses the name |
| Lifecycle | contract + functions | `voice_sweep` / `voice_objects_of_user` service-only; cleanup 401 without the secret; orphans > 24 h removed, younger and attached kept, second run removes 0; D08: nothing removed inside 30 days, after `purge_ended_couples` every recording of the couple (answers, messages, spare) removed, other couples kept; D09: `delete-account` removes the user's 3 objects, the partner's stays readable to the partner; bad token 401 removes nothing |
| Write \| Voice on 19, 19b, 19c (MOB-54/55, QA-29) | qa/a11y | only in a build with `SHIPPED.voice` (production build: no switch, no mic on 22); free: Voice tab spoken "Voice answer, Premium", opens 16, no upload started; Premium: 19b writes 1500 with no 19d offer; 19c ready / recording / recorded (0:42, record again, delete; no upload before Send) / mic denied (Open Settings), rules in light + 200 %, 19c ready snapshot |
| Thread voice 22b (MOB-56, QA-29) | qa/a11y | free: Sam's voice message playable ("Play voice message, 0:18": listen-only plan), "Anyone can listen" note, mic spoken "Record voice message, Premium" opens 16; Premium: hold-to-record mic, recording state with timer; 22b free snapshot |
| Free Voice tab opens the paywall (QA-29) | E2E (`daily/voice-free-paywall.yaml`, `run-daily.ts voice-free`, build with `EXPO_PUBLIC_SHIP_VOICE=1`) | 19 switch with Premium on Voice, tap -> 16; DB: no answer, no voice object. Not device-run yet. Recording cannot be driven by Maestro |
| Day ended (D56, QA-38) | E2E (`daily/day-ended-*.yaml`, `run-daily.ts day-ended` / `day-ended-offline` on Android) | 29 "Only Sam answered", 30 partner locked, 19 "This day has ended" with no field and no paywall; late lock-in -> `DAY_ENDED`, text kept; offline queue -> Today day-ended card. Not device-run yet |
| Custom ritual time (MOB-72, QA-38) | Contract (`qa/contract/reminders.test.ts`, pinned `p_now`) | a non-preset `ritual_time` (19:35, Sam 07:05 New York) fires `due_reminders` at that time in the recipient timezone, not at 08:00/12:30/21:00; window [t, t+15 min); changed time moves it; inside quiet hours skipped; none once answered or with `daily_reminder` off; users/anon denied |

### D56: a daily question is answered only on its day (BE-57, QA-40; CONTRACTS §2 `answers`, `DAY_ENDED`)
Suite: `qa/contract/answer-day.test.ts` (38 tests). Free couple Maya + Sam and Premium couple Eve + Finn, each with days today, yesterday and −5 in a zone whose local hour is 02–21. All writes through supabase-js; answers given on a past day are seeded by the server. The 15-minute grace runs on the database clock, which a client cannot pin: checked with a pinned `p_now` on `private.answer_day_open_at` (direct DB connection) over the couple's real rows; the trigger at the boundary (and DST, timezone change) is pinned in `supabase/tests/answer-day.test.mjs`. Mutation-checked: trigger disabled -> 17 of 32 fail. `premium-history.test.ts` now seeds past-day answers as the server.

| Test | Layer | Expected |
|---|---|---|
| Today | contract | answer and edit accepted; reveal rule unchanged |
| Past day (free and Premium) | contract | yesterday (upsert, insert, offline-queued `client_written_at`), day −5, voice answer to yesterday -> `DAY_ENDED`, never `PREMIUM_REQUIRED`; nothing stored |
| Edit of a past answer | contract | upsert / update of yesterday's or day −5's own answer -> `DAY_ENDED`, unchanged |
| Unchanged re-send | contract | skipped no-op (BE-57 follow-up, migration `20261111280000`, SEC-13b): own unchanged re-send of yesterday (upsert with and without `.select()`, update) and of day −5 (free user too: not `PREMIUM_REQUIRED`, not `DAY_ENDED`) -> no error, 0 rows returned, stored row unchanged read as the server (kind, body, voice, `updated_at`); a re-send that changes the kind (text -> voice) -> `DAY_ENDED`, unchanged |
| `role` GUC exemption (SEC-13 Info 4) | contract | PostgREST path: a user session write on an ended day -> `DAY_ENDED`; the service role inserts and edits an answer on the same ended day. Local stack only; hosted bonded-dev verification pending BE-56 |
| Reveal on a one-sided missed day | contract | the partner who missed yesterday never reads the answer; the author does |
| Outsiders | contract | other couple -> 42501, never `DAY_ENDED`; partner's `user_id` -> refused, not `DAY_ENDED`; anon -> 42501 |
| Pack questions | contract | Premium answers and edits a pack question started 9 days ago; free answers a pack question of today |
| Grace | contract (pinned `p_now`) | yesterday open at local 00:09 and 00:14:59 (today's row already exists), closed at 00:15:00; today open; live clock: yesterday closed, today open |

### D55: History is Premium beyond yesterday (BE-55, QA-37; CONTRACTS §2 *History lock*, `history_days`, Voice upload read, Realtime)
Suite: `qa/contract/premium-history.test.ts` (39 tests, release blocker 8; QA-39 added the PDF export read). Free couple Maya + Sam with days today, yesterday, −2, −5 (daily) and a pack question started today / 3 days ago; text, voice (through `start_voice_upload` + Storage while Premium), messages and reactions on each. The couple gets a zone whose local hour is 02–21 at setup, so no case crosses local midnight; the second-exact boundary (and DST) is pinned with a fixed clock in `supabase/tests/premium-history.test.mjs`. Mutation-checked: `private.cq_content_open` forced true -> 20 of 38 fail, incl. the Realtime case.

| Test | Layer | Expected |
|---|---|---|
| **Free couple reads (release blocker)** | contract | both partners: own and partner answers (text + voice row), messages and reactions of today, yesterday and today's pack question; nothing of day −2, −5 or the old pack question (own answer too, by `couple_question_id` and by id); unfiltered `select *` on answers/messages/reactions contains no locked row; the History embedded select lists every day with `answer_count` and question, `answers: []` and `thread_messages: []` on locked days |
| **Voice objects** | contract | yesterday's answer and message voice: download and 60 s signed URL work, same bytes; day −2's refused for both, owner included; an unattached take: owner only |
| `history_days` | contract | exact contract keys; newest first; no answer/message text; `locked` = older than local yesterday (daily `assigned_for`, pack local start date); `my_answered`, `partner_answered`, `message_count` (voice message counted) kept on locked days; paging, limit clamp 1–100, `p_couple_question_id`, `p_couple_id`; other couple: empty set; anon 42501; no couple `NOT_PAIRED`; no `sub` `NOT_AUTHENTICATED` |
| Writes into a locked day | contract | thread message (either partner), reaction insert / upsert, answer upsert on the old pack question -> `PREMIUM_REQUIRED`; answer upsert on a past daily day -> `DAY_ENDED` (D56); update/delete of own locked rows -> 0 rows, no error, unchanged; unfiltered update touches only open days; yesterday still writable; another couple -> 42501, never `PREMIUM_REQUIRED` |
| Premium and lapse | contract | either member's entitlement opens every day for both (answers, threads, reactions, voice, `history_days` unlocked) and an old-thread write works; expired or `is_active=false` relocks at once; Premium again reopens; answer/message/reaction/object counts unchanged |
| Reveal rule on top (D13) | contract | Premium Maya cannot read Sam's old voice answer (row or object) before answering; `history_days` mine false / partner true / unlocked; after she answers both open; a lapse locks the day again (owner's voice too) |
| **Realtime** | contract (real `postgres_changes` subscription as free Sam) | positive control: open-day message, reaction, answer UPDATE delivered; no event for locked-day rows (new messages, reactions on locked answers/messages, own and partner answer UPDATEs, message UPDATE, a new own answer on day −6), checked with an open-day sentinel after them (one subscription delivers in commit order), and no locked text in any payload; the same old-day insert is delivered while the couple is Premium and not after the lapse |
| Ended archive (D08) | contract | Eve (own Premium) reads the old day, Finn (free) only yesterday: ex-partner's Premium does not count; `history_days(p_couple_id)` locked per reader; archive writes 42501; Eve's lapse relocks |
| PDF export read path (MOB-27, QA-39) | contract | the export's two reads as `api.ts` makes them: `history_days` gives each reader which answered days are locked (Eve none, Finn the old day); the text select asked for **every** day still returns no answers or messages of Finn's locked day |
| PDF export (MOB-27, QA-39) | qa/app `history-lock.test.ts` (real api + fake PostgREST) | text select only for open days I answered (locked ids never requested); a locked day I answered comes back counted with no text; one I didn't answer is left out; HTML has only open days + the "N older days need Premium" note; Premium exports all; `history_days` paged by 100 |
| History list / detail / archive api (MOB-71, QA-39) | qa/app | 29 reads reactions only for open answered days (none when a page is all locked); `locked` passes through to 29, 30 and the ended archive; 30's locked detail reads nothing but `history_days` |
| History screens (MOB-71, QA-39) | qa/a11y | 29 `locked-free` (snapshot): lock + "Premium" on day −2/−3, row label "… Answers locked. Premium.", still a button; `locked-tap` opens 16 titled "Unlock all your history with Premium"; `premium-open` no lock; 30 `locked` (snapshot): "Sam's answer, locked. Premium." / "Your answer, locked. Premium.", no text requested (`noAnswerText`), unlock -> 16; 30 `premium-older` opens both answers (positive control); 22 `locked`: thread not read, no composer, unlock -> 16; 16 `from-history` (snapshot); ended archive `29/30 ended-locked` (free reader: rows locked, MOB-70 note on the list, no text); 17 `history-row-shipped` shows "History: free Last 2 days, Premium Everything", `history-row-off` none; 58 `export-locked`: the PDF HTML holds only the open day + "1 older day needs Premium, so it isn't in this PDF." |
| History E2E (QA-39) | Maestro, one device (`run-history.ts`) | `locked`, `premium` (+ lapse relock, nothing deleted), `ended`, `paywall-row` (`--shipped`); written and lint-clean, **not device-run yet** |

### D48: little things (BE-44/44b/45, QA-28; CONTRACTS §2 `send_little_thing`, `undo_little_thing`, `little_things_today`, Little things table, Notification prefs; §4 `notify` `{"type":"little_thing"}`, `claim_little_thing_pushes`; §5 payload)
Suite: `qa/contract/little-things.test.ts` (67 tests; case list from `supabase/tests/little-things*.test.mjs`). Client calls go through supabase-js on the database clock; time rules run through the private `*_at` variants with the persona's JWT claims (`callAs`) on far-future days. `notify` runs as the real handler under Deno (`qa/functions/notify_little_things.ts`): real claim, tokens and `push_log`, Expo transport replaced by a recorder.

| Test | Layer | Expected |
|---|---|---|
| **Free 11th kiss (acceptance)** | contract | 5 + 5 kisses ok (`at_limit` on the 10th), the 11th `LITTLE_THING_LIMIT {"kind":"kiss","more_with_premium":true}`, nothing written. Mutation-checked: free kiss limit 11 fails 5 tests |
| Limits per tier | contract | free 10 kisses per kiss (batch refused whole: 8 + 3), 5 hugs any length, 3 miss-yous; Premium (partner of the subscriber too) 50 / 30 / 15 with `more_with_premium` false; 1 goodnight + 1 good morning for everyone; a lapse drops to the free numbers; per sender; sender-local day (New York after UTC midnight, Tokyo) |
| `little_things_today` | contract | five rows hug, kiss, goodnight, good_morning, miss_you; only `{kind, at_limit, more_with_premium}` (no counts) |
| Errors and access | contract | `INVALID_LITTLE_THING` (10 shapes), null amount = 1, `NOT_PAIRED` (solo, no couple, ended), `NOT_AUTHENTICATED`, anon 42501; private `*_at` not reachable; table: couple reads, other couple and anon not, no direct insert/update/delete, archive readable after unpair |
| Undo | contract | ≤ 5 s on the database clock (state returned, count back, row kept with `undone_at`), > 5 s `UNDO_EXPIRED`, boundary 5 s / 5.001 s pinned; partner, other couple, unknown id `INVALID_LITTLE_THING`; idempotent; BE-44b: 11th undo of the sender-local day `UNDO_EXPIRED` (gesture stays and counts; pinned and on the database clock), per sender, next day resets; `client_id` retry returns the first send (also after an undo, other kind) |
| Same-time hug | contract | partner hug within 10 s `same_time` (database clock and stored on the row); 11 s, undone partner hug, kiss, own hugs, other couple: false |
| Push claim | contract (pinned) | eligible at 10 s; kiss batch + hug one push `{kiss:3,hug:1}`, lead = newest; held 10 min after a push then one grouped push; a kind pushed < 1 h ago dropped (`type_cap`), only capped kinds → no push; D24 4/day shared both ways (`daily_cap`, next local day resets); quiet hours `silent` (recipient tz, custom window); toggle off (set by the user through RLS) `preference`, no `push_log`; undone never pushes; undo after the claim `UNDO_EXPIRED`; stale > 30 min; ended couple `no_recipient`; service-only, `push_log` not readable; `push_log` carries no name or kind |
| `push_log.record_id` = newest gesture | contract | `it.fails` on the function definition (#206: `v_keep` is an unordered `array_agg`; the order depends on the plan, so a behavioural check would be flaky) |
| `notify` delivery | functions (real handler) | 401 without the secret; one message per token with the §5 shape (title, body "Maya sent you 3 kisses and a hug", sound + channel of the newest gesture for every kind, `data` = `{type, url, gesture, gestures, silent}`, no ids, no hug length); quiet hours: no sound, `passive`, `normal`, `little_thing_quiet`, `silent: true`; toggle off nothing; undone nothing; no token `suppressed`; DeviceNotRegistered token deleted; transport failure 500 `INTERNAL_ERROR`, claim kept, no resend |
| "Little things sounds" switch (BE-53, QA-36) | contract + functions (real handler) | `notification_prefs.little_things_sound` defaults on; owner switches it via update and the app upsert; partner, other couple, anon: 0 rows / no read; not nullable. Off, outside quiet hours: the real `notify` still delivers one push, no `sound`, `little_thing_quiet`, `priority: normal`, `passive`, `data.silent: true`, gestures pushed, `push_log` sent (counts); the recipient's switch decides (sender with sound off still sends sound to a partner with it on); `little_things` off + sound off: dropped (`preference`), nothing logged. Mutation-checked: claim ignoring the switch fails the delivery case. Caps with sound off: backend `supabase/tests/little-things-sound.test.mjs` |
| 24b / 24c / 24d UI (MOB-58/59, QA-29) | qa/a11y | only with `SHIPPED.littleThings` and a paired couple; 24b button (snapshot), one-time tip; 24c fan (menu of 5 items, snapshot; Today hidden from screen readers while open, so no heading and a hidden scrim: documented); free kiss at limit "More kisses with Premium" with a hint, tap opens 16, nothing sent; goodnight sends `{goodnight, 1}`, toast "Goodnight sent to Sam", Undo calls undo once; 24d: Sam's 3 kisses "Sam sent you 3 kisses" (snapshot), decorative pose hidden, Reply sends `{kiss, 3}` and hides the bubble; plays once per phone (Today again: no bubble); "Sam hugged you back"; Reply at my free limit opens 16, nothing sent; my own gestures never play; 41 rows `41-little_things` / `41-little_things_sound` |
| Kiss and kiss back on two devices (QA-29) | E2E (`little-things/kiss-first.yaml` + `kiss-reply.yaml`, `run-daily.ts little`, build with `EXPO_PUBLIC_SHIP_LITTLE_THINGS=1`) | Maya sends one kiss from the fan, toast passes; Sam (started once the kiss is in the DB) sees 24d "Maya sent you a kiss", taps Reply; Maya sees "Sam kissed you back". DB: exactly `maya:kiss x1, sam:kiss x1`, none undone. Not device-run yet. Hug hold cannot be driven by Maestro |

### D08/D09: who ended a couple (BE-38, QA-21; CONTRACTS §2 `unpair`, Couple row, §4 `delete-account`)
Suite: `qa/contract/ended-by.test.ts` (throwaway accounts for deletion, never personas).

| Test | Layer | Expected |
|---|---|---|
| Active couple | contract | `ended_by` and `ended_reason` null |
| `unpair` by either member, retry, both at once | DB + contract | `ended_by` = the caller whose call succeeded, `ended_reason` = `unpaired`; retries change nothing |
| Solo space archived by a join (D04/D37) | contract | both null |
| Survivor / outsider / new partner / anon / after 30 days | contract | survivor reads both columns; others and the expired window read nothing |
| Client writes `ended_by` / `ended_reason` (active or ended) | contract | 42501, row unchanged |
| Partner deletes their account | DB + contract | `deleted`, `ended_by` null, no uuid or name of the user left in `couples`; survivor keeps her answers and can pair again |
| The unpair caller deletes their account later | DB + contract | `ended_by` cleared, `ended_reason` stays `unpaired` (D09) |
| The unpair survivor deletes later; a deletion with an older archive | contract | the actor stays; the older archive keeps its own values |
| Realtime | contract | `couple_members` published, `couples` not; the remaining member's `left_at` row readable |

### D54: privacy of analytics, Sentry and logs (QA-08; ANALYTICS §1, RC PRIV-01)
Suite: `qa/app/privacy.test.ts` (Jest, `qa/ci/app.sh`). The app's analytics wrapper drives the **real** `posthog-react-native` SDK with the app's own options; the fetch seam captures every request. Every string in `qa/fixtures/privacy-strings.json` (answers, messages, names, emails, invite codes, links and tokens, key-date titles, feedback, push tokens, voice paths, error messages) goes into every catalogue event field, as extra keys, as `$set` / `$current_url` / `$screen_name`, into the super and person properties, `identify` and screen views. Mutation-checked: both gates (`sanitizeEvent` in `track`, `before_send`) removed -> 4 fail; opt-out not closing the client -> 1 fails.

| Case | Layer | Check |
|---|---|---|
| Content on the wire | Jest + real SDK | no fixture string in any request body (gzip decoded) or URL; positive control: every catalogue event and `$identify` really sent |
| No autocapture / replay | Jest + real SDK | only catalogue events + `$identify`/`$set`; no `/s/`, `/decide`, `/flags`, surveys requests; EU hosts only |
| No advertising id / device name | Jest + real SDK | no `*advertis*`, idfa, gaid, `$device_name`, `$ip`, `$current_url`, `$screen_name`, `$elements` with a value |
| Person properties | Jest + real SDK | `$set` keys only from ANALYTICS §2 |
| Opt-out | Jest + real SDK | after `optOutOfAnalytics()` zero requests, also after a restart on the same device storage |
| Logs (app) | Jest | console output during the run has no fixture string; every `console.*` in `src/`, `app/` sits in a `__DEV__` guard |
| Logs (functions) | Jest (source) | `console.*` only in `_shared/log.ts`; no `log()` metadata key named like content; redaction keys present |
| Sentry | — | todo until MOB-24's Sentry part lands (`it.todo` in the suite) |

Limit: the catalogue's `slug` (badge ids) and `route` checks are shape checks; a lowercase-hyphen word would pass them. Real content (capitalised names, base64url tokens, text with spaces) does not; badge ids come from the server.

### D35: email sign-in sends a code and a PKCE link (MOB-08, BE-27, QA-11; CONTRACTS §10)
| Test | Layer | Expected |
|---|---|---|
| `signInWithOtp` (PKCE, `emailRedirectTo: bonded://auth/callback`) for an existing persona and for a new address | contract (`qa/contract/email-auth.test.ts`, local Mailpit) | The newest mail has exactly one 6-digit code and one Auth verify link with `redirect_to=bonded://auth/callback` |
| Follow the verify link with `redirect: 'manual'` | contract | 3xx to `bonded://auth/callback?code=…`; no `token`/`token_hash` parameter and no fragment |
| Exchange that code on the initiating client | contract | Session for the same user; reusing the link gives no new `code` |
| `verifyOtp({ email, token, type: 'email' })` with the mailed code / a wrong code | contract | Session / rejected |
| Sign in on 08 and J4 by code | E2E (`subflows/sign-in-email.yaml`, `scripts/mail-otp.js`) | Code read from the mail only (no admin `generate_link`) |
| Link callback on cold and warm launch; expired link | E2E (QA-11, todo) | Signed in; expired link returns to a usable sign-in screen |

## Coverage map (update as suites land)
| Area | DB | Contract | Functions | Component | E2E | Status |
|---|---|---|---|---|---|---|
| Email sign-in (D35) | — | QA-11 | — | MOB-08 | `subflows/sign-in-email.yaml` | partly (contract) |
| Pairing (D01–D06, D02 token) | BE-04 | QA-03 | — | MOB-09 | `pairing-*.yaml` | todo |
| Daily question + reveal | 22 PGlite tests (BE-01) | QA-03 | — | MOB-11 | `daily-loop.yaml` | partly (DB) |
| Thread + reactions + typing (D45 emoji: one emoji, `INVALID_REACTION`, ❤ → ❤️, Hearts given at 25) | existing, BE-40 | QA-03, QA-26 (`tables.test.ts`) | — | MOB-12, MOB-53 | `thread.yaml` | partly (DB + contract) |
| Voice answers + messages (D46) | BE-42/43/43b | QA-27 `voice.test.ts` | QA-27 (`delete-account`, `voice-cleanup` handlers) | MOB-55/56, QA-29 qa/a11y | `daily/voice-free-paywall.yaml` (not device-run) | automated (contract + a11y) |
| History lock (D55) | BE-55 `premium-history.test.mjs` | QA-37 `premium-history.test.ts` (incl. Realtime, QA-39 PDF read) | — | MOB-71, QA-39 qa/a11y + qa/app | QA-39 `history/*.yaml` (not device-run) | automated (DB + contract + app + a11y) |
| Answer only on the day (D56) | BE-57 `answer-day.test.mjs` (grace pinned) | QA-40 `answer-day.test.ts` | — | MOB-73 (todo) | — | automated (DB + contract) |
| P3 goal feelings (D58) | — | — | — | MOB-75 `trial.test.tsx`, QA-48 `qa/app/goal-feelings.test.ts` + a11y `P3 trial` | — | automated (app + a11y) |
| Exit offers + day-3 50% (D57) | BE-59 `exit-offers.test.mjs` | QA-48 `exit-offers.test.ts` | — | MOB-76 `exitOffers.test.tsx`; QA-48b `qa/a11y` P3/16/40 cases + D57 describe | QA-48b `offers/exit-offer-p3.yaml`, `exit-offer-16.yaml`; QA-48c runner `run-offers exit` + `exit-offer-none-premium`, `exit-offer-none-gift`, `cancel-offer` (lint + skip smoke; device run needs `--rc`, ACCOUNTS 9b) | yes (device run pending) |
| Little things (D48) | BE-44/44b/45 PGlite | QA-28 `little-things.test.ts` | QA-28 (`notify` little_thing handler) | MOB-58/59, QA-29 qa/a11y | `little-things/kiss-*.yaml` (not device-run) | automated (contract + a11y) |
| Streak, saver, badges | BE-06/11/12 | QA-03 | — | MOB-10 | `daily-loop.yaml` | todo |
| Offline | — | — | — | MOB-14 | `offline-answer.yaml` | todo |
| Notifications (D23/D24) | BE-07/08/19/14 `notify-ledger`, `reminders`, `weekly-recap` (PGlite) | QA-05 `notify.test.ts` (event types: recipients, §5 shape, 5-min thread grouping, per-type and 4/day caps across local days, quiet hours, toggles, redelivery, DeviceNotRegistered); QA-05b `scheduled-push.test.ts` (ritual reminder + partner-answered variant, last call, weekly recap through the real daily-reminder: fixture message, once per window, cap, per-recipient quiet hours, toggles, no-device suppression without resend, no answer text; #371 `it.fails`) | QA-05b `qa/functions/push_fixtures_test.ts` (little thing + silent, voice, trial/offer fixtures = builders) | MOB-15; QA-05 `qa/app/push-links.test.ts` (every fixture and §5 type routes) | push routing | automated (DB + contract + functions + app) |
| History + recap | BE-14/20 | QA-03 | — | MOB-16 | `history.yaml` | todo |
| Purchases | entitlements lockdown | QA-06 `purchases.test.ts` (webhook over HTTP, partner premium, push caps), QA-33 `purchases-be48.test.ts` (aliases, `revenuecat-sync`, `trial_ending`) | BE-18 + QA-06 harness | MOB-19 + QA-06 `qa/app/purchases.test.tsx` (restore, 57, server-confirmed 35) | `purchases/paywall-sandbox.yaml`, `purchases/restore-sandbox.yaml` (manual store sheet, `qa/purchases/README.md`) | automated; sandbox runs pending ACCOUNTS 8/9; push delivery blocked by #126 |
| Settings, unpair, delete | BE-09/16 | QA-03 | BE-16 | MOB-18 | `delete-account.yaml` | todo |
| Widgets (D26) | — | reveal rule on widget data | — | MOB-30 | `widget-reveal.yaml` | todo |
| Mascot (D32) | — | — | — | MOB-05, MOB-31 | — | todo |
| Content age gate (D33) | BE-05 loader | QA-03 pack list | — | — | `paywall-sandbox.yaml` | todo |
| Accessibility + visual | — | — | — | gallery | `qa/visual` | todo |
| Privacy (D54, PRIV-01) | — | — | `_shared/log.ts` redaction + log call keys (QA-08) | MOB-24 recorder tests | `qa/app/privacy.test.ts` (real PostHog SDK on the wire) | analytics + logs done; Sentry todo (MOB-24) |

## CI (`.github/workflows/ci.yml`, QA-01)
Runs on every PR and every push to `main`, on Node 24 by default (`.nvmrc` overrides). No path filters, so required checks always report. Job logic is in `qa/ci/*.sh`; run any job locally with `bash qa/ci/<job>.sh`.

| Job (check name) | Runs | Turns on when |
|---|---|---|
| `plan-check` | `node scripts/plan/generate.mjs --check` | now |
| `agents-sync-check` | `node scripts/agents/sync.mjs --check` | now |
| `db-tests` | in `supabase/tests/`: `npm ci`, `npm test` (PGlite RLS/RPC, exits 1 on any FAIL), `npm run check:types` (fails if `src/types/database.ts` is stale) | `supabase/tests/package.json` exists (BE-01, on main) |
| `db-reset` | Supabase CLI 3.0.0: `supabase start` + `supabase db reset` on real Postgres 17 (Docker on ubuntu-latest) | `supabase/config.toml` exists (BE-01, on main) |
| `functions` | `deno lint`, `deno check`, `deno test` over `supabase/functions/` (uses its `deno.json` if present) | first `.ts` under `supabase/functions/` (BE-23) |
| `app` | `npm run typecheck` (fallback `tsc --noEmit`), `npm run lint`, `npm test` | root `package.json` exists (MOB-01) |
| `web` | QA-47: Playwright layout check of `web/` (landing scroll tracks at 5/40/65/100%, `/j/`) on 12 profiles: Chromium Android phones, WebKit iPhones/iPad, Chromium/WebKit/Firefox desktop (`qa/web/`); screenshots + report as the `web-playwright-report` artifact on failure | a PR or push changes `web/`, `qa/web/`, `qa/ci/web.sh` or `ci.yml` (skips otherwise) |
| `ci-ok` | fails if any job above failed or was cancelled | now |

Until its target lands, a job passes with a "skipped" notice in the run summary. Planned additions: contract tests with `supabase start` (QA-03), `e2e.yml` nightly + `release/*` (QA-04), `visual.yml` nightly (QA-07).

## Fixtures
`qa/fixtures/personas.json` (personas and scenarios) · `revenuecat-events.json` · `push-payloads.json` · `deeplinks.json` · `privacy-strings.json` (QA-08: content that must never leave the phone).

## Environments
- **Local:** `supabase start` + seed. All automated layers run here.
- **`dev`:** nightly E2E and the release validator's pre-RC runs.
- **prod:** never used for tests. The release validator uses PO-provided test accounts only.
