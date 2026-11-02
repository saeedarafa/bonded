# Bonded — MVP Architecture

> **Read with [docs/plan/DESIGN_DELTA.md](plan/DESIGN_DELTA.md).** The design hand-off (2026-11-02) changes pairing (solo couples, BND codes), unpair (30-day ended couples), notifications, offers and badges. Where this file and DESIGN_DELTA disagree, DESIGN_DELTA wins until the lead folds it in here (LEAD-02). Team and ownership: [AGENTS.md](../AGENTS.md).

A daily-question app for couples: pair with your partner, both answer today's question, answers unlock for each other, talk about it, keep a streak. Built so AI profiles and weekly reports can be added later without restructuring.

**Stack:** Expo (React Native + TypeScript) · Supabase (Postgres, Auth, Realtime, Edge Functions, Storage) · RevenueCat · Expo Push · Sentry · PostHog

---

## 1. What the reference app taught us

Findings from reverse-engineering Paired 26.43.0 (REA plus a decode of the Hermes string table), and the MVP decision each one led to:

| Paired does | MVP does | Why |
|---|---|---|
| Expo/React Native, Hermes, OTA updates through `expo-updates` | Same | Proven for this product; one codebase, OTA fixes |
| Code grouped by feature (`src/slices/questions`, `streak`, `upsell`…) | Same (`src/features/*`) | Scales cleanly as features are added |
| Custom REST API (`api.paired.run`) + Firebase Auth | Supabase: direct table access protected by RLS, plus a few RPCs | No API server to build or run |
| Ably realtime for live threads | Supabase Realtime | One less vendor; respects RLS |
| Partner answer locked until you answer (`partner_answer_locked`) | Enforced **in the database** by an RLS policy | The client can never leak it |
| Answer resend recovery ("Could not verify answer delivery before re-sending") | Upsert on `(couple_question_id, user_id)`; `client_id` on thread messages | Retries can't create duplicates |
| Free = one daily activity; Premium = packs, games, insights, journeys | Free = daily question; Premium = packs | Smallest paywall that still makes sense |
| One subscription covers both partners | `is_couple_premium()` = either partner's entitlement is active | Paired's strongest selling point |
| RevenueCat + Stripe/Paddle web checkout + many price tests | RevenueCat only, yearly plan (7-day trial) and monthly | Pricing experiments come later |
| Weekly "Relationship Insights", answer-depth meter | Phase 2 (schema in `0002_ai_phase2.sql`) | See §6 |

---

## 2. System overview

```
┌──────────────────────── Expo app (iOS + Android) ───────────────────────┐
│  Expo Router screens → feature hooks → TanStack Query cache            │
│  supabase-js (auth, PostgREST, RPC, Realtime) · RevenueCat SDK         │
│  MMKV (drafts, session) · Expo Notifications · Sentry · PostHog        │
└───────────────┬──────────────────────────────┬─────────────────────────┘
                │ HTTPS / WSS (user JWT)       │ store purchase
                ▼                              ▼
┌──────────────── Supabase ───────────────┐   ┌──────────── RevenueCat ───────────┐
│ Auth (email OTP, Apple, Google)         │   │ App Store / Play Billing          │
│ Postgres + RLS  ← all business rules    │◄──┤ webhook → edge fn `revenuecat`    │
│ Realtime (couple_questions, answers,    │   └───────────────────────────────────┘
│   thread_messages, reactions)           │
│ Edge Functions: revenuecat, notify,     │──► Expo Push API → APNs / FCM
│   daily-reminder, delete-account        │
│ pg_cron: daily-reminder every 15 min    │
│ Storage: avatars                        │
│ ── Phase 2 ── ai-worker, weekly-report  │──► LLM API (Claude), embeddings API
└─────────────────────────────────────────┘
```

**Principle:** the client is untrusted. Pairing, daily-question assignment, the reveal rule, premium gating and streaks all run in Postgres (RLS policies, `SECURITY DEFINER` functions, triggers). Edge functions only exist for things Postgres can't do: receiving webhooks, sending pushes, and calling AI.

---

## 3. Database

Full DDL: [`supabase/migrations/0001_mvp.sql`](../supabase/migrations/0001_mvp.sql)

### Entities

```
auth.users 1─1 profiles 1─0..1 couple_members *─1 couples 1─1 couple_streaks
                   │                                  │
                   ├─ push_tokens                     └─* couple_questions *─1 questions *─* question_packs
                   ├─ entitlements (RevenueCat)                │                        (pack_questions)
                   └─ pair_invites                             ├─* answers ─* reactions
                                                               ├─* thread_messages ─* reactions
                                                               └─* thread_reads
```

| Table | Purpose |
|---|---|
| `profiles` | Name, avatar, timezone, reminder time. Created by a trigger on sign-up. |
| `couples` / `couple_members` | Exactly two members; a unique index allows one couple per user. |
| `pair_invites` | 6-character code, valid 7 days. |
| `questions`, `question_packs`, `pack_questions` | The content library (editable in the Supabase dashboard at first). |
| `couple_questions` | One question for one couple: `daily` (with `assigned_for` date) or `pack`. `answer_count` is the public "partner answered" signal. |
| `answers` | One per user per couple question. |
| `thread_messages`, `reactions`, `thread_reads` | Discussion after both have answered; unread state. |
| `couple_streaks` | Current/longest streak, updated by a trigger. |
| `entitlements` | Written only by the RevenueCat webhook. |
| `push_tokens` | Expo push tokens per device. |

### Rules enforced in the database

| Rule | Where |
|---|---|
| You see your partner's answer only after answering yourself | `answers` select policy (`has_answered`) |
| Threads open only once both have answered | `thread_messages` policies (`both_answered`) |
| Both partners get the same question each day, in the couple's timezone, with no repeats | `get_daily_question()` + unique indexes |
| Pairing is atomic and one couple per person | `create_invite()`, `accept_invite()` |
| Premium packs need either partner subscribed | `start_pack_question()` → `is_couple_premium()` |
| Streak advances when both answer the daily question | `on_answer_inserted` trigger |
| Unpairing / account deletion removes shared data | `unpair()`, `on delete cascade` |

### Client API surface (no custom server)

| Call | Used for |
|---|---|
| `rpc('create_invite')`, `rpc('accept_invite', {p_code})` | Pairing |
| `rpc('get_daily_question')` | Today screen |
| `rpc('start_pack_question', {p_question})` | Opening a pack question |
| `from('answers').upsert({...}, {onConflict: 'couple_question_id,user_id'})` | Answer / edit (idempotent) |
| `from('thread_messages').insert({client_id, ...})` | Thread reply (idempotent through `client_id`) |
| `from('reactions')`, `from('thread_reads').upsert(...)` | Reactions, read receipts |
| `from('couple_questions').select('*, questions(*), answers(*)')` | History (RLS strips locked answers) |
| `rpc('unpair')` | Settings |

---

## 4. Backend (Supabase)

| Piece | Trigger | Does |
|---|---|---|
| **Auth** | — | Email one-time code, Sign in with Apple, Google. A trigger creates the `profiles` row. |
| **Edge fn `revenuecat`** | RevenueCat webhook (checks shared-secret header) | Upserts `entitlements` with the service role. Handles INITIAL_PURCHASE, RENEWAL, CANCELLATION, EXPIRATION, TRANSFER. |
| **Edge fn `notify`** | Database Webhooks on insert to `answers` and `thread_messages` | Looks up the partner's `push_tokens`, sends through the Expo Push API: "Sam answered — answer to unlock" / "Both answered!" / "New reply". Removes invalid tokens. |
| **Edge fn `daily-reminder`** | `pg_cron` every 15 min | Finds users whose `reminder_time` falls in this window in their timezone and who haven't answered today; sends a push. |
| **Edge fn `delete-account`** | Called by the app | `auth.admin.deleteUser()`; cascades remove the user's data (store-required). |
| **Storage** | — | `avatars` bucket, path `{user_id}/…`, readable by the couple. |

Secrets (in Supabase function secrets): `REVENUECAT_WEBHOOK_SECRET`, `EXPO_ACCESS_TOKEN`; later `ANTHROPIC_API_KEY` and an embeddings API key.

Environments: two Supabase projects (`dev`, `prod`); migrations in git, applied with `supabase db push`; regenerate client types with `supabase gen types typescript` after each migration.

---

## 5. Frontend (Expo)

### Libraries
Expo SDK (latest) · Expo Router · TypeScript strict · `@supabase/supabase-js` · TanStack Query · Zustand (UI state) · `react-native-mmkv` · `react-native-purchases` (+ RevenueCat UI paywall) · `expo-notifications` · `expo-apple-authentication` / Google sign-in · NativeWind · Reanimated · `@sentry/react-native` · `posthog-react-native` · EAS Build / Submit / Update.

### Folder layout

```
app/                              # Expo Router: routes only, thin
  _layout.tsx                     # providers: Query, Auth, RevenueCat, Sentry
  (auth)/sign-in.tsx
  (onboarding)/profile.tsx  pair.tsx  reminder.tsx
  (tabs)/_layout.tsx
  (tabs)/today.tsx                # daily question + streak
  (tabs)/history.tsx
  (tabs)/explore.tsx              # packs (premium)
  (tabs)/settings.tsx
  question/[id].tsx               # answer → reveal → thread
  paywall.tsx                     # modal
src/
  features/
    auth/        pairing/     daily/      answers/
    threads/     packs/       streak/     premium/
    notifications/            profile/
      └─ each: api.ts (Supabase calls) · hooks.ts (Query hooks) · components/ · types.ts
  lib/
    supabase.ts  queryClient.ts  queryKeys.ts  realtime.ts
    storage.ts (MMKV)  analytics.ts  revenuecat.ts
  ui/            # design system: Button, Card, Text, Avatar, Sheet
  types/database.ts               # generated from Supabase
```

### Data flow

- **Reads:** TanStack Query hooks (`useDailyQuestion`, `useQuestion(id)`, `useThread(id)`, `useStreak`). Cache stored in MMKV so the app opens instantly offline.
- **Writes:** mutations with optimistic updates. Answer drafts are saved to MMKV on every keystroke (`draft:{couple_question_id}`) and cleared on success.
- **Realtime:** a single `useCoupleRealtime()` subscription on app focus, filtered by `couple_id`. Events only invalidate query keys; the UI then refetches through RLS, so locked text is never pushed to the device.
- **Gating:** `usePremium()` = RevenueCat `customerInfo` **or** the partner's row in `entitlements` (covers "partner pays").
- **Deep links:** `yourapp://invite/{code}` and universal links → pairing screen pre-filled.

### Screens in the MVP
Sign-in → Onboarding (name, partner name, start date, reminder time) → Invite/enter code → **Today** (question card, partner status, streak) → **Question** (answer box → locked/revealed partner bubble → thread with reactions) → **History** → **Explore** (packs, locked for free users) → **Paywall** → **Settings** (reminder, unpair, delete account, restore purchases, privacy/terms).

---

## 6. AI-ready design (Phase 2)

DDL: [`supabase/migrations/0002_ai_phase2.sql`](../supabase/migrations/0002_ai_phase2.sql). The MVP already collects everything the AI needs (answers with timestamps, question category/depth, couple links), so Phase 2 only adds tables.

### Pipeline

```
answer insert/edit ──trigger (if consent)──► ai_jobs: analyze_answer
                                                   │  pg_cron → edge fn ai-worker (batch of N)
                                                   ▼
                                  small, fast LLM → answer_signals
                                  {themes, sentiment, depth_score, risk_flag} + embedding
                                                   │
Sunday night  pg_cron ──► ai_jobs: user_profile  ──► larger LLM reads last N signals + previous profile
                                                   ▼
                                  user_ai_profiles (versioned summary + traits JSON)
                                                   │
              pg_cron ──► ai_jobs: weekly_report ──► larger LLM reads both profiles + this week's
                                                   │  REVEALED answers (both answered) only
                                                   ▼
                                  weekly_reports (status ready | insufficient_data) → push "Your report is ready"
```

### Design rules
1. **Consent per person and per feature** (`ai_consents`). No model call without it, and turning it off deletes that person's signals and profile.
2. **The couple report only uses answers both partners have already seen.** An unrevealed answer is never fed into anything the partner can read.
3. **Personal profiles are private** (RLS: owner only). The couple report is shared.
4. **Safety first:** `risk_flag` (crisis or abuse language) skips report generation and shows crisis-support resources in the app instead of an insight.
5. **Structured outputs:** every model call returns JSON validated against a schema; `model` and `prompt_version` are stored on every row so you can re-run and compare.
6. **Cost control:** answers are analysed once (or again when edited) by a small model. The expensive model runs once per user and once per couple per week, on pre-digested signals rather than raw history. `insufficient_data` when fewer than ~4 answers that week (Paired does the same: "not enough in-depth answers").
7. **Provider hygiene:** use an API with no training on your data and the shortest retention available; say so in the privacy text.
8. **Embeddings** (pgvector) power "suggest a question about what you've been discussing" and theme trends; the vector dimension must match the embedding model you choose.

### Phase-2 additions to the app
Answer-depth hint while typing (client-side heuristic first, model later) · "My profile" screen · Weekly Report screen + push · AI consent screen · question recommendations from `answer_signals.themes`.

---

## 7. Build order

| Week | Deliverable |
|---|---|
| 1 | Expo + EAS project, Supabase dev/prod, `0001` migration, auth, TestFlight / Play internal track live |
| 2 | Onboarding, pairing (invite codes + deep links), Today screen with `get_daily_question` |
| 3 | Answer → locked → reveal, thread, reactions, realtime, drafts |
| 4 | Push (`notify`, `daily-reminder`), streaks, history |
| 5 | Packs + RevenueCat paywall + `revenuecat` webhook, settings, delete account |
| 6 | 150+ original questions, Sentry/PostHog events, store listings, submit |

**Not in the MVP:** games/quizzes, journeys, missions, streak freezes, widgets, web checkout, price experiments, Braze/AppsFlyer/Intercom, and the AI features (schema ready).

## 8. Analytics events (PostHog)
`signed_up`, `pair_invite_created`, `paired`, `daily_question_viewed`, `answer_submitted`, `answer_revealed`, `thread_message_sent`, `streak_extended`, `paywall_viewed`, `trial_started`, `subscribed`. The two numbers that matter: **pair rate** (sign-ups that end up paired) and **both-answered rate** (days where both partners answer).
