#!/usr/bin/env bash
# QA-54 device script, automated with Maestro (see README.md "Script"). The capture server, the local
# stack (scenario paired-day1-partner-answered seeded) and the installed build must already be up.
# Usage: bash qa/privacy/replay/run-device.sh <udid> <maya's couple_question id> [mailpit url]
set -u
UDID=$1; CQ=$2
here=$(cd "$(dirname "$0")" && pwd)
F=$here/flows
mark() { curl -sk -X POST "https://localhost/__mark?kind=$1&edge=$2&label=$(printf %s "$3" | jq -sRr @uri)" >/dev/null; echo "$(date +%T) mark $1 $2 $3"; }
run() { echo "$(date +%T) flow $1"; maestro --device "$UDID" test -e CQ="$CQ" "$F/$1.yaml" >"${LOGDIR:-/tmp}/qa54-$1.log" 2>&1 || echo "  FLOW FAILED: $1 (log ${LOGDIR:-/tmp}/qa54-$1.log)"; }

run a1-welcome-stage                      # allowed 01, 05
mark masked start "07 names";      run a2-names;          mark masked end "07 names"
run a3-story                              # allowed 02/03 (#450)
mark masked start "04 plan";       run a4-plan-04;        mark masked end "04 plan"
run a5-goals                              # allowed 06
mark masked start "T1 + N";        run a6-t1-permission;  mark note at "permission dialog up"; run a7-allow; mark masked end "T1 + N"
run b1-sign-in                            # allowed 01, 08 (email in the input)
mark masked start "18-22 daily";   run b2-daily;          mark masked end "18-22 daily"
mark masked start "23-25 history"; run c1-history;        mark note at "after 25-share"; run c2-back; mark masked end "23-25 history"
run c3-allowed-37                         # allowed 37 (#451); back-nav: no reveal text may follow
mark masked start "40 us";         run d1-opt-out;        mark masked end "40 us"
mark quiet start "opted out";      run d2-quiet;          mark quiet end "opted out"
mark masked start "40 us again";   run d3-opt-in;         mark masked end "40 us again"
run e1-relaunch
sleep 30
curl -sk -X POST https://localhost/__quit >/dev/null; echo "$(date +%T) done"
