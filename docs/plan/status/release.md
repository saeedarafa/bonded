# Release validator status
Updated: 2026-11-11 · Branch: release/REL-05-checklist-d50 · Milestone: M5

## Resume here
<!-- Keep this current after every step: the next AI (Claude, Codex or Copilot) starts from it. -->
- Last AI / date: Claude Code · 2026-11-11
- Branch + last commit: release/REL-05-checklist-d50 (from origin/main 87f3e3f), pushed; see `git log -1`. Uncommitted files: none.
- Task: REL-05 = RC_CHECKLIST for D50–D53 (+ D27, D47) and the Android-on-emulator update. DONE, PR open for lead review.
- What changed: qa/release/RC_CHECKLIST.md: Android-on-emulator note (device/EAS-only: push delivery, Apple/Google sign-in, haptics, purchases, store); decision map rows D47, D50–D53; override table for stale generated rows (14, 15, 16, 17, 33, 34, 36, and T1/N/L/P2/P3 with no rows yet); FUN-01 new order; new FUN-17 (onboarding order/content, joiner never sees P3), FUN-18 (T1 answer), FUN-19 (N/L), FUN-20 (38b widgets); UI-09 (new screens); BIZ-01/03/04/05/06/10/12 rewritten for D51–D53; new BIZ-13 (P3 incl. price math), BIZ-14 (P2 vs LEAD-13 sources), BIZ-15 (17 table + trial button), BIZ-16 (16/34 no trial, 16 never automatic), BIZ-17 (one full-screen offer/day, gift never after trial), BIZ-18 (P3 purchase before sign-in); AND-07 (back in new flows); STORE-03.
- screen-requirements.csv NOT edited: it is generated (`node scripts/plan/generate.mjs --check` runs in CI) from lead-owned scope-map.json + PO-owned screens.json. The override table in RC_CHECKLIST covers it until LEAD-13 updates the sources (see Needs from lead).
- Exact next step: wait for lead review of the REL-05 PR; then the Next list.
- Commands to re-run: `node scripts/plan/generate.mjs --check` (must print `up to date`).
- Watch out for: Android RC rows run on the emulator: `source ~/.zshrc; emulator -avd Medium_Phone_API_37.0`, wait for `adb shell getprop sys.boot_completed` = 1, `npm run android`. Earlier iOS gotchas (REL-03d): live `simctl ui content_size` changes need an appearance toggle to re-render; tap by point not id with Maestro off-screen; never db reset/stop/migrate; seed only with `npm run qa:scenario <id>`.

## Doing
- REL-05: checklist updated for D50–D53, D27, D47 and Android on the emulator; PR open for lead review.

## Done (since last update)
- REL-05 checklist (this branch).
- REL-03d on 6f8b851 (iOS sim Release build): SE re-run of MOB-41 pass (#84 #85 #86, 48 h rule; comments posted); Pro Max light/dark/200% pass of 01-08, 47, 18, 19, J7, 24, 20, J2 (44 pass, 2 fail: J2 and 47 at 200%); MOB-40 links (a) cold, (b) warm, (c) signed-in solo with token and (d) tokenless -> J3 with 4827: all pass. New: #104 #105 #106 (sev-3), #107 #108 #109 #110 (sev-4).
- REL-03c SE re-run of MOB-34 on e47fb70 (iOS sim Release build, iPhone SE 3rd gen): #65 pass (J7 default light/dark, 19/20 at 200%), #66 pass (07 keyboard light/dark, 24 at AX5), #68 pass (no review sheet in a sign-in session x3; sheet on a later app open after 25), 56 and J10 copy pass. New: #84 (sev-3), #85 (sev-4), #86 (sev-4). Comments posted on #65 #66 #68.
- REL-03 merged (#40).
- REL-03b SE re-run on main 1f59f57 (iOS sim Release build, iPhone SE 3rd gen): 18, J7, 19, 20, 23, 24 pass in light, dark and 200% (#32 and #33 verified fixed); #36 verified fixed (11 card + mascot label); #37 app-side items verified (07, 13, "You" initial, 02 label, AX5 tab labels). Extra: SCR-09-DATA pass, SCR-J6-BEH pass, SCR-J6-DATA blocked (partner ritual flag off). Typed-code pairing: not in build (MOB-32). Comments posted on #32 #33 #36 #37 (already closed). New: #65 (sev-3), #66 (sev-4).

## Next
- Typed-code pairing (FUN-02) after MOB-32 / PR #56 merges.
- UI-04, 22 typing presence; SE at 200% for J2 and 47 after the fixes.
- REL-04 (M3) when the lead posts "Build X ready"; Android rows on the emulator.
- First run of the REL-05 rows once MOB-60–64 and BE-46–48 merge.

## Blocked
- Device/EAS-only checks: push delivery, Apple/Google sign-in, haptics, store purchases/restore and store checks (both platforms). Android everything else runs on the local emulator (AVD Medium_Phone_API_37.0, `npm run android`).
- SCR-J6-DATA: `PARTNER_RITUAL_AVAILABLE = false` (backend partner ritual-time RPC).

## Needs from
- lead (REL-05): review the PR. For LEAD-13, update the sources of `qa/release/screen-requirements.csv` (scope-map.json notes and/or screens.json via PO) so the generated rows match D50–D53, then I drop the override table in RC_CHECKLIST: add T1, N, L, P2, P3 (P0, M5; MOB-60–62, BE-48); 14 BEH "Day-3 gift on the first 3-day streak badge, replaces 52b; once per couple; never after a trial or subscription", 14 DATA "couple_offers kind day3 eligibility (server)"; 15 BEH "Real 12 h countdown from first open, no extension; prices from RevenueCat", 15 DATA "RevenueCat offering day3, offer.expires_at (12 h from first open)"; 16 DATA "RevenueCat offering default; no trial shown on 16"; 17 BEH "D51 table, only shipped rows (D27); trial button only when trial-eligible"; 33 BEH/DATA "Sample question to read; no free pack question (D51)"; 34 BEH "17 rows, no trial, never Couple report (D53)"; 36 retired. Also the LEAD-13 P2 source note path, which BIZ-14 checks against.
- mobile (REL-05): please expose test ids on P3 (plan cards, CTA, ×), 17 (rows, main button) and the Today gift chip so FUN-17/BIZ-13/BIZ-15/BIZ-05 can be scripted.
- lead: review the REL-03d PR; triage #104-#110. Note: in REL-03d (c) Lea's join was committed at 11:28:40Z while the D37 sheet sat unattended on REL-A (no validator tap; probably the harness). Suggest QA adds a test that leaves the D37 sheet open and checks nothing is joined.
- mobile: #104 (sev-3) SE 08 fields behind the keyboard; #105 (sev-3) J2 no scroll at 200%; #106 (sev-3) 47 letter-by-letter labels at 200%; #107 #108 #109 #110 (sev-4).
- mobile: #84 (sev-3) 19 at AX5 on the SE: pinned "Today's question" title fills y 20-406, field invisible while typing. #85 (sev-4) J7/19 counter and privacy line behind the pinned button while typing. #86 (sev-4) 20 at AX5 sealed-card name breaks per letter. J5 pair summary still blocked on backend (MOB-34).
- lead: review/merge the REL-03c PR; close #66 and #68 (pass); triage #84/#85/#86; is the seeded "unseen milestone" catch-up on sign-in (25 at streak 11, 52b at streak 6) intended?; earlier asks still open: SCR-03-DATA destination, scope-map notes (38, 10, 32, 31), Spicy wording in the release-check skill/agent file, #38 status.
- qa: `.maestro/pairing/joiner-couple-full.yaml` still expects J10 -> `01-start`; since D37 a signed-in joiner gets "Back to my space" -> Today. Its tap-away can also cancel the D37 sheet on 12 for a solo joiner.
- backend: partner ritual-time RPC for J6 (SCR-J6-DATA); BE-10 `send_nudge` for FUN-10/23 pinned nudge.
- PO: real domain for universal links and Terms/Privacy (IOS-03, PRIV-03); a device/EAS build for the device-only checks.

## Step 2 findings (Pro Max; filed as #105 #106 #108 #109 #110)
- J2 Personal welcome, AX2 light: no ScrollView, so "This invite isn't for me" (J2-no y 898-1011) runs past the bottom of the screen (956) and swiping does nothing; on smaller phones or larger text both buttons would be cut. Evidence A-J2-AX2-light.png, A-J2-AX2-swiped-light.png, A-J2-AX2-ids.txt. Suggested sev-3 (M3 screen).
- 47 Key dates, AX2 light: partner-birthday row label breaks one letter per line ("RileyNoor's birthday", a 9-letter test name typed on 07; row 619 pt tall) and "Anniversary" breaks mid-word; the trailing "Add date"/"<partner> adds it" value never shrinks. Evidence A-47-AX2-scrolled-light.png, A-47-AX2-scrolled2-light.png, A-47-AX2-scrolled-hierarchy.txt. Suggested sev-3 (M3 screen; still usable).
- J7, AX2 with keyboard (Pro Max): the two-line pinned "Lock in and reveal Maya's" button (y 483-594) covers the "Private until you both answer" line (y 450-531); on 19 the one-line button clears it (A-19-AX2-kb-hierarchy). Evidence A-J7-AX2-kb-light.png, A-J7-AX2-kb-hierarchy.txt. Suggested sev-4 (same class as #85).
- 20 Hold to reveal, AX2: the "Hold to reveal Sam's answer" label is left-aligned once it wraps (centred at default size; HoldToReveal label has no textAlign). Evidence A-20-AX2-light.png, A-20-AX2-scrolled-light.png. Suggested sev-4.
- 04 How it works, AX2: step number glyphs overflow their fixed-size circles. Evidence A-04-AX2-light.png, A-04-AX2-step-crop.png. Suggested sev-4.

## Contract changes in flight
- —

## Questions for the product owner
- —
