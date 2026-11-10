#!/usr/bin/env bash
# QA-07: pixel screenshots of a screen on an iOS simulator in each display mode, as evidence next
# to the Node baselines (which cannot see clipping, overlap or real glyphs). Manual / nightly; not CI.
#
#   bash qa/visual/capture.sh                          booted simulator, the gallery (54)
#   bash qa/visual/capture.sh --udid <UDID> --url 'bonded:///today' --name today
#
# Needs a simulator with a **development** build of the app installed (/dev/gallery redirects to /
# in a Release build) and Metro running if it is a dev-client build. Writes
# qa/visual/evidence/<date>-<name>/<mode>.png (git-ignored: evidence is attached to the PR or the
# run notes, never committed). The simulator's appearance and text size are restored on exit.
set -euo pipefail

UDID=booted
URL='bonded:///dev/gallery'
NAME=gallery
WAIT=4
while [ $# -gt 0 ]; do
  case "$1" in
    --udid) UDID="$2"; shift 2 ;;
    --url) URL="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    --wait) WAIT="$2"; shift 2 ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

command -v xcrun >/dev/null || { echo "capture.sh needs Xcode (xcrun simctl); macOS only." >&2; exit 2; }
if [ "$UDID" = booted ] && ! xcrun simctl list devices booted | grep -q Booted; then
  echo "no booted simulator: boot one (xcrun simctl boot <UDID>) or pass --udid" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/qa/visual/evidence/$(date +%Y%m%d-%H%M%S)-$NAME"
mkdir -p "$OUT"

# Restore what the simulator had before.
ORIG_APPEARANCE="$(xcrun simctl ui "$UDID" appearance 2>/dev/null || echo light)"
ORIG_SIZE="$(xcrun simctl ui "$UDID" content_size 2>/dev/null || echo large)"
restore() {
  xcrun simctl ui "$UDID" appearance "$ORIG_APPEARANCE" >/dev/null 2>&1 || true
  xcrun simctl ui "$UDID" content_size "$ORIG_SIZE" >/dev/null 2>&1 || true
}
trap restore EXIT

# mode name | appearance | content size. "large" is the iOS default (100%);
# accessibility-large (AX2) is about 195% body text, the closest step to DESIGN.md's 200%.
MODES=(
  "light light large"
  "dark dark large"
  "light-200 light accessibility-large"
  "dark-200 dark accessibility-large"
)

for m in "${MODES[@]}"; do
  read -r mode appearance size <<<"$m"
  xcrun simctl ui "$UDID" appearance "$appearance"
  xcrun simctl ui "$UDID" content_size "$size"
  # Re-open the URL after each switch so the screen re-renders from the top in the new mode.
  xcrun simctl openurl "$UDID" "$URL"
  sleep "$WAIT"
  xcrun simctl io "$UDID" screenshot --type=png "$OUT/$mode.png" >/dev/null
  echo "captured $mode -> ${OUT#"$ROOT"/}/$mode.png"
done

echo "done: ${OUT#"$ROOT"/} (git-ignored; attach to the PR or the run notes)"
