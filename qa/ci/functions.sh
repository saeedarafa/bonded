#!/usr/bin/env bash
# CI job "functions": deno lint, check and test for supabase/functions/** (BE-23).
# Turns on when the first .ts file lands under supabase/functions/.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

dir=supabase/functions
files=()
if [ -d "$dir" ]; then
  while IFS= read -r f; do files+=("$f"); done < <(find "$dir" -type f \( -name '*.ts' -o -name '*.tsx' \) | sort)
fi
[ ${#files[@]} -gt 0 ] || skip functions "no TypeScript under $dir yet (BE-23)."

command -v deno >/dev/null || { echo "::error::deno not installed"; exit 1; }
deno --version

# Use the functions' own config when backend adds one (import map, compiler options).
config=()
for c in "$dir/deno.json" "$dir/deno.jsonc"; do
  [ -f "$c" ] && { config=(--config "$c"); break; }
done

echo "== deno lint"
deno lint ${config[@]+"${config[@]}"} "$dir"
echo "== deno check (${#files[@]} files)"
deno check ${config[@]+"${config[@]}"} "${files[@]}"
echo "== deno test"
# -A: function tests stub the network and env themselves; CI has no real secrets.
deno test -A --permit-no-files ${config[@]+"${config[@]}"} "$dir"
