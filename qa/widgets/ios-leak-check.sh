#!/usr/bin/env bash
# QA-49c: count widget-token leaks on an iOS simulator. Prints counts and file names only, never a
# matched line (a match would be a live token). Needs a shell outside the sandbox (xcrun simctl).
# Usage: bash qa/widgets/ios-leak-check.sh <udid> [log window, default 2h]
# Exit 0 = no `bwt_` in the unified log, the App Group container, the app or extension data
# containers; 1 = at least one hit. Also prints how many keychain items sit in the widget access
# group (expect 1 while signed in, 0 after sign-out).
set -u
UDID=$1; WIN=${2:-2h}
APP=com.hellobonded.app; EXT=$APP.widgets; GROUP=group.$APP; KGROUP=$APP.widget
hits=0
# A live token is `bwt_` + 43 base64url chars. Plain `bwt_` also matches source comments and the
# validation regex inside the Debug dev bundle (tmp/ReactNativeDevBundle.js), so count token shapes.
PAT='bwt_[A-Za-z0-9_-]{43}'

n=$(xcrun simctl spawn "$UDID" log show --last "$WIN" --style compact 2>/dev/null | LC_ALL=C grep -cE "$PAT")
echo "unified log (last $WIN): $n line(s) with bwt_"; [ "$n" -gt 0 ] && hits=1

scan_dir() { # label dir
  [ -d "$2" ] || { echo "$1: not found"; return; }
  files=$(LC_ALL=C grep -rlaE "$PAT" "$2" 2>/dev/null | grep -v '/Library/Keychains/' || true)
  if [ -n "$files" ]; then echo "$1: bwt_ in:"; echo "$files" | sed "s#^$2#  .#"; hits=1; else echo "$1: 0 files with bwt_"; fi
}
G=$(xcrun simctl get_app_container "$UDID" $APP groups 2>/dev/null | awk -v g=$GROUP '$1==g {print $2}')
scan_dir "App Group $GROUP" "${G:-/nonexistent}"
[ -n "${G:-}" ] && [ -f "$G/Library/Preferences/$GROUP.plist" ] && \
  echo "App Group plist keys: $(plutil -convert json -o - "$G/Library/Preferences/$GROUP.plist" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(Object.keys(JSON.parse(s)).join(", ")))')"
scan_dir "app data container" "$(xcrun simctl get_app_container "$UDID" $APP data 2>/dev/null)"
# The extension's own sandbox lives under data/Containers/Data/PluginKitPlugin/<uuid>.
DEV=~/Library/Developer/CoreSimulator/Devices/$UDID/data
for d in "$DEV"/Containers/Data/PluginKitPlugin/*; do
  m="$d/.com.apple.mobile_container_manager.metadata.plist"
  [ -f "$m" ] && plutil -p "$m" | grep -q "\"$EXT\"" && scan_dir "extension container" "$d"
done

# NSURLCache: which cached responses hold a token (request URL only, never the body).
for c in "$(xcrun simctl get_app_container "$UDID" $APP data 2>/dev/null)/Library/Caches/$APP/Cache.db"; do
  [ -f "$c" ] || { echo "URL cache: no $APP/Cache.db"; continue; }
  t=$(mktemp -d); cp "$c"* "$t/"
  sqlite3 -readonly "$t/Cache.db" "select r.request_key from cfurl_cache_response r join cfurl_cache_receiver_data d using(entry_ID) where cast(d.receiver_data as text) like '%bwt\_%' escape '\\'" 2>/dev/null \
    | sed -E 's/\?.*//' | sort | uniq -c | sed 's/^/  URL cache entry with bwt_: /'
  # QA-49d (#479 / MOB-89): any cached Supabase response at all (rest, auth, functions), URL only.
  n=$(sqlite3 -readonly "$t/Cache.db" "select count(*) from cfurl_cache_response where request_key like '%/rest/v1/%' or request_key like '%/auth/v1/%' or request_key like '%/functions/v1/%'" 2>/dev/null || echo '?')
  echo "URL cache ($APP/Cache.db): $n Supabase response(s) cached"
  [ "$n" != "0" ] && { sqlite3 -readonly "$t/Cache.db" "select request_key from cfurl_cache_response where request_key like '%/v1/%'" 2>/dev/null | sed -E 's/\?.*//' | sort | uniq -c | sed 's/^/  cached: /'; hits=1; }
  rm -rf "$t"
done

KC="$DEV/Library/Keychains/keychain-2-debug.db"
if [ -f "$KC" ]; then
  k=$(sqlite3 -readonly "$KC" "select count(*) from genp where agrp like '%.$KGROUP'" 2>/dev/null || echo '?')
  echo "keychain items in access group *.$KGROUP: $k"
fi
[ $hits -eq 0 ] && echo "PASS: no bwt_ found" || echo "FAIL: bwt_ found (see above)"
exit $hits
