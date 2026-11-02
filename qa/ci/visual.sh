#!/usr/bin/env bash
# QA-07: visual + a11y regression over the dev gallery. No Docker, no simulator.
# Local: bash qa/ci/visual.sh      Update baselines after a deliberate design change: UPDATE_BASELINES=1 bash qa/ci/visual.sh
set -euo pipefail
source "$(dirname "$0")/lib.sh"

[ -f package.json ] || skip visual "root package.json not on this branch yet."
npm_install .
CI=true npx --no-install jest -c qa/visual/jest.config.js
