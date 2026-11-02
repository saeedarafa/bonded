#!/usr/bin/env bash
# CI job "db-reset": apply supabase/migrations on real Supabase Postgres (config.toml
# major_version) with the Supabase CLI and Docker. Needs Docker, so it runs on
# ubuntu-latest in CI; locally it only works where Docker is available.
# Then runs the QA-03 contract tests (qa/contract) on the same stack, so the stack starts once.
# Skips cleanly when supabase/config.toml is absent.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

[ -f supabase/config.toml ] || skip db-reset "supabase/config.toml not on this branch yet (BE-01)."

command -v supabase >/dev/null || { echo "::error::supabase CLI not installed"; exit 1; }
command -v docker >/dev/null || { echo "::error::docker not available"; exit 1; }
supabase --version

supabase start
trap 'supabase stop --no-backup >/dev/null 2>&1 || true' EXIT
supabase db reset

if [ -f qa/contract/package.json ]; then
  bash qa/ci/contract.sh --stack-running
fi
