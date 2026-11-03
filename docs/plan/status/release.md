# Release validator status
Updated: 2026-11-03 · Branch: release/REL-03b-se-rerun · Milestone: M2

## Resume here
<!-- Keep this current after every step: the next AI (Claude, Codex or Copilot) starts from it. -->
- Last AI / date: Claude Code · 2026-11-03
- Branch + last commit: release/REL-03b-se-rerun (from origin/main 1f59f57), pushed; PR "[REL-03b] iPhone SE re-run (iOS simulator)" into main.
- Uncommitted work: none
- Exact next step: lead reviews the REL-03b PR and triages #65 (sev-3) and #66 (sev-4). Next validator run: typed-code pairing once MOB-32 (PR #56) merges; the Pro Max (A) pass after #42's layout changes; the rest of the "not yet checked" rows (UI-04 loading, 22 typing presence, warm-start links).
- Commands to re-run: build = `qa/e2e/README.md` "iOS simulator build" (needs prebuild + pod install when native deps change; 1f59f57 added expo-store-review); keys from `(cd ~/dev/bonded-qa && supabase status -o env)`; seed `SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run qa:scenario <id>`; Maestro needs `PATH=/opt/homebrew/opt/openjdk@17/bin:$PATH`.
- Watch out for: the REL-03 sims 7CF5DC3B / 9B4414FE no longer exist. Validator sims now (iOS 18.0): A = "REL-A iPhone 16 Pro Max" E90AE3CD-873E-4237-89DC-5211A5D03243, B = "REL-B iPhone SE 3rd" D057FF7E-0B4C-4831-A818-AF41BB1796C7 (both left booted). Don't use FD513DB2, 3932C65B, 91551F29, B46EDC57, EB26CCED. Shared stack in ~/dev/bonded-qa: never db reset/stop/migrate. Seeding a streak-11 scenario shows 25 (7-day milestone) and then the OS review prompt on sign-in: tap Keep going, then "Not Now". Taps get dropped under load: check the screen after each tap. Evidence (git-ignored) in qa/release/evidence/1f59f57-ios-sim/.

## Doing
- REL-03b: report done (qa/release/reports/REL-03b-se-rerun-ios.md), PR open for lead review.

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
