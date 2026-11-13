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

`privacy-check.mjs` opens a base URL in headless Chromium and checks ANALYTICS §5 / SEC-23-replay B
against the LEAD-04 build (`web/assets/analytics.js` loads the self-hosted `posthog-js` and calls
`ph.init(KEY, {...})`; KEY is injected by `web-deploy.yml`, otherwise the placeholder stays and
analytics is off):

- `/j/` and `/j/BND4827?t=…`: no PostHog or `analytics.js` in the HTML, no request for
  `analytics.js`, the SDK or any PostHog host, no `window.posthog`, no `ph_`/posthog storage key.
- `/` with no key: nothing PostHog loads (`--require-on` turns "off" into a failure).
- `/` with a key: init options in `analytics.js` have `disable_session_recording: true`,
  `cookieless_mode: 'always'`, no cookie persistence and a `before_send`; the runtime config agrees;
  at least one event is sent; no `Set-Cookie`, no `ph_`/posthog cookie or local/session storage key,
  no replay request (`/s/`, `$snapshot`); `/` is opened with `?t=<token>&email=<email>&utm_source=qa08`
  and neither the token nor the email appears in any (gzip/base64-decoded) event body.

Every request to a PostHog host (events and the `eu-assets` lazy extensions) and any other
off-origin request is recorded and **aborted**: a run sends nothing to the project and needs no
network for a local copy. posthog-js drops events from a webdriver / "HeadlessChrome" browser as a
bot, so the check presents as regular Chrome (user agent, `navigator.webdriver`, `userAgentData`);
the site's config is not touched.

```sh
node qa/web/privacy-check.mjs https://hellobonded.com              # live, read-only; exit 0 ok, 1 failures, 2 error
node qa/web/serve.mjs 4173 & node qa/web/privacy-check.mjs http://127.0.0.1:4173
node qa/web/privacy-check.mjs <url> --require-on                    # fail when analytics is off
node qa/web/privacy-check.mjs <url> --j-only                        # only the /j/* half
node --test qa/web/privacy-check.unit.mjs                           # parser unit tests, no browser
```

In CI (`qa/ci/web.sh`, after the layout specs): the unit tests, then `web/` as committed (off) and
a temp copy with a fake `phc_` key injected like `web-deploy.yml` (`--require-on`), both served by
`serve.mjs` on 127.0.0.1. Mutation-checked (2026-11-13) on the injected copy: `clean()` returning
the URL unchanged (token + email reach `/e/`: 10 failures), `disable_session_recording: false` (3),
`analytics.js` added to `/j/` (4), `cookieless_mode: 'on_reject'` + `localStorage+cookie` (5).
