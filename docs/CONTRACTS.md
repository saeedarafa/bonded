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
src/types/database.ts        backend   generated: supabase gen types typescript --local > src/types/database.ts
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
| `create_couple` | `p_stage text, p_goals text[], p_partner_name text` | `uuid` couple id (solo couple, D03) | `NOT_AUTHENTICATED`, `ALREADY_PAIRED` | planned (BE-03) |
| `create_invite` | — | `{code text, expires_at timestamptz}`; code = 4 digits, shown as `BND·1234` (D01) | `NOT_AUTHENTICATED`, `NOT_PAIRED`, `COUPLE_FULL` | live, changes in BE-04 |
| `invite_preview` | `p_code text` (callable by **anon**) | `{inviter_name, inviter_avatar_url, inviter_answered_today bool, expires_at}` | `INVALID_CODE`, `INVITE_EXPIRED`, `COUPLE_FULL`, `RATE_LIMITED` | planned (BE-04) |
| `accept_invite` | `p_code text` (`BND`, spaces and `·` ignored) | `uuid` couple id | `NOT_AUTHENTICATED`, `INVALID_CODE`, `INVITE_EXPIRED`, `COUPLE_FULL`, `OWN_CODE`, `ALREADY_PAIRED`, `RATE_LIMITED` | live, changes in BE-04 |
| `get_daily_question` | — | `couple_questions` row (day 1 = special `first_day`, D12) | `NOT_PAIRED`, `LIBRARY_EXHAUSTED` | live, works for solo couples in BE-03 |
| `start_pack_question` | `p_question uuid` | `couple_questions` row | `NOT_PAIRED`, `PREMIUM_REQUIRED` | live |
| `get_streak` | — | `{current int, longest int, last_completed_on date, saver_available bool}`; `current` is already 0 after a missed day | `NOT_PAIRED` | planned (BE-06) |
| `use_streak_saver` | — | `get_streak` shape | `NOT_PAIRED`, `PREMIUM_REQUIRED`, `SAVER_UNAVAILABLE` | planned (BE-11) |
| `send_nudge` | — | `void` | `NOT_PAIRED`, `PARTNER_ALREADY_ANSWERED`, `NUDGE_LIMIT` | planned (BE-10) |
| `unread_thread_counts` | — | `setof {couple_question_id uuid, unread int}` | `NOT_PAIRED` | planned (BE-20) |
| `weekly_recap` | `p_week_start date` | `{days_together, replies, reactions, most_loved_answer_id, is_full bool}` | `NOT_PAIRED` | planned (BE-14) |
| `get_offer` | `p_kind text` (`intro`, `winback`) | `{eligible bool, expires_at timestamptz}`; the first call starts the 24 h clock | `NOT_PAIRED` | planned (BE-17) |
| `unpair` | — | `void`; couple becomes `ended`, readable 30 days (D08) | `NOT_PAIRED` | live, changes in BE-09 |

**Error format:** the exception message is exactly the code (`error.message === 'COUPLE_FULL'`). The app maps codes to text in `src/lib/errors.ts`; an unknown code shows a generic error. Complete list: `NOT_AUTHENTICATED`, `NOT_PAIRED`, `ALREADY_PAIRED`, `INVALID_CODE`, `INVITE_EXPIRED`, `COUPLE_FULL`, `OWN_CODE`, `RATE_LIMITED`, `LIBRARY_EXHAUSTED`, `PREMIUM_REQUIRED`, `SAVER_UNAVAILABLE`, `PARTNER_ALREADY_ANSWERED`, `NUDGE_LIMIT`.

### Direct table access

| Action | Call | Status |
|---|---|---|
| My profile / partner profile | `from('profiles').select('*')` → 1–2 rows | live |
| Update my profile | `from('profiles').update({...}).eq('id', uid)` | live |
| Couple | `from('couples').select('*, couple_members(user_id, left_at)').eq('status','active').maybeSingle()`; ended couples (≤30 days) via `.eq('status','ended')` | planned (BE-03, BE-09) |
| Couple settings | `from('couples').update({ stage, goals })` | planned (BE-03) |
| Key dates | `from('key_dates').select('*')` / `upsert({ couple_id, kind, user_id?, date, remind_week_before })` | planned (BE-03) |
| Question detail | `from('couple_questions').select('*, question:questions(*), answers(*)').eq('id', id).single()`; a locked partner answer is simply absent | live |
| History page | same select, `.order('created_at', { ascending: false }).range(from, to)` | live |
| Answer / edit | `from('answers').upsert({ couple_question_id, user_id: uid, body, client_written_at }, { onConflict: 'couple_question_id,user_id' })`; body 1–500 (D11) | live; 500 and `client_written_at` in BE-05/BE-06 |
| Thread | `from('thread_messages').select('*').eq('couple_question_id', id).order('created_at')` | live |
| Send message | `insert({ client_id, couple_question_id, user_id: uid, body })`; `client_id` is a device UUID reused on retry; a duplicate error means it was already sent | live |
| React | `from('reactions').upsert({ user_id: uid, answer_id \| message_id, kind })`, kind ∈ `love`, `laugh`, `wow`, `spark` (D14); remove = delete own row | planned (BE-05) |
| Mark thread read | `from('thread_reads').upsert({ couple_question_id, user_id: uid, last_read_at })` | live |
| Packs | `from('question_packs').select('*, pack_questions(position, question:questions(*))').order('sort_order')` | live |
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
- App premium = RevenueCat `customerInfo.entitlements.active.premium` **or** an active partner row in `entitlements`. `is_couple_premium()` is the server-side truth (packs, streak saver).

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
