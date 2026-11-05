# Release validator status
Updated: 2026-11-04 · Branch: release/REL-03d-se-promax · Milestone: M2

## Resume here
<!-- Keep this current after every step: the next AI (Claude, Codex or Copilot) starts from it. -->
- Last AI / date: Claude Code · 2026-11-05
- Branch + last commit: release/REL-03d-se-promax from origin/main 6f8b851 (see `git log -1`).
- Task: REL-03d = SE re-run of MOB-41 (#84 #85 #86, 48 h rule), 16 Pro Max M2 pass of screens touched since MOB-34, MOB-40 token-link check.
- Build: iOS Release sim build of 6f8b851 (incremental; bundle -> 127.0.0.1:54321, entitlements present, sha256 main.jsbundle f948d626...), installed on A and B.
- Uncommitted work: none.
- Step 1 (SE, B = iPhone SE 3rd gen, iOS 18.0) DONE, all pass, evidence `qa/release/evidence/6f8b851-ios-sim/B-*`:
  - #84 pass (19 AX5 keyboard light/dark: top bar y 20-76, field y 90-407 visible): https://github.com/saeedarafa/bonded/issues/84#issuecomment-6654421559
  - #85 pass (J7 + 19 default light/dark: counter y 276-295 and privacy line y 303-323 above footer y 335): https://github.com/saeedarafa/bonded/issues/85#issuecomment-6654421990
  - #86 pass (20 AX5 light/dark: chip stacked, "Sam" on one line): https://github.com/saeedarafa/bonded/issues/86#issuecomment-6654422490
  - 48 h milestone rule (MOB-41), default text size: `streak-11-your-turn` Maya sign-in -> Today, no 25 (B-48h-s11-after-signin.png, -15s.png): pass. `streak-6-milestone` sign-in -> no 52b (B-48h-s6-after-signin*.png); answering -> 21 -> 25 shown (B-48h-s6-21.png, B-48h-s6-25.png, B-48h-s6-after-keep-going.png): pass.
  - All three issues were already closed; nothing failed, so no reopen request.
  - New (to file, in the REL-03d report): 08 email/code field behind the keyboard on SE (B-08-kb-typed, B-08-code-kb; no keyboard avoidance in SignInView since MOB-08); 29 History title breaks mid-word at AX5 (B-26-AX5-title-light, M3).
- Step 2 (Pro Max, A = REL-A iPhone 16 Pro Max E90AE3CD, iOS 18.0) IN PROGRESS, evidence `qa/release/evidence/6f8b851-ios-sim/A-*`. 200% = `content_size accessibility-large` (AX2, fontScale 1.94; Pro Max is not "cramped" at AX2, so footers stay pinned).
  - Already had: 01 (light/dark/AX2), 08 returning (light/dark, kb), 18 (light/dark/AX2), 19 (kb light/dark, AX2, AX2 kb).
  - Done this run: 02, 03, 04, 05, 06, 07 (+ AX2 keyboard), 47 onboarding (+ AX2 scrolled), 08 onboarding AX2 (+ scrolled): light/dark/AX2.
  - Also done: 08 returning AX2 (01 "I already have an account" -> 08, A-08-returning-AX2-light), J7 light/dark/AX2 (+ AX2 scrolled, AX2 keyboard).
  - Also done: 24 (light/dark/AX2 + scrolled) and 20 (light/dark/AX2 + AX2 scrolled) on `streak-11-both-answered` as Maya.
  - Left: J2.
- Exact next step: step 2 continued: `solo-invite-pending` J2 (link `bonded://j/BND4827?t=dev-seed-token-4827`). Then step 3 token links (MOB-40), then the REL-03d report + PR.
- Commands: `source /tmp/rel03c/env.sh` (set EV to .../evidence/6f8b851-ios-sim). Seed only `npm run qa:scenario <id>`.
- Watch out for: live `simctl ui content_size` changes do not always re-render on the loaded machine: toggle appearance dark->light after each change (`fresh` / `tri` in /tmp/rel03c/env.sh) and check the shot. On the SE QA's sign-in subflow fails (Send code behind keyboard): use /tmp/rel03c/flows/signin-se.yaml (Enter key). Maestro tapOn by id taps the element centre even when off-screen (hit the tab bar): tap by point. Never 3932C65B / 02B00957; never db reset/stop/migrate. At AX2/AX5 sign in at `content_size large` first.

## Doing
- REL-03c: report done (qa/release/reports/REL-03c-se-mob34.md), PR #88 open for lead review.

## Done (since last update)
- REL-03c SE re-run of MOB-34 on e47fb70 (iOS sim Release build, iPhone SE 3rd gen): #65 pass (J7 default light/dark, 19/20 at 200%), #66 pass (07 keyboard light/dark, 24 at AX5), #68 pass (no review sheet in a sign-in session x3; sheet on a later app open after 25), 56 and J10 copy pass. New: #84 (sev-3), #85 (sev-4), #86 (sev-4). Comments posted on #65 #66 #68.
- REL-03 merged (#40).
- REL-03b SE re-run on main 1f59f57 (iOS sim Release build, iPhone SE 3rd gen): 18, J7, 19, 20, 23, 24 pass in light, dark and 200% (#32 and #33 verified fixed); #36 verified fixed (11 card + mascot label); #37 app-side items verified (07, 13, "You" initial, 02 label, AX5 tab labels). Extra: SCR-09-DATA pass, SCR-J6-BEH pass, SCR-J6-DATA blocked (partner ritual flag off). Typed-code pairing: not in build (MOB-32). Comments posted on #32 #33 #36 #37 (already closed). New: #65 (sev-3), #66 (sev-4).

## Next
- Typed-code pairing (FUN-02) after MOB-32 / PR #56 merges.
- Pro Max pass after #42 and MOB-34 (DailyFrame, OnboardingFrame, Today changed); UI-04, 22 typing presence, warm-start links.
- REL-04 (M3) when the lead posts "Build X ready".

## Blocked
- Android rows: emulator not set up (PO).
- Device-only checks (haptics, Apple/Google sign-in, push, offline, VoiceOver, EAS Update): need a device/EAS build.
- SCR-J6-DATA: `PARTNER_RITUAL_AVAILABLE = false` (backend partner ritual-time RPC).

## Needs from
- mobile: #84 (sev-3) 19 at AX5 on the SE: pinned "Today's question" title fills y 20-406, field invisible while typing. #85 (sev-4) J7/19 counter and privacy line behind the pinned button while typing. #86 (sev-4) 20 at AX5 sealed-card name breaks per letter. J5 pair summary still blocked on backend (MOB-34).
- lead: review/merge the REL-03c PR; close #66 and #68 (pass); triage #84/#85/#86; is the seeded "unseen milestone" catch-up on sign-in (25 at streak 11, 52b at streak 6) intended?; earlier asks still open: SCR-03-DATA destination, scope-map notes (38, 10, 32, 31), Spicy wording in the release-check skill/agent file, #38 status.
- qa: `.maestro/pairing/joiner-couple-full.yaml` still expects J10 -> `01-start`; since D37 a signed-in joiner gets "Back to my space" -> Today. Its tap-away can also cancel the D37 sheet on 12 for a solo joiner.
- backend: partner ritual-time RPC for J6 (SCR-J6-DATA); BE-10 `send_nudge` for FUN-10/23 pinned nudge.
- PO: Android emulator on this Mac; real domain for universal links and Terms/Privacy (IOS-03, PRIV-03); a device/EAS build for the device-only checks.

## Step 2 findings (Pro Max, for the REL-03d report; not filed yet)
- 47 Key dates, AX2 light: partner-birthday row label breaks one letter per line ("RileyNoor's birthday", row 619 pt tall) and "Anniversary" breaks mid-word; the trailing "Add date"/"<partner> adds it" value never shrinks. Evidence A-47-AX2-scrolled-light.png, A-47-AX2-scrolled2-light.png, A-47-AX2-scrolled-hierarchy.txt. Suggested sev-3 (M3 screen; still usable).
- J7, AX2 with keyboard (Pro Max): the two-line pinned "Lock in and reveal Maya's" button (y 483-594) covers the "Private until you both answer" line (y 450-531); on 19 the one-line button clears it (A-19-AX2-kb-hierarchy). Evidence A-J7-AX2-kb-light.png, A-J7-AX2-kb-hierarchy.txt. Suggested sev-4 (same class as #85).
- 20 Hold to reveal, AX2: the "Hold to reveal Sam's answer" label is left-aligned once it wraps (centred at default size; HoldToReveal label has no textAlign). Evidence A-20-AX2-light.png, A-20-AX2-scrolled-light.png. Suggested sev-4.
- 04 How it works, AX2: step number glyphs overflow their fixed-size circles. Evidence A-04-AX2-light.png, A-04-AX2-step-crop.png. Suggested sev-4.

## Contract changes in flight
- —

## Questions for the product owner
- —
