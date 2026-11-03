# Release validator status
Updated: 2026-11-03 · Branch: release/REL-03c-se-mob34 · Milestone: M2

## Resume here
<!-- Keep this current after every step: the next AI (Claude, Codex or Copilot) starts from it. -->
- Last AI / date: Claude Code · 2026-11-03 22:25 (stopped on PO order mid-run)
- Branch + last commit: release/REL-03c-se-mob34 (see `git log -1`; status-only commits on top of bb55edc)
- Build: iOS Release sim build of e47fb70 (worktree HEAD app code == e47fb70; origin/main 467f15f has no app change since). Bundle 22:14, `127.0.0.1:54321` count 1, `__entitlements` present, 0.1.0 (1). Installed on A E90AE3CD (16 Pro Max) and B D057FF7E (SE 3rd). No rebuild needed.
- Uncommitted work: none. Evidence so far in qa/release/evidence/e47fb70-ios-sim/ (git-ignored): B-18-day1-light, B-18-day1-hierarchy.txt, B-J7-light, B-J7-hierarchy.txt, B-J7-keyboard-open, B-J7-keyboard-hierarchy.txt.
- Rows done: none written up yet. Partial #65 J7: Sam (paired-day1-partner-answered) on B, default size, light: keyboard open with text typed, field y 233-321 sits above pinned 19-submit y 335-391 (before the fix: field 317-405 behind the button). Looks like a pass; screenshot B-J7-keyboard-open not yet viewed.
- Rows remaining: #65 J7 (view screenshot, dark), 19/20 keyboard + AX2 (`streak-11-your-turn`, Maya; `xcrun simctl ui $B content_size accessibility-large`) and AX5 (`accessibility-extra-extra-extra-large`); #66 07 (fresh install 01-start -> 07: keyboard, Return/next moves to 07-partner, tap outside/drag closes, Continue 07-next reachable) and 24 at AX5 (`streak-11-both-answered`, Maya); #68 (negative: fresh install, seed streak-11-your-turn, sign in Maya, 25 -> Keep going -> no review sheet; positive: reseed streak-6-milestone, fresh install, sign in Maya, terminate + relaunch (session 2), answer + hold reveal -> 25 -> Keep going -> sheet expected); smoke 56 (`invite-expired`, signed out, 01-code -> 4827: 56-expired, 56-ask, join-code-retry) and J10 (`couple-full`, Lea signed in, bonded://join, 4827: J10-own label "Back to my space" -> '/'). Then report qa/release/reports/REL-03c-se-mob34-ios.md from TEMPLATE, comment/close #65 #66 #68 (reopen #65 on fail), PR.
- Exact next step: on B, J7 is open with the keyboard up: view B-J7-keyboard-open (`small B-J7-keyboard-open`, read /tmp/rel03c/s/), then `xcrun simctl ui $B appearance dark` and repeat; then move on to 19/20.
- Commands to re-run: `source /tmp/rel03c/env.sh` (helpers: seed, mrun, tap, hier, shot, small, scr; scratch, not in repo); seed `npm run qa:scenario <id>` only; sign in via `mrun $B /tmp/rel03c/flows/persona.yaml -e EMAIL=<persona>@bonded.test`.
- Watch out for: Mac load average ~190: `maestro hierarchy` can take >2 min, taps get dropped (one tap landed back on Today); check the screen after each step and retry. Shared stack: no db reset/stop/migrate (it lacks 20261103160000; only join-request approval affected). Never use 3932C65B (QA). Reseeding deletes auth users, so a signed-in sim is signed out. #65 was auto-closed by #73: comment, reopen if it fails.

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
