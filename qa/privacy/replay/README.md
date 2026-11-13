# QA-54: session replay on a device (D63, extends QA-08)

The Jest part (`qa/app/replay-privacy.test.ts`) proves what the app hands the native recorder. This
folder checks what a real dev build **sends**: every event and `$snapshot` upload goes to a local
stand-in for PostHog, then a scanner greps and OCRs it. No PostHog project or key is involved, and
nothing leaves the Mac.

| File | What it does |
|---|---|
| `capture-server.mjs` | HTTPS on `https://localhost` (port 443, loopback connections only). Remote config = worst case (replay, console logs, network timing + payload capture on). Writes `requests.ndjson` + raw bodies. `POST /__mark` records test windows, `POST /__quit` stops it. Self-signed cert made with openssl in the capture dir (30 days). |
| `scan.mjs` | Decodes bodies (gzip, `data=` base64), extracts every screenshot frame to `frames/`, and fails on: a `qa/fixtures/privacy-strings.json` string in any text (URLs, properties, wireframes; not image data), console or network plugin events / `$network_requests` / request or response bodies or headers, any replay event inside a `quiet` window. `--ocr`: macOS Vision on every frame; a fixture string in a frame fails, any text in a frame inside a `masked` window fails, an unreadable frame fails. Exit 2 when no `$snapshot` arrived (no false pass). |
| `ocr.swift` | On-device OCR (Vision), JSON out. |
| `scan.unit.mjs` | `node --test qa/privacy/replay/scan.unit.mjs` (in `qa/ci/app.sh`). |

Why OCR: React Native replay is screenshot based (`REPLAY_CONFIG` in `src/lib/analytics/client.ts`),
so masked text is pixels, not strings. The grep catches structured leaks; OCR catches unmasked text
on the frames; a person still looks at the frames of the system UI cases (keyboard, alerts, share
sheet, permission dialogs), which OCR cannot judge.

## Device run (REL-A only; needs a session that can use `xcrun simctl`, outside any sandbox)

```bash
UDID=E90AE3CD-873E-4237-89DC-5211A5D03243          # REL-A; never create or delete simulators
xcrun simctl list devices booted; adb devices      # take REL-A only if nobody else uses it
CAP=$TMPDIR/qa54-$(date +%Y%m%d-%H%M)

# 1. capture server (keep it running in its own terminal)
node qa/privacy/replay/capture-server.mjs --dir $CAP

# 2. local Supabase + fixtures (isolated stack, see qa/README; personas from qa/fixtures)
supabase start && supabase db reset && npm run qa:scenario paired-day1-partner-answered

# 3. dev build with replay on and the local capture host (never a real key or host)
xcrun simctl boot $UDID
xcrun simctl keychain $UDID add-root-cert $CAP/qa54-cert.pem
EXPO_PUBLIC_ANALYTICS_REPLAY=1 EXPO_PUBLIC_ANALYTICS_TEST_BUILD=1 \
EXPO_PUBLIC_POSTHOG_KEY=phc_qa54_local EXPO_PUBLIC_POSTHOG_HOST=https://localhost \
  npx expo run:ios --device $UDID                  # arm64 only: ARCHS=arm64 ONLY_ACTIVE_ARCH=YES if xcodebuild
```

Check first that `GET /flags` and `POST /batch` show up in the server log; if nothing arrives, the
cert is not trusted (re-run `add-root-cert`, then relaunch the app).

## Script (mark windows from the Mac while driving the app)

```bash
mark() { curl -sk -X POST "https://localhost/__mark?kind=$1&edge=$2&label=$(printf %s "$3" | jq -sRr @uri)"; }
```

1. Allowed screens: welcome, story, quiz stage/goals, sign-in (type `maya@bonded.test` in the email field).
2. Never-recorded screens, one window each: `mark masked start "20 today"`, use 20, answer with a
   `FIXTURE-ANSWER ...` text, reveal 21, thread 22 (send a `FIXTURE-MESSAGE ...`), then
   `mark masked end "20 today"`. Same for 06 invite code, 38 Us / key dates, 23-25 history, 31-33.
3. Back-navigation: open 21 from history (masked window), go back to the list, `mark masked end`;
   frames after the end come from the allowed screen and must not show the reveal again.
4. System UI: a native alert (delete account confirm on 40), the share sheet (invite link on 06),
   the notification permission dialog (fresh install, onboarding): note the time of each.
5. Opt-out: Settings 40, turn "Share usage data" off, `mark quiet start "opted out"`, use the app
   for 60 s across 3+ screens, `mark quiet end "opted out"`, turn it back on (a new session id must
   start; old one never resumes).
6. Kill and relaunch the app, wait 30 s (flushes queued uploads), then
   `curl -sk -X POST https://localhost/__quit`.

```bash
node qa/privacy/replay/scan.mjs $CAP --ocr       # exit 0 = pass, 1 = violations, 2 = nothing recorded
```

Look at `$CAP/frames/` for step 4 (the frame nearest each noted time: the alert/sheet/dialog must be
missing or covered) and record the result in `qa/TEST_PLAN.md` (QA-54 row) and the QA status file.
Evidence to commit: `report.json` and the console summary (no frames: they are screenshots of
fixture data, keep them in `$CAP`). Then `xcrun simctl shutdown $UDID` if you booted it.
