#!/usr/bin/env bash
# CI job "gitleaks" (QA-43): secret scan of the commits a PR (or a push) adds, not the whole
# history, so it stays fast. Findings are printed redacted (--redact): the secret value never
# reaches the log. A finding fails the job; a real leaked secret goes to the PO to rotate first,
# then security (SEC-18) decides on an allowlist entry in .gitleaks.toml.
#
# Env (set by the workflow; all optional for a local run):
#   SCAN_BASE  commit to scan from (exclusive): PR base sha, or the push's "before" sha
#   SCAN_HEAD  commit to scan to (inclusive): PR head sha, or the pushed sha (default HEAD)
# Local: bash qa/ci/gitleaks.sh            (scans origin/main..HEAD; needs gitleaks on PATH)
#        SCAN_BASE=--all bash qa/ci/gitleaks.sh   (full history)
set -euo pipefail
source "$(dirname "$0")/lib.sh"

GITLEAKS_VERSION=8.30.1
# sha256 of gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz from the release's checksums.txt
GITLEAKS_SHA256=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb

if ! command -v gitleaks >/dev/null; then
  if [ "$(uname -s)-$(uname -m)" != "Linux-x86_64" ]; then
    echo "::error::gitleaks not installed (brew install gitleaks, or run in CI)"; exit 1
  fi
  tmp="$(mktemp -d)"
  tgz="gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
  curl -fsSL -o "$tmp/$tgz" \
    "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${tgz}"
  echo "${GITLEAKS_SHA256}  $tmp/$tgz" | sha256sum -c -
  tar -xzf "$tmp/$tgz" -C "$tmp" gitleaks
  export PATH="$tmp:$PATH"
fi
gitleaks version

head="${SCAN_HEAD:-HEAD}"
base="${SCAN_BASE:-origin/main}"
zero=0000000000000000000000000000000000000000
if [ "$base" = "--all" ]; then
  range="--all"
elif [ -z "$base" ] || [ "$base" = "$zero" ] || ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
  # New branch push or workflow_dispatch: no usable base, scan the tip commit only.
  range="-1 $head"
else
  range="${base}..${head}"
fi
echo "== gitleaks git --log-opts=\"$range\""

config=()
[ -f .gitleaks.toml ] && config=(--config .gitleaks.toml)
status=0
gitleaks git . ${config[@]+"${config[@]}"} --log-opts="$range" --redact --no-banner --verbose \
  --exit-code 1 || status=$?
if [ "$status" -ne 0 ] && [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  printf '### gitleaks: findings\nSee the job log (values redacted). Real secret: tell the PO to rotate it first; false positive: security (SEC-18) adds an allowlist entry to .gitleaks.toml.\n' >> "$GITHUB_STEP_SUMMARY"
fi
exit "$status"
