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
| Packs 32/33 / scenario `free-couple-packs` | E2E `.maestro/packs/free-couple-pack-locked.yaml` (one device, not in a runner, not device-run yet) + a11y cases `32 free`, `33 free-locked`, `33 free-pack`, `33 free-started` | 32: no free tile, first pack featured as "New this week" (`32-featured`); 33: read-only sample (`33-sample`), no `33-question-*` row, locked rows without text, a started question stays openable (`33-started-<pos>`); `33-locked-*` and `33-unlock` open 34 |
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
| `VOICE_LIMIT` | contract | 20 slots per couple per local day across both partners; 21st `VOICE_LIMIT {max:20}` and takes no slot; other couple unaffected; yesterday's slots don't count; retry of a failed upload reuses the name |
| Lifecycle | contract + functions | `voice_sweep` / `voice_objects_of_user` service-only; cleanup 401 without the secret; orphans > 24 h removed, younger and attached kept, second run removes 0; D08: nothing removed inside 30 days, after `purge_ended_couples` every recording of the couple (answers, messages, spare) removed, other couples kept; D09: `delete-account` removes the user's 3 objects, the partner's stays readable to the partner; bad token 401 removes nothing |

### D48: little things (BE-44/44b/45, QA-28; CONTRACTS §2 `send_little_thing`, `undo_little_thing`, `little_things_today`, Little things table, Notification prefs; §4 `notify` `{"type":"little_thing"}`, `claim_little_thing_pushes`; §5 payload)
Suite: `qa/contract/little-things.test.ts` (64 tests; case list from `supabase/tests/little-things*.test.mjs`). Client calls go through supabase-js on the database clock; time rules run through the private `*_at` variants with the persona's JWT claims (`callAs`) on far-future days. `notify` runs as the real handler under Deno (`qa/functions/notify_little_things.ts`): real claim, tokens and `push_log`, Expo transport replaced by a recorder.

| Test | Layer | Expected |
|---|---|---|
| **Free 11th kiss (acceptance)** | contract | 5 + 5 kisses ok (`at_limit` on the 10th), the 11th `LITTLE_THING_LIMIT {"kind":"kiss","more_with_premium":true}`, nothing written. Mutation-checked: free kiss limit 11 fails 5 tests |
| Limits per tier | contract | free 10 kisses per kiss (batch refused whole: 8 + 3), 5 hugs any length, 3 miss-yous; Premium (partner of the subscriber too) 50 / 30 / 15 with `more_with_premium` false; 1 goodnight + 1 good morning for everyone; a lapse drops to the free numbers; per sender; sender-local day (New York after UTC midnight, Tokyo) |
| `little_things_today` | contract | five rows hug, kiss, goodnight, good_morning, miss_you; only `{kind, at_limit, more_with_premium}` (no counts) |
| Errors and access | contract | `INVALID_LITTLE_THING` (10 shapes), null amount = 1, `NOT_PAIRED` (solo, no couple, ended), `NOT_AUTHENTICATED`, anon 42501; private `*_at` not reachable; table: couple reads, other couple and anon not, no direct insert/update/delete, archive readable after unpair |
| Undo | contract | ≤ 5 s on the database clock (state returned, count back, row kept with `undone_at`), > 5 s `UNDO_EXPIRED`, boundary 5 s / 5.001 s pinned; partner, other couple, unknown id `INVALID_LITTLE_THING`; idempotent; BE-44b: 11th undo of the sender-local day `UNDO_EXPIRED` (gesture stays and counts; pinned and on the database clock), per sender, next day resets; `client_id` retry returns the first send (also after an undo, other kind) |
| Same-time hug | contract | partner hug within 10 s `same_time` (database clock and stored on the row); 11 s, undone partner hug, kiss, own hugs, other couple: false |
| Push claim | contract (pinned) | eligible at 10 s; kiss batch + hug one push `{kiss:3,hug:1}`, lead = newest; held 10 min after a push then one grouped push; a kind pushed < 1 h ago dropped (`type_cap`), only capped kinds → no push; D24 4/day shared both ways (`daily_cap`, next local day resets); quiet hours `silent` (recipient tz, custom window); toggle off (set by the user through RLS) `preference`, no `push_log`; undone never pushes; undo after the claim `UNDO_EXPIRED`; stale > 30 min; ended couple `no_recipient`; service-only, `push_log` not readable; `push_log` carries no name or kind |
| `push_log.record_id` = newest gesture | contract | `it.fails`: QA-28 finding (record_id follows heap order, not `created_at`) |
| `notify` delivery | functions (real handler) | 401 without the secret; one message per token with the §5 shape (title, body "Maya sent you 3 kisses and a hug", sound + channel of the newest gesture for every kind, `data` = `{type, url, gesture, gestures, silent}`, no ids, no hug length); quiet hours: no sound, `passive`, `normal`, `little_thing_quiet`, `silent: true`; toggle off nothing; undone nothing; no token `suppressed`; DeviceNotRegistered token deleted; transport failure 500 `INTERNAL_ERROR`, claim kept, no resend |

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
| Voice answers + messages (D46) | BE-42/43/43b | QA-27 `voice.test.ts` | QA-27 (`delete-account`, `voice-cleanup` handlers) | MOB-55/56 | — | automated (contract) |
| Little things (D48) | BE-44/44b/45 PGlite | QA-28 `little-things.test.ts` | QA-28 (`notify` little_thing handler) | MOB-58/59 | QA-29 | automated (contract) |
| Streak, saver, badges | BE-06/11/12 | QA-03 | — | MOB-10 | `daily-loop.yaml` | todo |
| Offline | — | — | — | MOB-14 | `offline-answer.yaml` | todo |
| Notifications | BE-07 | — | BE-08/19 | MOB-15 | push routing | todo |
| History + recap | BE-14/20 | QA-03 | — | MOB-16 | `history.yaml` | todo |
| Purchases | entitlements lockdown | QA-06 `purchases.test.ts` (webhook over HTTP, partner premium, push caps), QA-33 `purchases-be48.test.ts` (aliases, `revenuecat-sync`, `trial_ending`) | BE-18 + QA-06 harness | MOB-19 + QA-06 `qa/app/purchases.test.tsx` (restore, 57, server-confirmed 35) | `purchases/paywall-sandbox.yaml`, `purchases/restore-sandbox.yaml` (manual store sheet, `qa/purchases/README.md`) | automated; sandbox runs pending ACCOUNTS 8/9; push delivery blocked by #126 |
| Settings, unpair, delete | BE-09/16 | QA-03 | BE-16 | MOB-18 | `delete-account.yaml` | todo |
| Widgets (D26) | — | reveal rule on widget data | — | MOB-30 | `widget-reveal.yaml` | todo |
| Mascot (D32) | — | — | — | MOB-05, MOB-31 | — | todo |
| Content age gate (D33) | BE-05 loader | QA-03 pack list | — | — | `paywall-sandbox.yaml` | todo |
| Accessibility + visual | — | — | — | gallery | `qa/visual` | todo |
| Privacy | — | — | log redaction | analytics wrapper | `qa/privacy` | todo |

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
| `ci-ok` | fails if any job above failed or was cancelled | now |

Until its target lands, a job passes with a "skipped" notice in the run summary. Planned additions: contract tests with `supabase start` (QA-03), `e2e.yml` nightly + `release/*` (QA-04), `visual.yml` nightly (QA-07).

## Fixtures
`qa/fixtures/personas.json` (personas and scenarios) · `revenuecat-events.json` · `push-payloads.json` · `deeplinks.json`.

## Environments
- **Local:** `supabase start` + seed. All automated layers run here.
- **`dev`:** nightly E2E and the release validator's pre-RC runs.
- **prod:** never used for tests. The release validator uses PO-provided test accounts only.
