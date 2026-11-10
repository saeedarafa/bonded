# qa/a11y: route-level accessibility and structure regression (QA-07)

Every built screen, in its main states, rendered through the real router (`app/`, `renderRouter`) against a fake server (`world.ts`). Jest in Node: no Docker, no simulator, about 5 s.

```bash
npx jest -c qa/a11y/jest.config.js              # what qa/ci/app.sh runs
npx jest -c qa/a11y/jest.config.js -t "21 "     # one screen
npx jest -c qa/a11y/jest.config.js --ci=false -u   # accept a deliberate design change (review the .snap diff)
```

| File | What |
|---|---|
| `screens.ts` | `CASES` (screen id, state, url, fake-server edits), `PLACEHOLDERS`, `NOT_RENDERED` (with reasons) |
| `world.ts` | Maya + Sam, NOW = 2026-11-10T09:00Z, the per-api fakes; markers `FIXTURE-PARTNER-ANSWER`, `FIXTURE-LOCKED-Q` |
| `setup.ts` | Mocks every `src/features/*/api.ts` (an unfaked network call fails the case), blocks fetch, pins Date, sets the system scheme and font scale from `mode.ts` |
| `checks.ts` | Rules: touch-role, touch-name, toggle-state, input-label, graphic, target-size, heading, premium-label (D41), reveal-rule, locked-pack, truncation |
| `checks.test.ts` | The rules on hand-built trees: every exemption has a negative control |
| `screens.test.tsx` | Rules per case in light and light at 200%; structure snapshots in light, dark, 200% for key screens; positive controls |
| `coverage.test.ts` | Every CSV screen id is a case, a placeholder or not-rendered; every built screen has a case; placeholders still are |

Timing: `renderRouter()` switches Jest to fake timers itself, so the suite advances the clock (`jest.advanceTimersByTimeAsync`) instead of waiting. Do not call `jest.useFakeTimers()` in setup or render outside a test (the router then mounts twice and waits forever).

Product findings go in `KNOWN` in `screens.test.tsx` with their GitHub issue; a stale entry fails the run, so it is removed when the bug is fixed. Open: #133 (gold `status` chip).
