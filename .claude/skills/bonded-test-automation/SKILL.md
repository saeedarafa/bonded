---
name: bonded-test-automation
description: Write and run Bonded's automated tests across layers. Covers DB behaviour, two-user contract tests against local Supabase, Deno function tests, Jest/RNTL component tests, Maestro two-device E2E, visual/a11y regression, persona scenarios, deterministic time, CI wiring and bug reporting. Use whenever adding or running tests.
---

# Bonded test automation

## 1. Local stack (all layers start here)
```bash
supabase start                       # Postgres, Auth (email OTP goes to the local Inbucket/Mailpit), Realtime, Storage, Functions
supabase db reset                    # migrations + seed (content + personas)
npm run qa:scenario <scenario-id>    # put the personas into one state (qa/fixtures/personas.json)
```
Scenarios are the shared vocabulary between agents. Say "fails in `streak-6-milestone`", not "fails for some user".

## 2. Layers and where tests go
| Layer | Tool | Location | Owner |
|---|---|---|---|
| DB behaviour (RLS, RPC, triggers) | PGlite harness or pgTAP | `supabase/tests/` | backend writes; QA reviews coverage |
| Contract (app ↔ DB as real users) | Vitest + `supabase-js` | `qa/contract/*.test.ts` | QA |
| Edge functions | `deno test` | `supabase/functions/**/index_test.ts` | backend |
| Components and hooks | Jest + React Native Testing Library | `src/**/__tests__` | mobile |
| End to end | Maestro (YAML flows), 2 simulators | `.maestro/` | QA |
| Visual and a11y | gallery screenshots, label lint | `qa/visual/` | QA |
| Privacy | capture analytics/Sentry/log payloads, grep for fixture answer text | `qa/privacy/` | QA |

## 3. Contract tests (the most valuable layer)
Two clients signed in as two personas of the same couple, plus one from another couple:

```ts
const maya = await signInAs('maya');   // qa/contract/helpers.ts: OTP via local Inbucket API or admin generateLink
const sam  = await signInAs('sam');
const eve  = await signInAs('eve');    // other couple

test('partner answer hidden until I answer (reveal rule)', async () => {
  const { data: cq } = await maya.rpc('get_daily_question');
  await sam.from('answers').upsert({ couple_question_id: cq.id, user_id: SAM, body: 'x' });
  const before = await maya.from('answers').select('*').eq('couple_question_id', cq.id);
  expect(before.data!.map(a => a.user_id)).not.toContain(SAM);
  await maya.from('answers').upsert({ couple_question_id: cq.id, user_id: MAYA, body: 'y' });
  const after = await maya.from('answers').select('*').eq('couple_question_id', cq.id);
  expect(after.data!.map(a => a.user_id)).toContain(SAM);
});
```

Cover, for every row in CONTRACTS §2:
- the happy path;
- every error code (assert `error.message === 'CODE'`);
- the outsider (`eve`) sees nothing and can't write;
- `anon` is denied, except `invite_preview`;
- retries are idempotent.

## 4. E2E with Maestro (two devices)
- Flows mirror design flows: `pairing-inviter.yaml`, `pairing-joiner.yaml`, `daily-loop.yaml`, `thread.yaml`, `joiner-errors.yaml` (J9, J10, 56), `offline-answer.yaml`, `paywall-sandbox.yaml`, `delete-account.yaml`.
- Select by `testID` (mobile adds `testID` = `screenId-element`, for example `20-hold-button`), never by copy.
- Two-device flows: run device A and device B flows in parallel with a shared scenario. Sync through the DB state (poll with a timeout), not sleeps.
- Deep links: `qa/fixtures/deeplinks.json` lists each URL and its expected screen.

## 5. Deterministic time
- RPCs that depend on time accept `p_now`; tests pass explicit timestamps around the couple's midnight and DST changes.
- Functions get a `now()` injected; never `Date.now()` in logic.
- App: mock timers in Jest; in E2E, use scenarios that are already in the needed state rather than waiting.

## 6. CI (`.github/workflows/`)
| Workflow | Trigger | Jobs |
|---|---|---|
| `ci.yml` | every PR | `node scripts/plan/generate.mjs --check`, `node scripts/agents/sync.mjs --check`, DB tests, `deno lint/check/test`, app `tsc`/lint/Jest, contract tests (`supabase start` in CI) |
| `e2e.yml` | nightly + `release/*` | EAS build for simulators/emulators, Maestro flows on iOS + Android |
| `visual.yml` | nightly | gallery screenshots vs baselines |

Make `ci.yml` a required check on `main`. Cache the Supabase CLI images and node_modules.

## 7. Bug report format (GitHub issue)
```
Title: [SCR-21] Reaction not shown to partner until app restart
Labels: bug, sev:2, area:daily-loop
Build/commit: 1.0.0 (42) / abc1234   Platform: Android 15 Pixel 8 emulator
Scenario: paired-day1-partner-answered
Steps: 1… 2… 3…
Expected: Sam sees "Maya loved this" within 2 s (CONTRACTS §2 realtime)
Actual: shown only after relaunch
Evidence: screenshot path / log excerpt (no answer text)
Failing test: qa/contract/reactions.test.ts › realtime reaction
```
Severity:
- **sev:1** data leak, reveal-rule break, crash on launch, wrong charge;
- **sev:2** core flow broken with no workaround;
- **sev:3** has a workaround or is cosmetic on the core flow;
- **sev:4** minor.

## 8. Rules
- Fixture personas only; fixture answer text is distinctive (`FIXTURE-…`) so privacy greps can find leaks.
- Quarantine flaky tests (tag plus an issue) within a day; never delete them silently.
- Pending features: `test.todo('… (MOB-14)')` so coverage gaps stay visible.
