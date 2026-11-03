# Release validator status
Updated: 2026-11-03 · Branch: release/REL-03c-se-mob34 · Milestone: M2

## Resume here
<!-- Keep this current after every step: the next AI (Claude, Codex or Copilot) starts from it. -->
- Last AI / date: Claude Code · 2026-11-03 21:30
- Branch + last commit: release/REL-03c-se-mob34 (from origin/main bb55edc; build target e47fb70 = merge of #73 MOB-34)
- Uncommitted work: status only
- Exact next step: REL-03c. iOS Release sim build of e47fb70 (incremental, no native dep change since 1f59f57), install on A E90AE3CD + B D057FF7E, then on B (SE) re-run #65 (J7/19/20 keyboard + AX2/AX5), #66 (07 keyboard/next/Continue; 24 at AX5), #68 (no review prompt in a signed-out-start session; allowed on a later open after 25), smoke 56 and J10. Report qa/release/reports/REL-03c-se-mob34-ios.md, PR, close passing issues.
- Commands to re-run: build = `qa/e2e/README.md` "iOS simulator build" (no prebuild needed for e47fb70); helpers in /tmp/rel03c/env.sh (scratch, not in repo); seed `npm run qa:scenario <id>`.
- Watch out for: shared stack has migrations up to 20261103150000 (send_nudge) but NOT 20261103160000 (approval_race_expiry): don't migrate it; only join-request approval is affected. Don't use 3932C65B (QA). Reseeding deletes auth users, so a signed-in sim is signed out after any reseed. #65 was auto-closed by #73's merge: verify and comment (reopen if it fails).

## Doing
- REL-03b: report done (qa/release/reports/REL-03b-se-rerun-ios.md), PR #67 open for lead review.

## Done (since last update)
- REL-03 merged (#40).
- REL-03b SE re-run on main 1f59f57 (iOS sim Release build, iPhone SE 3rd gen): 18, J7, 19, 20, 23, 24 pass in light, dark and 200% (#32 and #33 verified fixed); #36 verified fixed (11 card + mascot label); #37 app-side items verified (07, 13, "You" initial, 02 label, AX5 tab labels). Extra: SCR-09-DATA pass, SCR-J6-BEH pass, SCR-J6-DATA blocked (partner ritual flag off). Typed-code pairing: not in build (MOB-32). Comments posted on #32 #33 #36 #37 (already closed). New: #65 (sev-3), #66 (sev-4).

## Next
- Typed-code pairing (FUN-02) after MOB-32 / PR #56 merges.
- Pro Max pass after #42; UI-04, 22 typing presence, warm-start links.
- REL-04 (M3) when the lead posts "Build X ready".

## Blocked
- Android rows: emulator not set up (PO).
- Device-only checks (haptics, Apple/Google sign-in, push, offline, VoiceOver, EAS Update): need a device/EAS build.
- SCR-J6-DATA: `PARTNER_RITUAL_AVAILABLE = false` (backend partner ritual-time RPC).

## Needs from
- mobile: #65 (sev-3) on the iPhone SE, the focused J7 field sits behind the pinned "Lock in" until you scroll; at 200% the 19/20 body is very short. #66 (sev-4) 07 keyboard covers Continue (only Return closes it); at AX5 the Today header doesn't scroll. #37 leftovers (J5 line, 56, J10) per PR #42.
- lead: triage #65/#66; confirm when the OS review prompt should appear (seen right after 25 "Keep going" on sign-in, REL-03b §7); #37 leftovers (56/J10 copy as a DESIGN_DELTA variant?); earlier asks still open: SCR-03-DATA destination, scope-map notes (38, 10, 32, 31), Spicy wording in the release-check skill/agent file, #38 status.
- qa: none new (QA suites were not re-run on 1f59f57).
- backend: partner ritual-time RPC for J6 (SCR-J6-DATA); BE-10 `send_nudge` for FUN-10/23 pinned nudge.
- PO: Android emulator on this Mac; real domain for universal links and Terms/Privacy (IOS-03, PRIV-03); a device/EAS build for the device-only checks.

## Contract changes in flight
- —

## Questions for the product owner
- —
