# Backlog

**Owner:** lead architect. Only the lead adds, removes, re-scopes or re-assigns tasks. Each agent reports progress in its own `docs/plan/status/<agent>.md`, never here.

- Screen IDs come from `design-handoff/screens.json`; priorities and milestones from [SCOPE.md](SCOPE.md).
- Decisions `Dnn` are in [DESIGN_DELTA.md](DESIGN_DELTA.md).
- **Prio:** P0 = launch blocker · P1 = launch if on time · P2 = after launch.
- **Deps** must be merged to `main` before the task can be finished. A task can start earlier against the contract.

## How the agents run in parallel

```
week   1            2            3            4            5            6            7
LEAD   setup ─ kickoff ─ contracts ─ M1 merge ─ M2 merge ─ M3 merge ─ M4 merge ─ RC go/no-go ─ launch
BE     types+seed ▶ couples/invites ▶ streak, unpair ▶ notify, reminders ▶ RevenueCat, delete ▶ prod
MOB    scaffold, theme, components ▶ onboarding, pairing ▶ daily loop ▶ push, history ▶ paywall, settings ▶ a11y, store
QA     harness, fixtures ▶ contract tests ▶ two-device E2E ▶ push tests ▶ purchase tests ▶ full regression
REL    requirements matrix ▶ dry run on M2 build ─────────────────▶ RC validation ▶ store checks
SEC    pairing design review (D02, D06) ──────────────────────────▶ full audit ▶ fix verification
```

**The unblocking rule:** BE-01 (types + seed on `dev`) is the first thing that lands. Mobile and QA work against `docs/CONTRACTS.md` and the local stack (`supabase start` + seed) from day 1. Nobody waits for a deployed backend.

## Lead architect

| ID | Task | M | Prio | Deps | Done when |
|---|---|---|---|---|---|
| LEAD-00 | `git init`, GitHub repo, protected `main` (PR + green CI + 1 review), `CODEOWNERS` from AGENTS.md, PR template | M1 | P0 | — | Agents can open PRs from their worktrees |
| LEAD-01 | Kickoff: walk the product owner through DESIGN_DELTA open questions; record answers | M1 | P0 | — | No `needs-PO` row blocks M2 |
| LEAD-02 | Keep `ARCHITECTURE.md` and `CONTRACTS.md` in step with DESIGN_DELTA as BE tasks land | all | P0 | — | Every merged decision is in CONTRACTS with a change-log line |
| LEAD-03 | Accounts checklist for the PO: Supabase `dev`/`prod`, Expo/EAS, RevenueCat, Apple Developer, Google Play, Sentry, PostHog, domain | M1 | P0 | — | `docs/plan/ACCOUNTS.md` checklist done (credentials stay with the PO) |
| LEAD-04 | Invite domain: static site with AASA, `assetlinks.json`, `/j/{code}` fallback page (store badges), OG image from J1 | M3 | P1 | LEAD-03 | Link opens the app on both platforms, store page otherwise |
| LEAD-05 | Milestone integration: merge order BE → MOB → QA, run CONTRACTS §9, tag `m1`…`m6` | all | P0 | — | Tag on `main`, status files updated |
| LEAD-06 | RC go/no-go from the REL report + SEC report | M5 | P0 | REL-04, SEC-02 | Written decision in `docs/plan/status/lead.md` |
| LEAD-07 | Store listing copy and feature graphic (62) with the PO | M6 | P0 | — | Copy within store limits, no fake ratings (D31) |
| LEAD-08 | Content drafts (D34): an agent drafts original questions, packs, badges and notification copy on `content/D34-drafts` for the PO to edit and approve | M3–M4 | P0 | BE-05 | PO-approved copy merged by end of M4; rows `status=approved` (HYG-05) |

## Backend / data developer

| ID | Task | M | Prio | Deps | Done when |
|---|---|---|---|---|---|
| BE-01 | Local stack + `dev` project; move `0002` to `supabase/migrations_phase2/`; apply `0001`; generate `src/types/database.ts`; DB tests in CI | M1 | P0 | LEAD-00 | Types on `main`; `supabase db reset` + tests green in CI |
| BE-02 | Error codes migration: every RPC raises exactly the codes in CONTRACTS §2 (including D05, D16, D18) | M1 | P0 | BE-01 | Tests assert each code |
| BE-03 | Couples v2 (D03, D10): solo couple, `create_couple(stage, goals, partner_name)`, `key_dates`, couple `status` | M1 | P0 | BE-02 | Tests: solo couple gets a daily question; joiner inherits stage/dates |
| BE-04 | Invites v2 (D01, D02, D04, D05, D06): `BND`+4 digits, 48 h, one active per inviter, rate limits, `invite_preview` for anon; link token `t` (D02: ≥128 bits, stored hashed, skips the failed-attempt limit) | M1 | P0 | BE-03 | Tests for every error code, the limit and solo-couple merge; SEC-01 reviewed |
| BE-26 | D02 typed-code approval: `accept_invite` without a valid token returns a pending `join_request`; `approve_join` / `decline_join` (inviter only), 15-min expiry, decline/expiry counts as a failed attempt; `join_requests` in realtime; CONTRACTS §2 + error codes | M2 | P0 | BE-04c (#1) | Tests: typed code never pairs without approval; token link still pairs at once; only the inviter can approve; expiry |
| BE-27 | Supabase Auth email templates support both link sign-in and six-digit OTP; explicitly allow `bonded://auth/callback`. Hosted check now on `bonded-dev` (`nyqbrsqqalygydtwvybb`): read the auth config (GET only) and confirm Site URL, redirect allow-list and OTP 6; templates wait for custom SMTP (ACCOUNTS 16). Never `nciyrepyphvksusoigzx` | M2 | P0 | — | Local templates contain the confirmation URL and token; callback redirect is allow-listed |
| BE-28 | D36: `invite_link()` returns `{code, expires_at, token}` for the caller's open invite with a **new** link token; the code and earlier tokens stay valid; tokens hashed, ≥128 bits, max 10 per invite (`RATE_LIMITED`); null when no open invite; `accept_invite`/`invite_preview` accept any of the invite's tokens; CONTRACTS §2 + change log | M2 | P0 | BE-04 | Tests: code unchanged after `invite_link`; old and new links both join; revoked/expired/used invite → null or rejected; 11th token → `RATE_LIMITED`; another user can't get a token for my invite; SEC signs off |
| BE-29 | Issue #50 (SEC-01): `hardening.test.mjs` own-answer UPDATE check is vacuous (no `RETURNING`); re-read the body privileged and assert unchanged | M2 | P1 | — | Assertion goes red when only the own-answer UPDATE pair-period guards are removed; policies unchanged |
| BE-30 | Issue #57 (QA-BUG-4): concurrent `approve_join` on one invite: loser gets `COUPLE_FULL`, counted against the requester, request left pending; should be `JOIN_REQUEST_EXPIRED` (400 body, uncounted, request expired) as in the sequential case | M2 | P2 | BE-26 | QA's join-requests test tightened to `JOIN_REQUEST_EXPIRED` and green (merged #60) |
| BE-31 | **Proposed, waiting for PO go.** `active` column in `supabase/content/questions.csv` and `packs.csv` (default `true`): the loader upserts it, and inactive questions/packs are never newly assigned; history and already-assigned questions are kept. PO owns the CSV values | M3 | P2 | BE-05 | Test: an inactive question is never assigned and an inactive pack is hidden; past answers still readable; reveal rule green |
| BE-32 | **Proposed, waiting for PO go.** Load content (questions, packs, badges; no personas or test users) into `bonded-dev` (`nyqbrsqqalygydtwvybb`) automatically after a merge to `main`, idempotently, never into production. Today bonded-dev has no questions | M2 | P1 | BE-05, BE-27 | After a merge, bonded-dev has the current CSV content; a re-run changes nothing; the job refuses any ref except the dev ref |
| BE-05 | Content model (D11, D12, D14): answers 1–500, `reactions.kind`, special questions, `first_day`; idempotent loader for `supabase/content/*.csv` (skips `age_gate = 18+` packs and their questions unless `CONTENT_INCLUDE_AGE_GATED=true`, D33); `seed.sql` built from the content + `qa/fixtures/personas.json` | M1 | P0 | BE-02 | `supabase db reset` loads content + all 10 personas scenarios |
| BE-24 | Move the `0001` SECURITY DEFINER helpers (`is_couple_premium`, `answer_cq`, …) out of the exposed API into `private`; RLS keeps working | M1 | P0 | BE-02 | Test: `anon` and other couples can't call them as RPCs; reveal-rule suite still green; SEC-01 checks it |
| BE-23 | `supabase/functions/_shared` (admin, auth, http, push, log); all functions stubbed with auth; `deno lint/check/test` in CI | M1 | P0 | LEAD-00 | Stubs deployed to `dev` |
| BE-06 | Streak v2 (D17): `get_streak()`, `client_written_at` grace window, concurrent `get_daily_question` test | M2 | P0 | BE-05 | Tests: missed day → 0; offline answer counts for D |
| BE-07 | `notification_prefs` (D23) replacing `profiles.reminder_time`; timezone check constraint; `push_tokens` RLS | M2 | P0 | BE-02 | Tests: invalid timezone rejected; own prefs only |
| BE-09 | Ended couples (D08, D09): `unpair()` → `ended`, `left_at`, 30-day read access, purge cron | M2 | P0 | BE-03 | Tests: both can read ended couple ≤30 days, can pair again, purge removes it |
| BE-25 | D04: `accept_invite` ends the joiner's solo couple (D08 archive) instead of deleting it; keep the BE-04c lock order (F5) | M2 | P0 | BE-04c (#1), BE-09 (#5) | Tests: the joiner reads their solo answers ≤30 days, the partner never does, the purge removes it |
| BE-20 | `unread_thread_counts()`, history indexes, `couple_members` in realtime, avatars bucket + policies | M2 | P0 | BE-05 | Tests for counts and storage policies |
| BE-20b | Inviter avatar in `invite_preview` (D06) via a short-lived signed URL from an edge function, only with a valid `p_token`; `avatars` bucket stays private. Until then `inviter_avatar_url` is `null` and J2 shows the initial (lead, 2026-11-03) | M3 | P1 | BE-20 | Signed URL expires; no URL without a valid token; security review |
| BE-08 | `notify` (D23–D25, D29): push types, `push_log` caps (4/day, per type), quiet hours, 5-min grouping, `pg_net` triggers via Vault | M3 | P0 | BE-07, BE-23 | Unit tests with a fake clock; a real push on `dev` |
| BE-19 | `daily-reminder` + last call (22:30, streak ≥3 at risk): `due_reminders`, `reminder_log`, pg_cron 15 min | M3 | P0 | BE-08 | Running twice in a window sends once |
| BE-10 | `send_nudge()` (D16) | M3 | P0 | BE-08 | Tests: 1/day, only while partner hasn't answered |
| BE-12 | Badges (D19): catalogue from `badges.csv`, `badge_awards` trigger on streak advance | M3 | P1 | BE-06 | Tests: 1, 3, 7 awarded once each |
| BE-18 | `revenuecat` webhook (CONTRACTS §6); `partner_premium` push | M4 | P0 | BE-23 | Fixture test per event in `qa/fixtures/revenuecat-events.json` |
| BE-16 | `delete-account` function + cascade (D09); optional RevenueCat subscriber delete | M4 | P0 | BE-09 | Test: partner keeps own answers, couple `ended` |
| BE-11 | `use_streak_saver()` (D18) | M4 | P0 | BE-06, BE-18 | Tests: premium only, once per month, one missed day only |
| BE-15 | `feedback` table (D22) | M4 | P1 | BE-02 | Insert-own only; no client reads |
| BE-14 | `weekly_recap()` + Sunday push (D21: free = days together only; the rest premium) | M4 | P1 | BE-06, BE-08 | Tests on the seeded "streak 11" couple |
| BE-17 | `couple_offers` + `get_offer(kind)` (D28) | M4 | P1 | BE-18 | Real 24 h expiry; once per couple |
| BE-22 | Prod: advisors clean, migrations + functions to `prod`, secrets, RevenueCat prod webhook, runbook | M5 | P0 | all P0 BE | Runbook in `supabase/functions/README.md` |
| BE-13 | Special-day questions (D20) | later | P2 | BE-03 | — |

## Mobile app developer

| ID | Task | M | Prio | Deps | Done when |
|---|---|---|---|---|---|
| MOB-01 | Expo app, TS strict, ESLint/Prettier, Expo Router with the route groups in SCOPE.md | M1 | P0 | LEAD-00 | App boots on both simulators |
| MOB-02 | `app.config.ts` (scheme `bonded`, bundle ids D30), EAS profiles; internal TestFlight + Play internal build in week 1 (the store upload waits for the D30 bundle id; dev builds use the placeholder) | M1 | P0 | LEAD-03 | Installable dev builds on real devices |
| MOB-03 | Theme from `design-handoff/tokens` into `src/ui/theme.ts`; fonts; light/dark; `personColors` (63–66) | M1 | P0 | MOB-01 | No hard-coded colours in `src/` (lint rule) |
| MOB-29 | i18n scaffold: every string through `t()`; English catalogue | M1 | P0 | MOB-01 | Lint rule against raw strings in JSX |
| MOB-04 | Component library (DESIGN.md §7, all states) + dev-only gallery route `/dev/gallery` (54) | M1–M2 | P0 | MOB-03 | Every component in gallery, light and dark, 200% font |
| MOB-05 | `Mascot` (6 moods, sizes, a11y labels, still pose with reduced motion) | M1 | P0 | MOB-03 | Gallery shows all moods |
| MOB-06 | Data layer: supabase client, TanStack Query + MMKV persister, query keys, `errors.ts` (all CONTRACTS codes), realtime hook skeleton | M1 | P0 | BE-01 | Typed against `Database`; no `any` |
| MOB-07 | Onboarding story + quiz (01–07); answers kept locally, written after sign-in | M2 | P0 | MOB-04, BE-03 | Walkthrough on both platforms |
| MOB-08 | Auth (08, J4): Apple, Google, email link + OTP; auth gate; deep links `bonded://` + `https://[your-domain]/j/{code}?t=` (D02 token, D07); P1 deferred link via Install Referrer + iOS clipboard opt-in only | M2 | P0 | MOB-06 | Email entry visibly requests the address; cold/warm email sign-in link establishes a session; manual six-digit OTP and invite links still work |
| MOB-09 | Pairing: inviter (10–13), joiner (J2, J3, J5, J9, J10, 56), partner-joined detection | M2 | P0 | MOB-08, BE-04 | Two-simulator pairing with every error state |
| MOB-32 | D02 pending join: joiner "Waiting for <name> to confirm" (after 12/J5), inviter approve/decline on 10/11; the approve card names who is asking (`requester_name` from `pending_join_requests()`, refetched on `join_requests` Realtime; empty name → neutral copy) (SEC-04 F1); no hand-off screen, built from existing components, PO reviews. Includes mobile's ack of the breaking `accept_invite` change on #41 | M2 | P0 | MOB-09, BE-26 | Typed-code join only completes after approval; the inviter sees the requester's first name before approving; decline, expiry, `JOIN_REQUEST_FORBIDDEN` (declined) and `RATE_LIMITED` (3 pending) states reachable |
| MOB-33 | D36: never replace a shared code silently: 10 shows the open invite from `pair_invites` (no auto `create_invite` when one is open), "Make a new code" confirms first; solo Today card "Waiting for <partner> · BND·xxxx" (Copy, Share → 10); Settings "Invite partner" row; D37: "Join my partner instead" entry on 10, 11, the Today card and Settings → signed-in code entry, with an archive confirmation; Share link uses `invite_link()` when no token is in memory (until BE-28 lands, share the code text only) | M2 | P0 | MOB-09, BE-28 (link only) | After answering and after an app restart the same code is visible; the code is only replaced via the confirmed button; Jest tests |
| MOB-34 | REL-03b small-screen fixes: #65 (sev 3, J7/19/20 on iPhone SE: keep the answer field visible above the pinned Lock in with the keyboard open; at 200% text 19's field must not start under the button; 20 body not squeezed) · #66 (sev 4, 07 keyboard covers Continue; Today header doesn't scroll at AX5) · #68 (review prompt in first session: never in a session that began with sign-in/onboarding) · #37 leftovers (J5, 56, J10) | M2 | P1 | MOB-17 | Release re-run of the SE rows + #68 passes; unit test for the review-session rule |
| MOB-35 | J2: for token links, call the `invite-preview` Edge endpoint (BE-20b, #69) to show the inviter's signed avatar; fall back to SQL `invite_preview` and the initial on any error | M2 | P2 | BE-20b | Test: avatar shown from the signed URL; 401/500/timeout falls back to the initial; no token in logs |
| MOB-10 | Today states (18, 23, 24, 28): countdown, streak chip, badge ladder, nudge | M2 | P0 | MOB-06, BE-06 | All states reachable from seeded personas |
| MOB-11 | Answer (19, J7), hold to reveal (20), revealed + reactions (21); drafts in MMKV | M2 | P0 | MOB-10, BE-05 | Reveal rule visible end to end; haptics as DESIGN.md §6 |
| MOB-12 | Thread (22): optimistic send with `client_id`, typing presence (D15), unread | M2 | P0 | MOB-11, BE-20 | Duplicate send impossible on retry |
| MOB-13 | `useCoupleRealtime()` per CONTRACTS §2 | M2 | P0 | MOB-06 | Partner answering updates Today within 2 s |
| MOB-14 | Offline queue (55) + banner; `client_written_at` | M3 | P0 | MOB-11, BE-06 | Airplane-mode answer syncs and counts for the day |
| MOB-15 | Push: soft-ask (09, J6), token registration, tap routing incl. cold start, foreground toast (37) | M3 | P0 | BE-07 | Each push type routes to the right screen |
| MOB-16 | History (29, 30, 53) | M3 | P0 | BE-20 | Heatmap matches seeded history |
| MOB-17 | Milestone modal + in-app review (25), badges (52, 52b) | M3 | P1 | BE-12 | Review prompt never on first session |
| MOB-28 | Key dates (47) P1; milestones (48), personal milestone (49, 50), anniversary (51) P2 | M3 | P1 | BE-03 | — |
| MOB-19 | RevenueCat: `logIn(user.id)`, `usePremium()`, paywalls (16, 17, 34, 35, 57, J8), restore | M4 | P0 | BE-18 | Sandbox purchase on both stores; partner sees premium |
| MOB-20 | Packs (32, 33): first question free, locked rows → paywall | M4 | P0 | MOB-19 | `PREMIUM_REQUIRED` handled |
| MOB-21 | Streak saver UI (28), weekly recap (31) | M4 | P0/P1 | BE-11, BE-14 | — |
| MOB-18 | Us & settings (40–43), notification settings, unpair, delete (type DELETE), partner left (58) | M4 | P0 | BE-07, BE-09, BE-16 | Delete account reachable in ≤3 taps from Us |
| MOB-23 | Private feedback (27) P1, monthly check-in (26) P2 | M4 | P1 | BE-15 | — |
| MOB-22 | Gift (14, 15) P1, win-back (36) P2; server countdown | M4 | P1 | BE-17 | Countdown matches server `expires_at` |
| MOB-27 | History PDF export (58) | M4 | P1 | MOB-16 | — |
| MOB-24 | PostHog events + Sentry with source maps; scrub user text | M5 | P0 | — | QA-08 privacy check passes |
| MOB-25 | Accessibility + platform pass: Dynamic Type 200%, labels, reduced motion, 44 pt, Android back, edge-to-edge | M5 | P0 | — | REL a11y checks pass |
| MOB-26 | Store-mode build + screenshots (60, 61), icons/splash from `design-handoff/assets/icon` | M6 | P0 | — | Exports at the sizes in L5 spec |
| MOB-31 | Animated mascot (D32): Rive state machine behind the `Mascot` API, still pose with reduced motion | M3 | P0 | MOB-05, Rive file from PO | Every mood animates on both platforms; A11Y-03 passes |
| MOB-30 | Widgets (38, D26): WidgetKit + Glance via Expo config plugin; tap opens Today; never shows a partner answer before I answered (FUN-04) | M4–M5 | P0 | MOB-10, MOB-13 | Home + lock-screen widgets on both platforms; reveal-rule check covers the widget |

## QA / automation engineer

| ID | Task | M | Prio | Deps | Done when |
|---|---|---|---|---|---|
| QA-01 | `qa/TEST_PLAN.md` live; CI workflows: DB tests, `deno test`, app `tsc`/lint/Jest, `generate.mjs --check`, `scripts/agents/sync.mjs --check` | M1 | P0 | LEAD-00 | Every PR runs the suite; required check on `main` |
| QA-02 | Scenario seeding: `qa/scripts/seed-scenario.ts` puts the local stack into any persona scenario from `qa/fixtures/personas.json` | M1 | P0 | BE-05 | `npm run qa:scenario streak-11-waiting` works |
| QA-03 | Contract tests: two signed-in users against the local stack, one test per RPC + error code + RLS row in CONTRACTS §2 | M2 | P0 | BE-04 | Fails when a contract drifts |
| QA-04 | Maestro E2E on two simulators: pair, answer, reveal, thread; joiner errors J9/J10/56 | M2–M3 | P0 | MOB-09, MOB-11 | Runs nightly + on release branches |
| QA-10 | Contract tests for BE-26 (D02 approval) and BE-25 (D04 solo archive) | M2 | P0 | BE-25, BE-26 | Fails if a typed code pairs without approval |
| QA-11 | Email authentication verification (D35): remove the `fetch-otp` fallback (#28 fixed); check the sign-in email contains a 6-digit code and a working `bonded://auth/callback` link; manual OTP and link callback on cold/warm launches, including expired-link recovery | M2 | P0 | BE-27, MOB-08 | Local email round-trip signs in by either method; the e2e reads the code from the email only; expired link returns to a usable sign-in screen |
| QA-12 | D36: contract tests for `invite_link()`; E2E: invite → answer first → restart → the same code shows on Today and 10, and the partner joins with it; D37: a solo account (signed up without a code) joins a partner by typed code from Today, its own space is archived | M2 | P0 | BE-28, MOB-33 | Fails if re-opening 10 changes the code |
| QA-05 | Notification tests: caps, quiet hours, grouping, payload schema (`qa/fixtures/push-payloads.json`), deep links (`qa/fixtures/deeplinks.json`) | M3 | P0 | BE-08 | — |
| QA-06 | Purchase tests: webhook fixtures, sandbox scripts, partner premium, restore, payment failed (57) | M4 | P0 | BE-18, MOB-19 | — |
| QA-07 | Visual + a11y regression: gallery screenshots light/dark/200% font, axe-style label checks | M3–M5 | P1 | MOB-04 | Baselines committed |
| QA-08 | Privacy checks: no answer/message text in analytics, Sentry, logs (automated grep on captured payloads) | M5 | P0 | MOB-24, BE-08 | — |
| QA-09 | Full regression on RC build; bugs as GitHub issues labelled `bug`, `sev:1-4`, `area:*` | M5 | P0 | all P0 | Zero open sev-1/sev-2 |

## Mobile release validation

| ID | Task | M | Prio | Deps | Done when |
|---|---|---|---|---|---|
| REL-01 | Keep `qa/release/RC_CHECKLIST.md` and `screen-requirements.csv` current with scope | M1–M2 | P0 | — | Every P0 screen and rule has a check |
| REL-02 | Business-rule checks (D27, D31, prices from RevenueCat, trial copy, restore, delete reachable) | M2 | P0 | — | Checks in RC_CHECKLIST §BIZ |
| REL-03 | Dry-run validation on the M2 internal build, both platforms | M2 | P0 | MOB-09, MOB-11 | Report in `qa/release/reports/` |
| REL-04 | RC validation (M5) and store-submission validation (M6): privacy labels, data safety, age rating (Spicy pack held at launch, D33), review notes + demo account | M5–M6 | P0 | QA-09 | Signed report: GO or NO-GO with evidence |

## Security reviewer (existing agent)

| ID | Task | M | Prio | Deps | Done when |
|---|---|---|---|---|---|
| SEC-01 | Guidance review of pairing: D02, D06, `invite_preview`, rate limits, RLS of solo/ended couples | M1–M2 | P0 | BE-04 | Findings handed to the lead |
| SEC-02 | Full audit of app + Supabase before RC | M5 | P0 | all P0 | Report; no open confirmed high/critical |
| SEC-03 | Verify fixes | M5 | P0 | SEC-02 | — |
