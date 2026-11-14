#!/usr/bin/env bash
# QA-49d (MOB-89): count Supabase responses and widget tokens left in the Android app's OkHttp disk
# cache (`cache/http-cache`) and the rest of its data dir. Prints counts and URL paths only, never a
# body or a matched line. Needs a Debug build (`run-as`) and a shell outside the sandbox (adb).
# Usage: bash qa/widgets/android-cache-check.sh [serial, default emulator-5554]
# Exit 0 = no cached Supabase response and no `bwt_` token in the data dir; 1 otherwise.
set -u
S=${1:-emulator-5554}; APP=com.hellobonded.app
ADB=${ADB:-$(command -v adb || echo ~/Library/Android/sdk/platform-tools/adb)}
sh() { "$ADB" -s "$S" shell run-as $APP sh -c "$1" 2>/dev/null | tr -d '\r'; }
hits=0
PAT='bwt_[A-Za-z0-9_-]{43}'

if [ -n "$(sh 'ls -d cache/http-cache')" ]; then
  echo "cache/http-cache files: $(sh 'ls cache/http-cache | wc -l' | tr -d ' ')"
  # OkHttp entry metadata <key>.0 starts with the request URL; <key>.1 is the body.
  urls=$(sh 'for f in cache/http-cache/*.0; do [ -f "$f" ] && head -n 1 "$f"; done' | grep -E '/(rest|auth|functions)/v1/' || true)
  n=$(printf '%s' "$urls" | grep -c . || true)
  echo "cached Supabase responses: $n"
  [ "$n" -gt 0 ] && { printf '%s\n' "$urls" | sed -E 's/\?.*//' | sort | uniq -c | sed 's/^/  cached: /'; hits=1; }
else
  echo "cache/http-cache: absent"
fi
# Token shapes anywhere in the app data dir except SecureStore's encrypted prefs (values encrypted).
t=$(sh "grep -rlE '$PAT' . 2>/dev/null" || true)
if [ -n "$t" ]; then echo "bwt_ token in:"; printf '%s\n' "$t" | sed 's/^/  /'; hits=1; else echo "app data dir: 0 files with a bwt_ token"; fi
[ $hits -eq 0 ] && echo "PASS: nothing cached" || echo "FAIL: see above"
exit $hits
