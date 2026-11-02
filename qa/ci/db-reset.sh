#!/usr/bin/env bash
# CI job "db-reset": apply supabase/migrations on real Supabase Postgres (config.toml
# major_version) with the Supabase CLI and Docker. Needs Docker, so it runs on
# ubuntu-latest in CI; locally it only works where Docker is available.
# Skips cleanly when supabase/config.toml is absent.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

[ -f supabase/config.toml ] || skip db-reset "supabase/config.toml not on this branch yet (BE-01)."

command -v supabase >/dev/null || { echo "::error::supabase CLI not installed"; exit 1; }
command -v docker >/dev/null || { echo "::error::docker not available"; exit 1; }
supabase --version

supabase start
supabase db reset
supabase stop --no-backup
