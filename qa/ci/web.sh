#!/usr/bin/env bash
# CI job "web" (QA-47): cross-device layout check of the static site in web/ (landing + /j/) with
# Playwright: Chromium Android phones, WebKit iPhones/iPad, Chromium/WebKit/Firefox desktop.
# Specs and profiles: qa/web/ (README there). Screenshots of failures land in qa/web/test-results
# and the HTML report in qa/web/playwright-report (the workflow uploads both on failure).
#
# Then (QA-08 website part) the PostHog privacy check, qa/web/privacy-check.mjs, twice, on local
# served copies only (no live network; every PostHog request is aborted by the check):
#   1. web/ as committed (no key: analytics must stay off, nothing loads);
#   2. a temp copy with a fake phc_ key injected exactly like web-deploy.yml does it (analytics on, cookie
#      banner, ANALYTICS §5 / D64): before a choice and after Reject cookieless (no cookie, no storage but
#      `bonded_consent`, no recorder, no replay), Reject kept over a reload; after Accept PostHog persistence
#      and masked replay (typed input text, console and network never in any request); no token/email from
#      the query in any event; never on /j/*. PostHog requests are answered locally (lazy SDK files from the
#      posthog-js pinned in qa/web/package.json, which must match web/assets/vendor).
#
# Runs only when the site or its check changes, so it costs nothing on other PRs:
#   web/**, qa/web/**, this script, .github/workflows/ci.yml, .github/workflows/web-deploy.yml
# Env (set by the workflow):
#   SCAN_BASE  diff base (PR base sha, or the push's "before" sha); unset or "--all" = always run
#   SCAN_HEAD  diff head (default HEAD)
#   WEB_PORT   first of the two local ports for the privacy check (default 4181; uses it and +1)
# Local: SCAN_BASE=--all bash qa/ci/web.sh   (or: npm --prefix qa/web test)
set -euo pipefail
source "$(dirname "$0")/lib.sh"

base="${SCAN_BASE:---all}"
head="${SCAN_HEAD:-HEAD}"
PATHS='^(web/|qa/web/|qa/ci/web\.sh$|\.github/workflows/(ci|web-deploy)\.yml$)'

[ -d web ] || skip web "no web/ directory."
if [ "$base" != "--all" ]; then
  if [[ "$base" =~ ^0+$ ]] || ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
    echo "diff base $base unknown: running the full check"
  elif ! git diff --name-only "${base}...${head}" | grep -qE "$PATHS"; then
    skip web "no change under web/, qa/web/ or the web check itself."
  fi
fi

npm_install qa/web
# Browsers + their OS libraries (Firefox only for the desktop profile; about 30 s more)
(cd qa/web && npx playwright install --with-deps chromium webkit firefox)
(cd qa/web && CI=1 npx playwright test)

# QA-08: PostHog privacy check (ANALYTICS §5, SEC-23-replay B).
node --test qa/web/privacy-check.unit.mjs
# The pinned posthog-js in qa/web serves the lazy extensions in the check: it must be the same build as the
# site's vendored SDK (npm dist/array.js without its sourceMappingURL line).
vendor="$(ls web/assets/vendor/posthog-js-*.js)"
pinned="$(node -p 'require("./qa/web/node_modules/posthog-js/package.json").version')"
[ "$vendor" = "web/assets/vendor/posthog-js-${pinned}.js" ] || { echo "qa/web posthog-js ${pinned} does not match ${vendor}: bump qa/web/package.json"; exit 1; }
cmp -s "$vendor" <(sed '/^\/\/# sourceMappingURL=/d' qa/web/node_modules/posthog-js/dist/array.js) \
  || { echo "$vendor differs from npm posthog-js@${pinned} dist/array.js"; exit 1; }
tmp="$(mktemp -d)"
pids=()
trap 'kill "${pids[@]}" 2>/dev/null || true; rm -rf "$tmp"' EXIT
cp -R web "$tmp/web"
# Same injection as web-deploy.yml (format ^phc_[A-Za-z0-9]{20,80}$). A fake, low-entropy key: nothing
# leaves the machine (the check aborts every PostHog request), and gitleaks stays quiet.
fake_key="phc_qa08$(printf 'x%.0s' $(seq 1 28))"
sed -i.bak "s/__POSTHOG_PUBLIC_KEY__/${fake_key}/" "$tmp/web/assets/analytics.js" && rm "$tmp/web/assets/analytics.js.bak"
grep -q "__POSTHOG_PUBLIC_KEY__" "$tmp/web/assets/analytics.js" && { echo "key not injected into the temp copy"; exit 1; }
p1="${WEB_PORT:-4181}"; p2=$((p1 + 1))
node qa/web/serve.mjs "$p1" & pids+=($!)
WEB_ROOT="$tmp/web" node qa/web/serve.mjs "$p2" & pids+=($!)
for port in "$p1" "$p2"; do
  for _ in $(seq 1 50); do curl -fs -o /dev/null "http://127.0.0.1:$port/" 2>/dev/null && break; sleep 0.2; done
done
echo "privacy check: web/ as committed (no key, analytics off)"
node qa/web/privacy-check.mjs "http://127.0.0.1:$p1"
echo "privacy check: key injected (analytics on)"
node qa/web/privacy-check.mjs "http://127.0.0.1:$p2" --require-on
