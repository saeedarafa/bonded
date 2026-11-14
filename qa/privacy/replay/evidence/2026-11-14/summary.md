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

## Run 4 (02:00, after #453 and #456)

- Build: Release simulator build of `qa/QA-54-replay-check` 40aef91 (origin/main with #453: story and us/notifications on the never list; #456: no full-window replay mask, toast/banner hosts mask only their box while showing). Same flags as above, `xcodebuild -configuration Release -sdk iphonesimulator ARCHS=arm64` with ad-hoc signing (see README gotchas). Fresh isolated stack `qa54` (574xx), scenario `paired-day1-partner-answered`, Sam's answer for today added by SQL, cert pem reused.
- `run-device.sh` (all groups a-e): every flow passed. 02/03 story and 37 notifications are now marked `masked` windows (they are on the never list since #453).
- Scanner: `scan.mjs <cap> --ocr`: exit 0, 48 requests, 278 events, 174 `$snapshot` frames, no violations (`report-run4.json`). Frames are not committed.

| Check | Result |
|---|---|
| Allow-listed screens recorded as real frames with text masked (01 welcome, 05 stage, 06 goals, 08 sign-in) | pass: 174 non-black frames; layout and buttons visible, every text block a black box. OCR on all frames: 22 frames with "text", all noise (`-`, `..`, `=`) except "Continue with Apple" on 08 (the native Sign in with Apple button, static system copy) |
| Fixture strings (answers, messages, names, email `maya@bonded.test` typed on 08) in any payload or frame | pass: none |
| Never screens: 07 names, 02/03 story (#450), 18-22 daily incl. 21 reveal and 22 message, 23-25 history, 37 notifications (#451), 40 Us | pass: no frame inside any of these windows. When the app lands on a never screen the session sends one solid black frame (e.g. 0076 entering T1, 0172 entering Today, 0173 after relaunch), then nothing |
| One frame inside the `04 plan` window (0055, 01:58:37) and frames 0069-0075 in the `T1 + N` window | pass: they show the allowed 06 goals screen (the screen before the transition), text masked, OCR clean |
| Back-navigation from 21 (history) | pass: no frame after the 23-25 window until the relaunch |
| System UI: notification permission dialog (note 01:59:46) | pass: no frame between 01:59:07 and 02:00:17. Share sheet (25-share not present for this couple) and native alerts (none in the app): not exercised |
| Opt-out: nothing sent in the 99 s quiet window (3+ screens) | pass: no request at all |
| Opt back in: new session id; relaunch: new session id | pass (a8141f before opt-out -> e1dfe7 after opt-in -> eae6d9 after relaunch) |

Result: **pass, no leak.** #455 is fixed on device: allow-listed screens are recorded with masked text, and the never list (incl. #450/#451) produces no frames. Note: the capture also holds the marks of an aborted first attempt (01:53-01:54, app stuck on the splash because the build had no keychain entitlement); no app request came from it.
