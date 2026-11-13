# QA-54 device run, 2026-11-14 (REL-A)

- Device: REL-A, iPhone 16 Pro Max, iOS 18.0 simulator (E90AE3CD…). Release simulator build of origin/main be66271 (`ARCHS=arm64`).
  Flags: `EXPO_PUBLIC_ANALYTICS_REPLAY=1 EXPO_PUBLIC_ANALYTICS_TEST_BUILD=1 EXPO_PUBLIC_POSTHOG_KEY=phc_qa54_local EXPO_PUBLIC_POSTHOG_HOST=https://localhost`.
- Backend: isolated local stack `qa54` (ports 574xx) with scenario `paired-day1-partner-answered`. Sam's answer for the current day was added by SQL, see README.
- Capture: `capture-server.mjs` on https://localhost:443 with worst-case remote config. Driven by `run-device.sh`. There are three captures, because the daily step failed twice on stale test IDs and a milestone sheet; it was fixed and re-run:
  - run 1: all steps a–e (b2 failed at its start, so it covers onboarding, sign-in, history, 37, opt-out, relaunch);
  - run 2: b2 (failed again), c, e;
  - run 3: b2 (passed on the last attempt: 18 → 20 → 21 reveal → 22 message sent), c, e.
- Scanner: `node qa/privacy/replay/scan.mjs <cap> --ocr`. Exit 0 on all three runs (`report-run{1,2,3}.json`). Frames are not committed.

| Check | Result |
|---|---|
| Fixture strings (answers, messages, names, email) in any payload | pass: 0 hits in 56 requests (scanner, plus a raw grep of the gunzipped bodies) |
| Console logs / network telemetry / `$network_requests` (worst-case remote config) | pass: none sent |
| Opt-out: no replay or event data in the 100 s opted-out window (3+ screens) | pass: no request at all |
| Opt back in: new session id, the old one never resumes | pass (fb7946 → 87f7db; after relaunch 8e5f95) |
| OCR: fixture text in a frame / any text in masked windows | pass: 5 frames, no text |
| Allow-listed screens recorded with SDK text masking; #450 (02/03 names), #451 (37 partner name) | **not exercised**: every frame is solid black (#455) |
| Back-navigation from a never screen (21 → history → 37) | pass by default (no frames after the first per session) |
| System UI: notification permission dialog (shown at the "permission dialog up" note); no native `Alert` in the app; share sheet (25-share not present for this couple) | not exercised (no frames while it was up) |

Result: **no leak found; coverage blocked.** Every session sends a single black 440x956 frame and then nothing. That matches two always-mounted full-window `ReplayMask overlay` hosts in `app/_layout.tsx` (#455). Re-run this check after #455 is fixed.
