# Release validator status
Updated: 2026-11-03 · Branch: release/REL-03c-se-mob34 · Milestone: M2

## Resume here
<!-- Keep this current after every step: the next AI (Claude, Codex or Copilot) starts from it. -->
- Last AI / date: Claude Code · 2026-11-04 16:35
- Branch + last commit: release/REL-03c-se-mob34 (see `git log -1`); PR #88 `[REL-03c] SE re-run of MOB-34` open for the lead.
- Build: iOS Release sim build of e47fb70, 0.1.0 (1), on A E90AE3CD (16 Pro Max) and B D057FF7E (SE 3rd). Still installed.
- Uncommitted work: none. Evidence in qa/release/evidence/e47fb70-ios-sim/ (git-ignored); pre-build files in `_stale-before-2214/` (unused).
- REL-03c is done: report qa/release/reports/REL-03c-se-mob34.md. #65 pass (closed, left closed), #66 pass, #68 pass (both commented, ready for the lead to close), 56 + J10 pass. New: #84 (sev-3, 19 AX5 header), #85 (sev-4, J7/19 counter behind button), #86 (sev-4, 20 AX5 sealed-card name).
- Exact next step: wait for lead review of the PR; then the Next list below (typed-code pairing, Pro Max pass on MOB-34, REL-04).
- Commands: `source /tmp/rel03c/env.sh` (scratch helpers, not in repo; may be gone after a reboot: recreate from the REL-03b/03c notes). Seed only `npm run qa:scenario <id>`.
- Watch out for: at AX2/AX5 the 01 "I have an invite code" link is off-screen, so sign in at `content_size large` first, then switch. After a sim reboot the software keyboard appears only after typing. Maestro `scrollUntilVisible` on Today sometimes lands on History (swipe hits the tab bar): use mid-screen swipes. QA's tap-away step cancels the D37 sheet on 12 for a solo joiner. Never 3932C65B; never db reset/stop/migrate.

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

## Contract changes in flight
- —

## Questions for the product owner
- —
