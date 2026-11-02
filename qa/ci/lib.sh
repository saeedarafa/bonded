# Shared helpers for the qa/ci/*.sh job scripts. Source it; don't run it.
# Every job script must exit 0 with a "skipped" notice when its target doesn't exist yet,
# so a check can be required on main before the code it checks has landed (QA-01).

# skip <job> <reason>: report a clean skip and exit 0.
skip() {
  local job="$1" reason="$2"
  echo "::notice title=${job} skipped::${reason}"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    printf '### %s: skipped\n%s\n' "$job" "$reason" >> "$GITHUB_STEP_SUMMARY"
  fi
  echo "SKIP ${job}: ${reason}"
  exit 0
}

# npm_install <dir>: npm ci when a lockfile exists, npm install otherwise.
npm_install() {
  local dir="$1"
  if [ -f "$dir/package-lock.json" ] || [ -f "$dir/npm-shrinkwrap.json" ]; then
    npm ci --prefix "$dir" --no-audit --no-fund
  else
    echo "::warning title=No lockfile::$dir has no package-lock.json; using npm install (commit a lockfile for reproducible CI)."
    npm install --prefix "$dir" --no-audit --no-fund
  fi
}

# has_script <dir> <name>: true when package.json in <dir> defines scripts.<name>.
has_script() {
  node -e 'const p=require(require("path").resolve(process.argv[1],"package.json"));process.exit(p.scripts&&p.scripts[process.argv[2]]?0:1)' "$1" "$2"
}

# Run from the repo root regardless of the caller's cwd.
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
