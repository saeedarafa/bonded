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
| Packs screen 33 / scenario `free-couple-packs` | E2E (todo, after mobile's D51 change) | no free question tile; every row opens the paywall |

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
| Streak, saver, badges | BE-06/11/12 | QA-03 | — | MOB-10 | `daily-loop.yaml` | todo |
| Offline | — | — | — | MOB-14 | `offline-answer.yaml` | todo |
| Notifications | BE-07 | — | BE-08/19 | MOB-15 | push routing | todo |
| History + recap | BE-14/20 | QA-03 | — | MOB-16 | `history.yaml` | todo |
| Purchases | entitlements lockdown | QA-06 `purchases.test.ts` (webhook over HTTP, partner premium, push caps) | BE-18 + QA-06 harness | MOB-19 + QA-06 `qa/app/purchases.test.tsx` (restore, 57, server-confirmed 35) | `purchases/paywall-sandbox.yaml`, `purchases/restore-sandbox.yaml` (manual store sheet, `qa/purchases/README.md`) | automated; sandbox runs pending ACCOUNTS 8/9; push delivery blocked by #126 |
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
