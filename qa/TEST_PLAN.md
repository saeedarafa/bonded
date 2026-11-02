# Test plan

**Owner:** QA automation engineer. The method is in the `bonded-test-automation` skill; this file tracks **what** is covered.

## Release blockers (must have a passing automated test at every merge)
1. Reveal rule: a partner's answer is invisible until I answer: select, RPC, realtime, push.
2. Couple isolation: another couple's user never reads or writes our rows.
3. Same daily question for both partners on the couple's local day; one row under concurrency.
4. Pairing errors: `INVALID_CODE`, `INVITE_EXPIRED`, `COUPLE_FULL`, `OWN_CODE`, `ALREADY_PAIRED`, `RATE_LIMITED`.
5. Premium: either partner's entitlement unlocks packs for both; `entitlements` is not writable by clients.
6. Delete account removes the user's content and leaves the partner's.
7. No user text in analytics, Sentry or logs.

## Coverage map (update as suites land)
| Area | DB | Contract | Functions | Component | E2E | Status |
|---|---|---|---|---|---|---|
| Pairing (D01–D06) | BE-04 | QA-03 | — | MOB-09 | `pairing-*.yaml` | todo |
| Daily question + reveal | existing 23 tests | QA-03 | — | MOB-11 | `daily-loop.yaml` | partly (DB) |
| Thread + reactions + typing | existing | QA-03 | — | MOB-12 | `thread.yaml` | partly (DB) |
| Streak, saver, badges | BE-06/11/12 | QA-03 | — | MOB-10 | `daily-loop.yaml` | todo |
| Offline | — | — | — | MOB-14 | `offline-answer.yaml` | todo |
| Notifications | BE-07 | — | BE-08/19 | MOB-15 | push routing | todo |
| History + recap | BE-14/20 | QA-03 | — | MOB-16 | `history.yaml` | todo |
| Purchases | entitlements lockdown | QA-06 | BE-18 | MOB-19 | `paywall-sandbox.yaml` | todo |
| Settings, unpair, delete | BE-09/16 | QA-03 | BE-16 | MOB-18 | `delete-account.yaml` | todo |
| Accessibility + visual | — | — | — | gallery | `qa/visual` | todo |
| Privacy | — | — | log redaction | analytics wrapper | `qa/privacy` | todo |

## Fixtures
`qa/fixtures/personas.json` (personas and scenarios) · `revenuecat-events.json` · `push-payloads.json` · `deeplinks.json`.

## Environments
- **Local:** `supabase start` + seed. All automated layers run here.
- **`dev`:** nightly E2E and the release validator's pre-RC runs.
- **prod:** never used for tests. The release validator uses PO-provided test accounts only.
