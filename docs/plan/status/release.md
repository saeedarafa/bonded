# Release validator status
Updated: 2026-11-03 · Branch: release/REL-03-m2-dry-run · Milestone: M2

## Resume here
<!-- Keep this current after every step: the next AI (Claude, Codex or Copilot) starts from it. -->
- Last AI / date: Claude Code · 2026-11-03
- Branch + last commit: release/REL-03-m2-dry-run (from origin/main f9765da), pushed. PR "[REL-03] M2 dry run (iOS simulator)" into main.
- Uncommitted work: none
- Exact next step: lead reviews the PR and triages #32 #33 #36 #37 #38. Next validator run: re-run the iPhone SE rows (18, 19, J7, 20, 23, 24) once #32/#33 are fixed, then the "not yet checked" rows in §5 of the report.
- Commands to re-run: build = `qa/e2e/README.md` "iOS simulator build" (incremental ~2 min); keys from `(cd ~/dev/bonded-qa && supabase status -o env)`; seed `SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run qa:scenario <id>`; sims A=7CF5DC3B (16 Pro Max), B=9B4414FE (SE 3rd), iOS 18.0; Maestro needs `PATH=/opt/homebrew/opt/openjdk@17/bin:$PATH`. `node scripts/plan/generate.mjs --check` before a run.
- Watch out for: shared Supabase stack lives in ~/dev/bonded-qa: never `db reset`/stop. Other agents use the booted sims 91551F29, B46EDC57, EB26CCED. Taps are often dropped on the first try (see report §7): check the screen after each tap. QA's pairing flows predate J6/09 (MOB-15). Evidence is git-ignored under qa/release/evidence/f9765da-ios-sim/. Push with `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push`.

## Doing
- REL-03: report done (qa/release/reports/REL-03-m2-dry-run-ios.md), PR open for lead review

## Done (since last update)
- REL-01, REL-02 merged into main.
- REL-03 M2 dry run, iOS simulator Release build of main f9765da against the shared local stack. M2 screen rows (76): 64 pass / 10 fail / 1 blocked / 1 not in build; Android all blocked (emulator). Reveal rule (FUN-04) passed by hand on two simulators: UI, early deep links to 20/21/22, and PostgREST as the user (no partner row before answering). Issues filed: #32 (sev-2), #33, #36, #38 (sev-3), #37 (sev-4).

## Next
- Re-run SE rows after #32/#33; the "not yet checked" rows (09-DATA, J6-BEH, UI-04, 22 typing, warm-start links, typed-code join to 13).
- REL-04 (M3) when the lead posts "Build X ready".

## Blocked
- Android rows: emulator not set up (PO).
- Device-only checks (haptics, Apple/Google sign-in, push, offline, VoiceOver, EAS Update): need a device/EAS build.

## Needs from
- mobile: #32 (sev-2) iPhone SE keyboard covers "Lock in" on 19/J7 and can't be dismissed; #33 (sev-3) Today CTA under the tab bar on SE (also 23, 24, 20); #36 (sev-3) 11 has no day-1 question card; #37 (sev-4) minor copy/layout differences (07, J5, 13, "Y" avatar, mascot labels, 56, J10, AX5 tab labels). Also: please check on a device whether the first tap on a control is sometimes ignored (report §7).
- lead: triage #38 (PRIV-04, OS share sheet logs the invite link with token) with security; decide SCR-03-DATA (`last_learned` has no destination in CONTRACTS/schema: store it or drop the row); decide whether the 56/J10 copy variants go into DESIGN_DELTA; earlier asks still open: scope-map notes (38, 10, 32, 31) and the Spicy wording in the release-check skill/agent file.
- qa: pairing flows on main predate MOB-15: `joiner-link-token`/`joiner-typed-code` stop on J6 after J5 (expect 13) and `inviter-waits` races (already on 13 when it asserts 11). Run on f9765da: errors J9/56 PASS, signed-in B PASS, link/typed/J10 FAIL (test-side). JUnit in qa/e2e/out/ of ~/dev/bonded-release.
- backend: #28 still open (no code in the sign-in mail); BE-10 `send_nudge` needed for FUN-10; partner ritual-time RPC for J6 default (SCR-J6-DATA).
- PO: Android emulator on this Mac; real domain for universal links and Terms/Privacy (IOS-03, PRIV-03); a device/EAS build for the device-only checks.

## Contract changes in flight
- —

## Questions for the product owner
- —
