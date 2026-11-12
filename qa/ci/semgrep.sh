#!/usr/bin/env bash
# CI job "semgrep" (QA-44): Semgrep CE with OSS registry rules (TypeScript, JavaScript, React,
# Node: covers the app and the Deno functions) plus Bonded's SQL rules (qa/semgrep/), on the
# files a PR changes only, so it stays cheap. Runs the pinned semgrep/semgrep Docker image.
#
# Fails on ERROR-severity findings only; WARNING/INFO findings are annotated on the PR.
# Triage and the ignore list: security (SEC-18). A false positive gets a
# "nosemgrep: <rule-id>" comment with a reason, or a path in .semgrepignore.
#
# Env (set by the workflow):
#   SCAN_BASE  PR base sha (diff base); unset or "--all" = scan the whole repo (full run)
#   SCAN_HEAD  PR head sha (default HEAD)
#   SEMGREP_OUT  optional: copy the JSON report to this path
# Local: SCAN_BASE=--all bash qa/ci/semgrep.sh   (needs Docker)
set -euo pipefail
source "$(dirname "$0")/lib.sh"

SEMGREP_IMAGE=semgrep/semgrep:1.185.0
CONFIGS=(--config p/typescript --config p/javascript --config p/react --config p/nodejs
         --config qa/semgrep)
EXT='\.(ts|tsx|js|jsx|mjs|cjs|sql)$'

base="${SCAN_BASE:---all}"
head="${SCAN_HEAD:-HEAD}"

# Rule tests (QA-44b): qa/semgrep/<rules>.yml is checked against the "# ruleid:" / "# ok:"
# fixtures in qa/semgrep/<rules>.sql. Runs on a full run or when qa/semgrep/ or this script changes.
run_rule_tests=0
if [ "$base" = "--all" ]; then
  run_rule_tests=1
elif git diff --name-only "${base}...${head}" | grep -qE '^(qa/semgrep/|qa/ci/semgrep\.sh$)'; then
  run_rule_tests=1
fi
if [ "$run_rule_tests" = 1 ]; then
  echo "== semgrep --test qa/semgrep"
  docker run --rm -v "$PWD:/src:ro" -w /src -e SEMGREP_SEND_METRICS=off \
    "$SEMGREP_IMAGE" semgrep --test --metrics=off --disable-version-check qa/semgrep
fi

# The rule fixtures hold findings on purpose: never scan them.
targets=()
if [ "$base" = "--all" ]; then
  targets=(.)
else
  while IFS= read -r f; do
    [ -f "$f" ] && targets+=("$f")
  done < <(git diff --name-only --diff-filter=ACMR "${base}...${head}" | grep -E "$EXT" | grep -v '^qa/semgrep/' || true)
  [ ${#targets[@]} -gt 0 ] || skip semgrep "no TypeScript, JavaScript or SQL files changed (rule fixtures in qa/semgrep/ are tested, not scanned)."
fi
echo "== semgrep ${#targets[@]} target(s): ${targets[*]:0:20}"

outdir="$(mktemp -d)"
docker run --rm -v "$PWD:/src:ro" -v "$outdir:/out" -w /src -e SEMGREP_SEND_METRICS=off \
  "$SEMGREP_IMAGE" semgrep scan "${CONFIGS[@]}" --metrics=off --disable-version-check --timeout 30 \
  --exclude 'qa/semgrep/*.sql' \
  --severity ERROR --severity WARNING --text --json-output=/out/report.json "${targets[@]}"
report="$outdir/report.json"
[ -n "${SEMGREP_OUT:-}" ] && cp "$report" "$SEMGREP_OUT"

# Summary by severity and rule id (no code snippets); only ERROR blocks.
node -e '
const r = require(require("path").resolve(process.argv[1])).results || [];
const by = {};
for (const x of r) { const k = x.extra.severity + " " + x.check_id; by[k] = (by[k] || 0) + 1; }
console.log("== semgrep summary: " + r.length + " finding(s)");
for (const [k, n] of Object.entries(by).sort()) console.log(String(n).padStart(4) + "  " + k);
const errors = r.filter((x) => x.extra.severity === "ERROR").length;
if (errors) { console.log("::error title=semgrep::" + errors + " ERROR finding(s): fix, or SEC-18 adds a nosemgrep with a reason"); process.exit(1); }
if (r.length) console.log("::warning title=semgrep::" + r.length + " WARNING finding(s), not blocking (SEC-18 triages)");
' "$report"
