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

`privacy-check.mjs` opens a base URL in headless Chromium and checks ANALYTICS §5 / SEC-23-replay B:
no PostHog in the HTML, no PostHog request, no `window.posthog` and no `ph_` storage on `/j/` and
`/j/BND4827?t=…`; on `/` PostHog is present with `disable_session_recording: true` and
`cookieless_mode: 'always'` (source and runtime config), no `Set-Cookie`, no `ph_`/posthog cookie or
local/session storage key, no replay request (`/s/`, `$snapshot`). PostHog ingestion requests are
recorded and aborted, so a run against production sends nothing to the project.

```sh
node qa/web/privacy-check.mjs https://hellobonded.com              # exit 0 ok, 1 failures, 2 error
node qa/web/serve.mjs 4173 & node qa/web/privacy-check.mjs http://127.0.0.1:4173
node qa/web/privacy-check.mjs <url> --j-only                        # only the /j/* half
node --test qa/web/privacy-check.unit.mjs                           # parser unit tests, no browser
```

Not in CI yet: the site PostHog PR (LEAD-04 site analytics) is not on main, so `/` fails with
"PostHog not found" on today's `web/`. When it lands: re-check the init parsing against `web/`, then
add `node qa/web/privacy-check.mjs http://127.0.0.1:$PORT` to `qa/ci/web.sh`. Mutation-checked
(2026-11-13) against a copy of `web/` with PostHog injected on `/j/` and a cookie, storage key and
no `disable_session_recording` on `/`: 12 failures.
