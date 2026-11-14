# qa/web: cross-device check of the static site (QA-47)

Playwright opens `web/` (landing and `/j/`) on 12 profiles and checks layout invariants by measuring
element rects. CI job `web` (in `ci-ok`) runs it when `web/`, `qa/web/`, `qa/ci/web.sh` or `ci.yml`
changes; it skips otherwise.

```sh
npm --prefix qa/web ci
(cd qa/web && npx playwright install chromium webkit firefox)
npm --prefix qa/web test                                  # all profiles, about 1-3 min
(cd qa/web && npx playwright test --project=iphone-se -g notes)
WEB_ROOT=/path/to/old/web npm --prefix qa/web test        # check another copy of the site
```

`serve.mjs` serves `web/` like Cloudflare Pages: `/j/:code` rewrites to `/j/` (the `_redirects` rule),
unknown paths get `404.html`.

## Profiles
Chromium: Pixel 7 (412x839), Galaxy S8 (360x740), Galaxy S9+ (320x658), 360x640.
WebKit: iPhone 13 (390x664), iPhone SE 1st gen (320x568), iPhone SE 3rd gen (375x667, as REL-B),
iPhone Pro 402x874, iPad Mini (768x1024). Desktop: Chrome 1366x768, Safari 1440x900, Firefox 1366x768.

## Checks (`tests/layout.spec.ts`)
For `#paper`, `#notes` and `#day`, scrolled to 5 / 40 / 65 / 100% of the track, after the scrub easing
and finite animations settle:
- `h-overflow`: no sideways page scroll; copy, bubbles and the button inside the viewport width;
- `copy-over-stage`: headline, subtitle, badges and proof lines never painted over the paper (the
  drawn mesh), the notes or the sky card (hit-tested, so tilts and rotations don't false-alarm);
- `steps-over-copy`: the fixed step pill never covers the copy;
- `off-screen`, `button-under-bubble`, `bubble-over-copy`, `bubble-over-bubble`, `bubble-over-notes`;
- `note-text-overflow`: name, question, answer and seal stay inside their note half (layout boxes);
- `frozen-opacity`: no CSS-driven element left between 0.05 and 0.95 opacity (scroll-scrubbed inline
  opacities are by design and skipped).
Plus a top-to-bottom sideways-scroll sweep of the landing and `/j/` valid / invalid states.

On a violation the test saves a screenshot per scroll point (attachments in the HTML report).
Known bugs are in `FIXME` / `FIXME_J_BUBBLE` with their issue: reported as `fixme` annotations,
not failures. Remove the entry when the issue is fixed.

The suite fails on the layouts before LEAD-04 #341 (note text out of the notes on Galaxy S8 and
360x640, small-moments copy under the sky card) and before 5d031f1 (notes over the "Then open them
together." subtitle on 402x874).

## PostHog privacy check (QA-08 website part, QA-54 item 8)

`privacy-check.mjs` opens a base URL in headless Chromium and checks ANALYTICS §5 (cookie banner,
PO 2026-11-14, D64) / SEC-23 B against the LEAD-04 build (`web/assets/analytics.js` loads the
self-hosted `posthog-js` and calls `posthog.init(KEY, {...})`; KEY is injected by `web-deploy.yml`,
otherwise the placeholder stays and analytics and the banner are off):

- `/j/` and `/j/BND4827?t=…`: no PostHog or `analytics.js` in the HTML, no request for
  `analytics.js`, the SDK or any PostHog host, no `window.posthog`, no banner, no `ph_`/posthog or
  `bonded_consent` storage key, no cookie.
- `/` with no key: nothing PostHog loads, no banner (`--require-on` turns "off" into a failure).
- `/` with a key, static: `cookieless_mode: 'on_reject'`, `opt_out_capturing_by_default: true`,
  `consent_persistence_name` = `bonded_consent`, `person_profiles: 'never'`, replay
  `maskAllInputs: true`, `recordHeaders`/`recordBody: false`, `enable_recording_console_log: false`,
  `network_timing: false`, no copied text, a `before_send`.
- `/` with a key, runtime: the replay guard is installed (`window.posthog.rateLimiter.bondedGuard === true`,
  set by `guardReplay()` in `web/assets/analytics.js`, #512). It wraps a **private** posthog-js
  internal, so a rename turns it off silently: this check fails instead ("replay guard not installed").
- `/` with a key, three fresh visits opened with `?t=<token>&email=<email>&utm_source=qa08`; each types
  a fixture string into an `<input>` and a `<textarea>`, logs a console line, fetches a marked URL:
  1. **before a choice** the banner shows; no cookie, no storage key at all, no recorder
     (`lazy-recorder.js`) and no replay request (`/s/`, `$snapshot`), but events are sent (cookieless).
     **Reject**: only `bonded_consent=0`; **reload**: the banner stays hidden, same state, events go on.
  2. **Accept**: `bonded_consent=1`, `ph_<key>_posthog` persistence, the recorder loads and snapshots
     are sent; runtime `maskAllInputs` on, console/headers/bodies off; a control string in page text
     **is** found in the decoded snapshots (rrweb's gzip strings are expanded) while the typed string,
     the console line and the fetch marker are in **no** request; no rrweb network plugin event and no
     console plugin event except the SDK's own `[SessionRecording]` warnings (noted). Reload: still on.
  3. **Accept, then Reject** from the footer "Cookie settings": the banner reopens; afterwards no
     cookie, only `bonded_consent=0`, no snapshot; a reload keeps it.
  In every event (not replay) neither the query token nor the email appears; in replay snapshots the
  page URL is kept as rrweb records it (ANALYTICS §5 "SEC to confirm"): printed as a note.

Every request to a PostHog host is recorded and **answered locally**: events get `{"status":1}`, the
lazy extensions (`static/<v>/*.js`) come from `posthog-js` pinned in `qa/web/package.json` (must be
the vendored version; `qa/ci/web.sh` compares the files), and the remote config
(`array/<key>/config.js`) is a stub that turns replay on and *asks* for console logs and network
bodies, so the site's own settings must win. Any other off-origin request is aborted. A run sends
nothing to the project and needs no network. posthog-js drops events from a webdriver /
"HeadlessChrome" browser as a bot, so the check presents as regular Chrome (user agent,
`navigator.webdriver`, `userAgentData`); the site's config is not touched. On macOS inside a
sandboxed shell Chromium may need the sandbox off (Mach port error).

```sh
node qa/web/privacy-check.mjs https://hellobonded.com              # live, read-only; exit 0 ok, 1 failures, 2 error
node qa/web/serve.mjs 4173 & node qa/web/privacy-check.mjs http://127.0.0.1:4173
node qa/web/privacy-check.mjs <url> --require-on                    # fail when analytics is off
node qa/web/privacy-check.mjs <url> --j-only                        # only the /j/* half
node --test qa/web/privacy-check.unit.mjs                           # parser unit tests, no browser
```

In CI (`qa/ci/web.sh`, after the layout specs): the unit tests, then `web/` as committed (off) and
a temp copy with a fake `phc_` key injected like `web-deploy.yml` (`--require-on`), both served by
`serve.mjs` on 127.0.0.1 (ports `WEB_PORT`, default 4181 and 4182). Mutation-checked (2026-11-14,
banner build) on the injected copy: `maskAllInputs: false` + text inputs unmasked +
`opt_out_capturing_by_default: false` = 8 failures (typed text found in `/s/` in both Accept visits).

**posthog-js upgrade:** bump `posthog-js` in `qa/web/package.json` to the vendored version, re-run
`SCAN_BASE=--all bash qa/ci/web.sh`, and if "replay guard not installed" fails, re-check
`guardReplay()` in `web/assets/analytics.js` against the new SDK's `rateLimiter.isServerRateLimited`
(every request still passes it, replay still uses batch key `recordings`) before deploying.
