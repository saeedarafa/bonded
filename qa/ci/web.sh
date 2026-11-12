#!/usr/bin/env bash
# CI job "web" (QA-47): cross-device layout check of the static site in web/ (landing + /j/) with
# Playwright: Chromium Android phones, WebKit iPhones/iPad, Chromium/WebKit/Firefox desktop.
# Specs and profiles: qa/web/ (README there). Screenshots of failures land in qa/web/test-results
# and the HTML report in qa/web/playwright-report (the workflow uploads both on failure).
#
# Runs only when the site or its check changes, so it costs nothing on other PRs:
#   web/**, qa/web/**, this script, .github/workflows/ci.yml
# Env (set by the workflow):
#   SCAN_BASE  diff base (PR base sha, or the push's "before" sha); unset or "--all" = always run
#   SCAN_HEAD  diff head (default HEAD)
# Local: SCAN_BASE=--all bash qa/ci/web.sh   (or: npm --prefix qa/web test)
set -euo pipefail
source "$(dirname "$0")/lib.sh"

base="${SCAN_BASE:---all}"
head="${SCAN_HEAD:-HEAD}"
PATHS='^(web/|qa/web/|qa/ci/web\.sh$|\.github/workflows/ci\.yml$)'

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
