# Release validator status
Updated: 2026-11-03 · Branch: release/REL-03c-se-mob34 · Milestone: M2

## Resume here
<!-- Keep this current after every step: the next AI (Claude, Codex or Copilot) starts from it. -->
- Last AI / date: Claude Code · 2026-11-04 14:35
- Branch + last commit: release/REL-03c-se-mob34 (see `git log -1`)
- Build: iOS Release sim build of e47fb70, 0.1.0 (1), installed on A E90AE3CD (16 Pro Max) and B D057FF7E (SE 3rd). No rebuild needed. Sims were shut down overnight; B rebooted 2026-11-04.
- Evidence: qa/release/evidence/e47fb70-ios-sim/ (git-ignored). Files dated before the 22:14 build moved to `_stale-before-2214/` (not used).
- Rows done: #65 J7 default light+dark PASS. 19 AX2 light+dark PASS (B-19-AX2-*: closed field y 457 in scroll, no pinned button; typing keeps field visible; Lock in reachable by scroll). 20 AX2 dark PASS (B-20-AX2-*). #68 negative PASS (fresh install + sign-in session, 25 at AX2 -> Keep going -> no review sheet, B-68-neg-*). Note: 25 shows "7 days" milestone at streak 11 on sign-in. J7 observation: counter + private line behind pinned button (sev-4 to file).
- Rows remaining: 19/20 AX2 + AX5 (`streak-11-your-turn`, Maya), #66 07 + 24 AX5, #68 neg/pos, 56, J10, report, issue comments, PR.
- Exact next step: reseed streak-11-your-turn, sign in Maya at default size, switch to AX5, check 19 (closed + keyboard). 20 AX5 + 24 AX5 already done (PASS, B-20-AX5-*, B-24-AX5-*). New sev-4: 20 AX5 sealed card name breaks per letter (B-20-AX5-sealed-name).
- Commands: `source /tmp/rel03c/env.sh` (scratch helpers); resume helper `/tmp/rel03c/resume.py`.
- Watch out for: after a sim reboot the software keyboard only appeared after an inputText (tap alone left it hidden); `AutomaticMinimizationEnabled` set NO on B. Shared stack: seed only. Never 3932C65B.

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
