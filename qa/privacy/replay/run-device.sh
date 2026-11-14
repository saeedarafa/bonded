#!/usr/bin/env bash
# QA-54 device script, automated with Maestro (see README.md "Script"). The capture server, the local
# stack (scenario paired-day1-partner-answered seeded) and the installed build must already be up.
# Usage: [ONLY='b c e'] bash qa/privacy/replay/run-device.sh <udid> <maya's couple_question id>
# ONLY picks step groups: a onboarding (fresh install), b sign-in + daily, c history + back-nav + 37,
# d opt-out, e relaunch + quit. b2 alone (signed in already): ONLY='b2 c e'.
set -u
UDID=$1; CQ=$2
here=$(cd "$(dirname "$0")" && pwd)
F=$here/flows
mark() { curl -sk -X POST "https://localhost/__mark?kind=$1&edge=$2&label=$(printf %s "$3" | jq -sRr @uri)" >/dev/null; echo "$(date +%T) mark $1 $2 $3"; }
on() { [ -z "${ONLY:-}" ] && return 0; for g in $ONLY; do case "$1" in $g*) return 0;; esac; done; return 1; }
run() { echo "$(date +%T) flow $1"; maestro --device "$UDID" test -e CQ="$CQ" "$F/$1.yaml" >"${LOGDIR:-/tmp}/qa54-$1.log" 2>&1 || echo "  FLOW FAILED: $1 (log ${LOGDIR:-/tmp}/qa54-$1.log)"; }

if on a1; then run a1-welcome-stage; fi  # allowed 01, 05
if on a2; then mark masked start "07 names";      run a2-names;          mark masked end "07 names"; fi
if on a3; then mark masked start "02/03 story"; run a3-story;          mark masked end "02/03 story"; fi  # never since #453 (was allowed, #450)
if on a4; then mark masked start "04 plan";       run a4-plan-04;        mark masked end "04 plan"; fi
if on a5; then run a5-goals; fi  # allowed 06
if on a6; then mark masked start "T1 + N";        run a6-t1-permission;  mark note at "permission dialog up"; run a7-allow; mark masked end "T1 + N"; fi
if on b1; then run b1-sign-in; fi  # allowed 01, 08 (email in the input)
if on b2; then mark masked start "18-22 daily";   run b2-daily;          mark masked end "18-22 daily"; fi
if on c1; then mark masked start "23-25 history"; run c1-history;        mark note at "after 25-share"; run c2-back; mark masked end "23-25 history"; fi
if on c3; then mark masked start "37 notifications"; run c3-allowed-37; mark masked end "37 notifications"; fi  # never since #453 (#451); back-nav: no reveal text may follow
if on d1; then mark masked start "40 us";         run d1-opt-out;        mark masked end "40 us"; fi
if on d2; then mark quiet start "opted out";      run d2-quiet;          mark quiet end "opted out"; fi
if on d3; then mark masked start "40 us again";   run d3-opt-in;         mark masked end "40 us again"; fi
if on e1; then run e1-relaunch; fi
if on e1; then sleep 30; fi
if on e1; then curl -sk -X POST https://localhost/__quit >/dev/null; echo "$(date +%T) done"; fi
