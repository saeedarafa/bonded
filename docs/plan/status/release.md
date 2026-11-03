# Release validator status
Updated: 2026-11-03 · Branch: release/REL-03b-se-rerun · Milestone: M2

## Resume here
<!-- Keep this current after every step: the next AI (Claude, Codex or Copilot) starts from it. -->
- Last AI / date: Claude Code · 2026-11-03
- Branch + last commit: release/REL-03b-se-rerun, from origin/main 1f59f57 (includes #42 fixes for #32 #33 #36 #37; does NOT include MOB-32 / PR #56).
- Uncommitted work: none
- Exact next step: SE rows done by hand (18, 19, J7, 20, 23, 24 pass light/dark/AX2; new: J7 field hidden behind the pinned button when the keyboard opens). Next: #36 (11, scenario solo-invite-pending), #37 items (07, 13, 02 label, AX5 tab bar), then write qa/release/reports/REL-03b-se-rerun-ios.md. Evidence so far in qa/release/evidence/1f59f57-ios-sim/ (B-18-*, B-J7-*, B-19-*, B-20-*, B-21-*, B-23-*, B-24-*).
- Commands to re-run: build = `qa/e2e/README.md` "iOS simulator build"; keys from `(cd ~/dev/bonded-qa && supabase status -o env)`; seed `SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run qa:scenario <id>`; Maestro needs `PATH=/opt/homebrew/opt/openjdk@17/bin:$PATH`.
- Watch out for: the old sims 7CF5DC3B / 9B4414FE no longer exist on this Mac (simulator set was replaced). Created my own on iOS 18.0: A = "REL-A iPhone 16 Pro Max" E90AE3CD-873E-4237-89DC-5211A5D03243, B = "REL-B iPhone SE 3rd" D057FF7E-0B4C-4831-A818-AF41BB1796C7. Don't use FD513DB2 (booted by someone else), 3932C65B, 91551F29, B46EDC57, EB26CCED. Shared stack in ~/dev/bonded-qa: never db reset/stop/migrate. Taps are often dropped: check the screen after each tap.

## Doing
- REL-03: report done (qa/release/reports/REL-03-m2-dry-run-ios.md), PR #40 open for lead review; QA daily `reveal` suite PASS on this build, `first` fails on the SE because of #33

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
