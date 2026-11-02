# Contracts between agents

This file is the **single source of truth** for how the app, the database and the edge functions talk to each other. Every agent reads it before starting and after every merge.

**Status tags:**
- `live`: in `0001_mvp.sql` today.
- `planned (TASK)`: decided in [DESIGN_DELTA](plan/DESIGN_DELTA.md) and to be built by that task. Consumers build against the planned shape now.

**Changing a contract:**
1. The owner edits its section in the same PR as the code.
2. Add a change-log row.
3. A breaking change (rename, removal, changed error code) needs the consumer's ack in the PR, or the lead's decision.

Placeholders (D30):
- app scheme `bonded://`;
- bundle id `app.bonded.mobile`;
- invite domain `[your-domain]`.

---

## 1. Repository layout and ownership (owner: lead)

```
app/                         mobile    Expo Router routes
src/                         mobile    features, lib, ui
src/types/database.ts        backend   generated: node supabase/tests/gen-types.mjs  (or supabase gen types typescript --local --schema public)
supabase/migrations/         backend
supabase/migrations_phase2/  backend   AI phase, not applied for the MVP
supabase/seed.sql            backend   built from supabase/content + qa/fixtures/personas.json
supabase/tests/              backend
supabase/functions/          backend   edge functions (Deno)
supabase/content/            product owner (copy) · backend (loader)
qa/                          QA        contract tests, fixtures, scripts, visual, privacy
qa/release/                  release   RC checklist, requirement matrix, reports
.maestro/  .github/workflows/  QA
design-handoff/              product owner
docs/plan/                   lead      (status/<agent>.md: each agent its own)
docs/CONTRACTS.md            each section names its owner
```

- Branches: `lead/*`, `mobile/*`, `be/*`, `qa/*`, `release/*`, one per task. Only the lead merges to `main`, at each milestone (M1–M6, [SCOPE](plan/SCOPE.md)), after the integration check in §9.
- Environments:
  - local stack (`supabase start`);
  - Supabase `dev` (all agents);
  - `prod`: the backend applies migrations and deploys functions, only at milestone merges.

## 2. Database API used by the app (owner: backend)

The app uses `supabase-js` with the user's session. Every rule is enforced by RLS or RPCs; the app never filters for security.

### RPCs

| Function | Args | Returns | Errors | Status |
|---|---|---|---|---|
| `create_couple` | `p_stage couple_stage` (enum `dating`, `living_together`, `engaged_married`, `long_distance`; may be null), `p_goals text[]` (default `{}`), `p_partner_name text` (default null) | `uuid` couple id (solo couple, D03). Goals: blanks and duplicates dropped, max 12; partner name trimmed, max 40. A retry while still solo updates the settings and returns the same id | `NOT_AUTHENTICATED`, `ALREADY_PAIRED` (your couple already has two members) | live (BE-03) |
| `create_invite` | — | `{code text, expires_at timestamptz, token text}`: `code` = the 4 digits (`'4827'`; show as `BND·4827`, D01); `expires_at` = now + 48 h; `token` = 192-bit url-safe string for the invite link `/j/BND4827?t=<token>` (D02). **The token is returned only here** (the DB keeps a hash): to show the link again, call `create_invite` again | `NOT_AUTHENTICATED`, `NOT_PAIRED`, `COUPLE_FULL` | live (BE-04): `NOT_PAIRED` without a couple (call `create_couple` first), `COUPLE_FULL` when the couple has two members. One active invite per inviter: a new call **revokes the previous code and token** and returns fresh ones. Digits are unique among unexpired, unused invites. The invite carries the couple's `partner_name`. Read the current one with `from('pair_invites').select('code, expires_at, accepted_at')` (name columns; no token) |
| `invite_preview` | `p_code text` (`BND`, case, spaces, `·` and `-` ignored), `p_token text` (default null; from the link) (callable by **anon**) | `json` `{inviter_name` (first name only)`, inviter_avatar_url, inviter_answered_today bool` (in the couple's timezone)`, expires_at}` and nothing else | `INVALID_CODE`, `INVITE_EXPIRED`, `COUPLE_FULL`, `RATE_LIMITED` | live (BE-04). Counted failures (`INVALID_CODE`, `INVITE_EXPIRED`, `COUPLE_FULL`) are returned as an HTTP 400 **response body** instead of a raised exception (see "Error format"). Limiter: 5 failed attempts per actor per 15 min, shared with `accept_invite`; actor = the user, or for anon the client IP (hashed). A valid `p_token` skips it. `SECURITY DEFINER`, minimal fields, SEC-01 review |
| `accept_invite` | `p_code text` (`BND`, case, spaces, `·` and `-` ignored), `p_token text` (default null) | `json` string: the couple id. The joiner joins the **inviter's couple** and inherits its stage, goals, timezone and key dates (D03, D10). A caller with a solo couple may join: that solo couple is deleted with its answers, questions, key dates, streak and open invite (D04) | `NOT_AUTHENTICATED`, `INVALID_CODE`, `INVITE_EXPIRED`, `COUPLE_FULL`, `OWN_CODE`, `ALREADY_PAIRED`, `RATE_LIMITED` | live (BE-04). Order: `ALREADY_PAIRED` (caller's couple has **two** members; checked first, not counted), `RATE_LIMITED` (5 failed attempts in 15 min; skipped for a valid token), `INVALID_CODE` (unparseable, unknown, revoked, wrong token), `COUPLE_FULL` (code already used within 48 h, or the inviter's couple is full/ended), `OWN_CODE` (raised), `INVITE_EXPIRED` (at or after `expires_at`). `INVALID_CODE`, `COUPLE_FULL` and `INVITE_EXPIRED` count as failed attempts unless a valid token vouches for the invite; `OWN_CODE` and `ALREADY_PAIRED` do not. Same body-vs-raise rule as `invite_preview`. A retry after success → `ALREADY_PAIRED` (treat as done) |
| `get_daily_question` | — | `couple_questions` row (day 1 = special `first_day`, D12) | `NOT_PAIRED`, `LIBRARY_EXHAUSTED` | live, also for solo couples (BE-03); the joiner gets the question the inviter already answered. BE-05: a couple's first daily question is the active `first_day` special ("What did you notice first about me?"); afterwards the next daily-eligible question that fits the couple's `stage` (`questions.stages` empty = every stage; a couple without a stage only gets those), in `sort_order`, never a special; `LIBRARY_EXHAUSTED` when none is left |
| `start_pack_question` | `p_question uuid` | `couple_questions` row | `NOT_PAIRED`, `QUESTION_UNAVAILABLE` (in no active pack), `PREMIUM_REQUIRED` | live |
| `get_streak` | — | `{current int, longest int, last_completed_on date, completed_today bool, at_risk bool, saver_available bool}` (composite `streak_state`); `current` is already 0 after a missed day (last completed day older than yesterday in the couple's timezone); `at_risk` = streak of 3+ not yet secured today (the 22:30 last-call condition, D23); `saver_available` is always false until BE-11 | `NOT_AUTHENTICATED`, `NOT_PAIRED` | live (BE-06); a solo couple returns zeros. A late offline answer that completes an older day can raise `current` again (gap merge) |
| `use_streak_saver` | — | `get_streak` shape | `NOT_PAIRED`, `PREMIUM_REQUIRED`, `SAVER_UNAVAILABLE` | planned (BE-11) |
| `send_nudge` | — | `void` | `NOT_PAIRED`, `PARTNER_ALREADY_ANSWERED`, `NUDGE_LIMIT` | planned (BE-10) |
| `unread_thread_counts` | — | `setof {couple_question_id uuid, unread int}` | `NOT_PAIRED` | planned (BE-20) |
| `weekly_recap` | `p_week_start date` | `{days_together, replies, reactions, most_loved_answer_id, is_full bool}` | `NOT_PAIRED` | planned (BE-14) |
| `get_offer` | `p_kind text` (`intro`, `winback`) | `{eligible bool, expires_at timestamptz}`; the first call starts the 24 h clock | `NOT_PAIRED` | planned (BE-17) |
| `unpair` | — | `void`; couple becomes `ended`, readable 30 days (D08) | `NOT_PAIRED` (also on a retry after success: treat as done) | live (still deletes the couple), changes in BE-09 |

**Error format:** the exception message is exactly the code (`error.message === 'COUPLE_FULL'`). **Exception (BE-04): `accept_invite` and `invite_preview`.** A raised error rolls the transaction back, which would also roll back the record of the failed attempt that the D02 limiter needs. So when one of them rejects a typed code with `INVALID_CODE`, `INVITE_EXPIRED` or `COUPLE_FULL`, it commits the attempt and answers **HTTP 400 with the body `{"code":"P0001","message":"INVALID_CODE","details":null,"hint":null}`** (PostgREST `response.status`). supabase-js turns that into `error` exactly as for a raise, so `error.message === 'INVALID_CODE'` holds and no client branch is needed; do not rely on `data` being set. All other codes (`RATE_LIMITED`, `OWN_CODE`, `ALREADY_PAIRED`, `NOT_AUTHENTICATED`) are raised as before. Because these two RPCs return `json`, the generated type of `data` is `Json` (a couple-id string for `accept_invite`). The app maps codes to text in `src/lib/errors.ts`; an unknown code shows a generic error. Complete list: `NOT_AUTHENTICATED`, `NOT_PAIRED`, `ALREADY_PAIRED`, `INVALID_CODE`, `INVITE_EXPIRED`, `COUPLE_FULL`, `OWN_CODE`, `RATE_LIMITED`, `LIBRARY_EXHAUSTED`, `PREMIUM_REQUIRED`, `SAVER_UNAVAILABLE`, `PARTNER_ALREADY_ANSWERED`, `NUDGE_LIMIT`, `QUESTION_UNAVAILABLE`.

The same list is the Postgres enum `error_code`, exported in the generated types as `Database['public']['Enums']['error_code']` (map it exhaustively); `supabase/tests/error-codes.test.mjs` fails if this line and the enum differ. Codes are raised with SQLSTATE `P0001` (HTTP 400). Every RPC raises `NOT_AUTHENTICATED` when the JWT has no user. Every RPC except `invite_preview` is granted to `authenticated` only, so an `anon` call fails before it runs with Postgres `permission denied` (`42501`, not a code): treat it as signed out. The RPCs in the table above are the whole callable API: the RLS helpers (`my_couple_id`, `is_cq_member`, `has_answered`, `both_answered`, `answer_cq`, `message_cq`, `is_couple_premium`) live in the unexposed `private` schema (BE-24).

### Direct table access

| Action | Call | Status |
|---|---|---|
| My profile / partner profile | `from('profiles').select('*')` → 1–2 rows | live |
| Update my profile | `from('profiles').update({...}).eq('id', uid)` | live |
| Couple | `from('couples').select('*, couple_members(user_id, left_at)').eq('status','active').maybeSingle()`; ended couples (≤30 days) via `.eq('status','ended')`. Columns: `stage`, `goals`, `partner_name`, `status` (`active`/`ended`), `ended_at`, `timezone` | live (BE-03); `ended` and `left_at` are only set from BE-09 |
| Couple settings | `from('couples').update({ stage, goals, partner_name })` (also `timezone`, `relationship_start_date`); `status`, `ended_at` and ids are server-owned (`permission denied`) | live (BE-03) |
| Key dates | `from('key_dates').select('*')` / `upsert({ couple_id, kind, user_id?, date, remind_week_before }, { onConflict: 'couple_id,kind,user_id' })`; kind ∈ `together_since`, `anniversary` (one per couple, `user_id` null), `birthday` (one per member, `user_id` = that member; each partner sets only their own) | live (BE-03) |
| Question detail | `from('couple_questions').select('*, question:questions(*), answers(*)').eq('id', id).single()`; a locked partner answer is simply absent | live |
| History page | same select, `.order('created_at', { ascending: false }).range(from, to)` | live |
| Answer / edit | `from('answers').upsert({ couple_question_id, user_id: uid, body, client_written_at }, { onConflict: 'couple_question_id,user_id' })`; body 1–500 characters (D11; 501 → Postgres `23514` check violation, so cap the input at 500); thread messages stay 1–2000. **`client_written_at` (D17):** send the device time the answer was written (ISO, also when queued offline); the server clamps it to arrival time. The answer counts for the streak of local day D (the question's `assigned_for`) if `client_written_at` falls on D and it arrives before the end of D+1 in the couple's timezone; otherwise it is saved but `answers.counts_for_streak` is `false` (readable, never writable). Only `couple_question_id, user_id, body, client_written_at` are writable; `created_at` is the server's | live (BE-05, BE-06) |
| Thread | `from('thread_messages').select('*').eq('couple_question_id', id).order('created_at')` | live |
| Send message | `insert({ client_id, couple_question_id, user_id: uid, body })`; `client_id` is a device UUID reused on retry; a duplicate error means it was already sent | live |
| React | `from('reactions').upsert({ user_id: uid, answer_id, kind }, { onConflict: 'answer_id,user_id' })` or `{ user_id: uid, message_id, kind }` with `onConflict: 'message_id,user_id'`; kind ∈ `love`, `laugh`, `wow`, `spark` (enum `reaction_kind`, D14). One reaction per user per target; reacting again changes the kind; only `user_id, answer_id, message_id, kind` are updatable; you can react only to a question you have answered; remove = delete own row. `reactions.emoji` no longer exists | live (BE-05) |
| Mark thread read | `from('thread_reads').upsert({ couple_question_id, user_id: uid, last_read_at })` | live |
| Packs | `from('question_packs').select('*, pack_questions(position, question:questions(*))').order('sort_order')`. Pack columns: `slug`, `title`, `description`, `is_premium`, `sort_order`, `icon`, `age_gate` (`'18+'` or null). The launch build has no 18+ pack (D33): the loader skips it and deactivates it if present; clients only see active rows. Question columns added in BE-05: `external_id`, `stages` (`couple_stage[]`, empty = all), `special` (enum `special_question`: `first_day`, `anniversary`, `together_since`, `half_iversary`, `birthday`), `age_gate` | live (BE-05) |
| Premium state | `from('entitlements').select('*')` (rows for me + partner); premium if any `is_active` and not expired | live |
| Badges | `from('badge_awards').select('*')` | planned (BE-12) |
| Notification prefs | `from('notification_prefs').upsert({ user_id: uid, ritual_time, daily_reminder, partner_answered, replies, last_call, nudges, tips, quiet_start, quiet_end })` | planned (BE-07) |
| Register push token | `from('push_tokens').upsert({ token, user_id: uid, platform })` | live |
| Feedback | `from('feedback').insert({ user_id: uid, kind, score, tags, body, app_version })`; no reads | planned (BE-15) |
| Avatar upload | Storage bucket `avatars`, path `{uid}/avatar.jpg` | planned (BE-20) |
| AI consent (Phase 2) | `from('ai_consents').upsert(...)` | phase 2 |

**Partner status for a question** (no text needed): `answer_count` on `couple_questions`, plus whether my own answer is present. `answer_count - (mine ? 1 : 0) === 1` means the partner has answered.

### Realtime (backend publishes, mobile subscribes)

Tables in `supabase_realtime`: `couple_questions`, `answers`, `thread_messages`, `reactions`, plus `couple_members` (planned BE-20). RLS applies to events.

The app opens **one** channel, `couple:{couple_id}`:
- `postgres_changes` on `couple_questions` (filter `couple_id=eq.{couple_id}`) → invalidate today and that question.
- `answers`, `thread_messages`, `reactions` (RLS scopes them) → invalidate the affected question and thread.
- `couple_members` → the partner joined, during pairing.
- **Presence/broadcast** event `typing` `{ user_id, couple_question_id }`, sent at most every 3 s while typing, expiring after 5 s (D15). No database writes.

Events are only signals; the app always refetches instead of trusting the payload.

## 3. Edge functions (owner: backend)

Base URL: `{SUPABASE_URL}/functions/v1/`

| Function | Caller | Auth | Request | Response | Status |
|---|---|---|---|---|---|
| `notify` | DB trigger (pg_net) | `Bearer {INTERNAL_FUNCTION_SECRET}` | §4 payload | `200 {sent:n, suppressed:n}` | planned (BE-08) |
| `daily-reminder` | pg_cron every 15 min | internal secret | `{}` | `200 {sent:n}`; also sends last call (22:30) and weekly recap (Sunday) | planned (BE-19) |
| `revenuecat` | RevenueCat webhook | `Bearer {REVENUECAT_WEBHOOK_SECRET}` | RevenueCat event JSON | `200 {ok:true}`; non-2xx makes RevenueCat retry | planned (BE-18) |
| `delete-account` | App | user JWT | `{}` | `200 {ok:true}`, then the app signs out | planned (BE-16) |
| *(Phase 2)* `ai-worker`, `weekly-report` | pg_cron | internal secret | `{}` | `200` | phase 2 |

Errors: `{ "error": "CODE", "message": "human text" }` with a 4xx/5xx status.

## 4. Database → `notify` payload (owner: backend)

Sent by `AFTER INSERT` triggers (answers, thread_messages, reactions, couple_members) and by RPCs (`send_nudge`):

```json
{ "type": "answer_created" | "message_created" | "reaction_created" | "member_joined" | "nudge_sent" | "entitlement_activated",
  "record_id": "uuid",
  "couple_id": "uuid",
  "couple_question_id": "uuid | null",
  "actor_user_id": "uuid" }
```

The function loads everything else (partner, tokens, names, prefs, caps) with the service role and `push_targets_for_partner_of(p_user uuid)` → `setof {user_id, token, platform}`.

## 5. Push notification payload (owner: backend sends, mobile handles)

Copy, caps and triggers: `supabase/content/notifications.json`. Rules (D23–D24):
- at most 4 pushes per person per local day;
- per-type caps;
- quiet hours 23:00–07:00 by default;
- replies and reactions grouped within 5 min;
- each type can be switched off by its pref.

```json
{ "to": "ExponentPushToken[...]",
  "title": "...", "body": "...", "sound": "default",
  "channelId": "<type>",
  "data": { "type": "ritual_reminder" | "partner_answered" | "both_answered" | "thread_activity" | "last_call" | "nudge" | "partner_joined" | "partner_premium" | "weekly_recap",
            "url": "bonded://today" | "bonded://question/{id}" | "bonded://question/{id}/thread" | "bonded://packs" | "bonded://history/recap" } }
```

- The app routes on `data.url`; the expected screen for each URL is in `qa/fixtures/deeplinks.json`.
- Android notification channels are named by `type`.
- Message previews are at most 80 characters and only inside the push.

## 6. Subscriptions (RevenueCat): mobile + backend

- **The app calls `Purchases.logIn(supabaseUserId)` after sign-in and `logOut` on sign-out.** The RevenueCat `app_user_id` **is** the Supabase user id.
- Entitlement `premium`. Products: `yearly_trial` (7-day trial), `monthly`.
- Offerings: `default` (paywall 16, 34), `intro` (gift 15, D28), `winback` (36).
- Prices always come from the offering; nothing is hard-coded.
- The backend maps events to an `entitlements` row: `is_active`, `product_id`, `store`, `expires_at`, `updated_at`. It ignores events older than the stored `updated_at`. Fixtures: `qa/fixtures/revenuecat-events.json`.
- App premium = RevenueCat `customerInfo.entitlements.active.premium` **or** an active partner row in `entitlements`. `private.is_couple_premium()` is the server-side truth (packs, streak saver); it is not callable from the app.

## 7. Secrets and environment variables

| Name | Where | Owner |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_REVENUECAT_*`, `EXPO_PUBLIC_POSTHOG_*`, `EXPO_PUBLIC_SENTRY_DSN`, `EXPO_PUBLIC_INVITE_DOMAIN` | app `.env` / EAS secrets (see `.env.example`) | mobile |
| `INTERNAL_FUNCTION_SECRET`, `REVENUECAT_WEBHOOK_SECRET`, `REVENUECAT_REST_API_KEY`, `EXPO_ACCESS_TOKEN`, `SENTRY_DSN` | Supabase function secrets (see `supabase/functions/.env.example`) | backend |
| `INTERNAL_FUNCTION_SECRET`, functions base URL | Supabase Vault (read by pg_net triggers and cron) | backend |
| `SUPABASE_SERVICE_ROLE_KEY` | functions and QA's local seeder only; **never** in the app | backend |

## 8. Shared conventions
- IDs are UUIDs. Timestamps are `timestamptz` in UTC. Dates (`assigned_for`, `local_date`) are the couple's local date; the couple's timezone is the inviter's.
- Text limits: answers 1–500 characters, thread messages 1–2000. The DB enforces them; the app mirrors them.
- Test ids: `testID="<screenId>-<element>"` (for example `20-hold-button`), used by Maestro.
- No answer or message text in logs, analytics, Sentry or `push_log`.

## 9. Integration check (run by the lead before each milestone merge)
1. Backend: `supabase db reset` on a clean local stack; DB tests and `deno test` pass; types regenerated and committed; functions deployed to `dev`.
2. QA: contract tests pass against the merged backend; `node scripts/plan/generate.mjs --check` passes.
3. Mobile: `tsc --noEmit`, lint and Jest pass against the new types; the milestone's screens walk through on an iOS simulator and an Android emulator, signed in as two partners.
4. Release: dry-run checks on the preview build (from M2).

---

### Change log
| Date | Agent | Change | Breaking? | Ack |
|---|---|---|---|---|
| 2026-11-02 | — | Initial contracts | — | — |
| 2026-11-02 | lead | Five-agent team (backend owns DB + functions); design hand-off decisions D01–D32 added as `planned`; scheme `bonded://`; new error codes; answers 1–500; reaction kinds; notification types and rules; offerings | yes (codes, limits, scheme) | not needed: nothing is built yet |
| 2026-11-02 | lead | §1: types are generated with `node supabase/tests/gen-types.mjs` (BE-01, PGlite, no Docker); phase-2 schema moved to `supabase/migrations_phase2/` | no | — |
| 2026-11-02 | backend | §2 (BE-02): live RPCs raise exact codes (enum `error_code`, exported in types); new code `QUESTION_UNAVAILABLE` on `start_pack_question`; `unpair` raises `NOT_PAIRED` when not paired (was silent); RPCs revoked from `anon` (`42501`) | additive code; `unpair` retry now errors (nothing built on it yet) | lead (2026-11-02): accepted, nothing consumes it yet; mobile adopts it in MOB-06 `errors.ts` |
| 2026-11-02 | backend | §2 (BE-24): the 0001 RLS helpers (`my_couple_id`, `is_cq_member`, `has_answered`, `both_answered`, `answer_cq`, `message_cq`, `is_couple_premium`) moved from `public` to `private`; they disappear from the generated `Functions` types and are no longer callable with `rpc()` | removal of undocumented functions; nothing in `app/`, `src/` or `qa/` calls them | mobile, qa |
| 2026-11-02 | backend | §2 (BE-03): `create_couple` live (solo couple, enum `couple_stage`, idempotent while solo); `create_invite` raises `NOT_PAIRED` without a couple; `accept_invite` joins the inviter's couple (new order: `OWN_CODE` before the solo-caller `ALREADY_PAIRED`); `couples.stage/goals/partner_name/status/ended_at`, `couple_members.left_at`, `pair_invites.couple_id/partner_name`; `key_dates` table; couple updates limited to settings columns | yes: `create_invite` needs `create_couple` first (documented as planned); couples `status`/`ended_at`/ids no longer client-writable | mobile |
| 2026-11-02 | backend | §2 (BE-04): invites v2. `create_invite` returns `{code, expires_at, token}` (4 digits, 48 h, 192-bit link token shown once; a new call revokes the previous invite); `accept_invite(p_code, p_token?)` and `invite_preview(p_code, p_token?)` (anon) return `json`; D04: a solo caller can join (their solo couple is deleted); D02 limiter: 5 failed attempts per user (anon: per hashed IP) per 15 min → `RATE_LIMITED`, a valid token skips it, global failure cap writes an alert row; **`INVALID_CODE`/`INVITE_EXPIRED`/`COUPLE_FULL` from these two RPCs come back as an HTTP 400 body `{code:'P0001', message}` instead of a raise** so the failed attempt can be recorded (supabase-js `error.message` is unchanged); `pair_invites` gains `id`, `revoked_at`; clients can no longer write `pair_invites` | yes: `create_invite` return type (`text` → object), `accept_invite` return type (`uuid` → `json`), 6-character codes are dead, `invite_preview` is new | mobile, qa |
| 2026-11-02 | backend | §2 (BE-05): answers 1–500 characters (D11, was 2000; threads unchanged); `reactions.kind` enum (`love`, `laugh`, `wow`, `spark`) replaces `reactions.emoji`, upsert targets `answer_id,user_id` / `message_id,user_id`, own-row update allowed (D14); `get_daily_question`: day 1 = `first_day` special (D12) and daily questions respect `couple.stage`; `questions.external_id/stages/special/age_gate`, `question_packs.age_gate/icon`; idempotent content loader (`supabase/scripts/load-content.mjs`) skips 18+ packs unless `CONTENT_INCLUDE_AGE_GATED=true` and deactivates them if already loaded (D33); `supabase/seed.sql` = content + persona accounts + `dev_seed.apply_scenario(id)` for all 19 scenarios of `qa/fixtures/personas.json` (local/dev only) | yes: `reactions.emoji` removed (nothing in `app/`/`src/` used it), answers over 500 characters are rejected | mobile, qa |
| 2026-11-02 | backend | §2 (BE-06): streak v2 (D17). `answers.client_written_at` (writable, clamped to arrival) and `answers.counts_for_streak` (server-computed, read-only); an answer counts for local day D only if written on D and arrived before the end of D+1, so an online answer to yesterday's question no longer counts; a late day that fills a gap merges the streak; `get_streak()` live (composite `streak_state`); `answers` inserts/updates are column-limited (`created_at` can't be set by clients) | yes, additive for the app; behaviour change: answering the previous day's question the next day no longer extends the streak | mobile, qa |
