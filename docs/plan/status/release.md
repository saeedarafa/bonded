# Release validator status
Updated: 2026-11-12 · Branch: release/REL-07b-fix-checks · Milestone: M5

## Resume here
<!-- Keep this current after every step: the next AI (Claude, Codex or Copilot) starts from it. -->
- Last AI / date: Claude Code · 2026-11-12
- Branch + last commit: release/REL-07b-fix-checks (from origin/main e3589e9); see `git log -1`. Uncommitted files: none.
- Task: REL-07b = device re-check of #270, #271, #272 (PR #276) and #264 (PR #268). DONE; report `qa/release/reports/REL-07b-fix-checks.md`, PR open.
- Results: all pass. iOS REL-A: #270 title "Daily question" (day-ended runner PASS), #271 dark cold start (luma <= 70 every frame), #272 no `UIBackgroundModes`, kiss sound + voice playback play in the foreground (CoreAudio/AVPlayer logs). Android emulator-5554: #271 dark cold start, #272 no FOREGROUND_SERVICE*/AudioControlsService in the merged manifest, #264 keyboard on 08, 19, 22, 27 (fields above the keyboard; 27's Send reachable by scrolling). Comments with evidence on #270 #271 #272 #264 (all already closed by the merges). New: #280 (sev-4) 22 past-day thread titled "Today's thread".
- Evidence (git-ignored, local only): `qa/release/evidence/e3589e9-rel07b/`.
- Cleanup done: REL-A shut down (appearance light); emulator killed (night mode set back to no); stack `rel07b` stopped with `--no-backup`, /tmp/rel07b deleted; `ios/`, `android/`, `qa/e2e/out`, worktree node_modules deleted.
- Exact next step: wait for lead review of the REL-07b PR.
- Commands to re-run: as REL-07 below, project `rel07b`, ports 575xx; iOS build adds `EXPO_PUBLIC_SHIP_VOICE=1`. Android: `npx expo prebuild -p android --no-install`, `git checkout -- package.json`, add `android:usesCleartextTraffic="true"` to `<application>` in the generated manifest, `EXPO_PUBLIC_SUPABASE_URL=http://10.0.2.2:57521 ... ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a`; merged manifest at `android/app/build/intermediates/merged_manifest/release/processReleaseMainManifest/AndroidManifest.xml`.
- Watch out for: the AVD `Medium_Phone_API_37.0` has 1 core / 2 GB and no quick-boot snapshot; plain `emulator -avd` cold boot did not finish in 50 min. Start it with `emulator -avd Medium_Phone_API_37.0 -no-snapshot-save -cores 4 -memory 4096` (boots in seconds). Maestro on it is very slow (`eraseText` in sign-in stalls, `viewHierarchy` times out); `adb shell input` + `uiautomator dump` (about 45 s) work. Voice playback test data: m4a via `afconvert`, upload with the service key to `voice/<couple>/<sam>/<uuid>.m4a`, insert the voice answer (needs an active entitlement). Previous REL-07 commands: copy `supabase/` to /tmp/<id>, set `project_id` and ports 575xx (api 57521, db 57522, shadow 57520, pooler 57529, studio 57523, mail 57524, analytics 57527, inspector 57583); `supabase start -x studio,imgproxy,vector,logflare,supavisor,edge-runtime,postgres-meta`; runners with `SUPABASE_PROJECT_ID=<id> SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:57522/postgres MAILPIT_URL=http://127.0.0.1:57524`. Don't start history/day-ended runners in the 5 min before Europe/Berlin midnight. Simulators: only REL-A / REL-B, never create, shut down after use.

## Doing
- REL-07b: PR open for lead review.

## Done (since last update)
- REL-07b on main e3589e9: #270, #271, #272 (iOS REL-A) and #271, #272, #264 (Android 17 emulator) verified fixed; evidence comments posted. Filed #280 (sev-4).
- REL-07 M5 device checks on iOS sim (main 8e6b5d8): FUN-21, FUN-22 + BIZ-20 (free and Premium), FUN-23, MOB-67 server switch (survives reinstall), MOB-65 in-app sound gated by the switch, MOB-66 five moments + ~60 fps proxy + reduce motion, MOB-31/A11Y-03, MOB-24b default on + survives restart/reboot: pass. Filed #270, #271, #272.
- REL-06 checklist rows: PR #225 merged.
- REL-05 checklist: merged.
- REL-03d on 6f8b851 (iOS sim Release build): SE re-run of MOB-41 pass (#84 #85 #86, 48 h rule; comments posted); Pro Max light/dark/200% pass of 01-08, 47, 18, 19, J7, 24, 20, J2 (44 pass, 2 fail: J2 and 47 at 200%); MOB-40 links (a) cold, (b) warm, (c) signed-in solo with token and (d) tokenless -> J3 with 4827: all pass. New: #104 #105 #106 (sev-3), #107 #108 #109 #110 (sev-4).
- REL-03c SE re-run of MOB-34 on e47fb70 (iOS sim Release build, iPhone SE 3rd gen): #65 pass (J7 default light/dark, 19/20 at 200%), #66 pass (07 keyboard light/dark, 24 at AX5), #68 pass (no review sheet in a sign-in session x3; sheet on a later app open after 25), 56 and J10 copy pass. New: #84 (sev-3), #85 (sev-4), #86 (sev-4). Comments posted on #65 #66 #68.
- REL-03 merged (#40).
- REL-03b SE re-run on main 1f59f57 (iOS sim Release build, iPhone SE 3rd gen): 18, J7, 19, 20, 23, 24 pass in light, dark and 200% (#32 and #33 verified fixed); #36 verified fixed (11 card + mascot label); #37 app-side items verified (07, 13, "You" initial, 02 label, AX5 tab labels). Extra: SCR-09-DATA pass, SCR-J6-BEH pass, SCR-J6-DATA blocked (partner ritual flag off). Typed-code pairing: not in build (MOB-32). Comments posted on #32 #33 #36 #37 (already closed). New: #65 (sev-3), #66 (sev-4).

## Next
- Typed-code pairing (FUN-02) after MOB-32 / PR #56 merges.
- UI-04, 22 typing presence; SE at 200% for J2 and 47 after the fixes.
- REL-04 (M3) when the lead posts "Build X ready"; Android rows on the emulator.
- First run of the REL-05 rows once MOB-60–64 and BE-46–48 merge.
- REL-07 rows on Android (emulator): FUN-21/22/23, 41 switch, gesture moments, 40 Share usage data. Device-only halves (FUN-24 push, sounds heard, haptics) on the first EAS build; BIZ-19 with a RevenueCat sandbox key; MOB-24b no-traffic check with a PostHog test key (QA-08).
- BIZ-21/BIZ-22 with QA-36; IOS-03/AND-03/PRIV-03 once LEAD-04 hosts trybonded.com; HYG-06 on an EAS build.

## Blocked
- Device/EAS-only checks: push delivery, Apple/Google sign-in, haptics, store purchases/restore and store checks (both platforms). Android everything else runs on the local emulator (AVD Medium_Phone_API_37.0, `npm run android`).
- SCR-J6-DATA: `PARTNER_RITUAL_AVAILABLE = false` (backend partner ritual-time RPC).

## Needs from
- lead (REL-07b): review the PR; triage #280 (sev-4, 22 past-day title "Today's thread", mobile).
- qa / founder (REL-07b): the AVD `Medium_Phone_API_37.0` is set to 1 CPU core and 2 GB RAM and lost its quick-boot snapshot, so a cold boot does not finish; raise cores/RAM in Device Manager (or always start it with `-cores 4 -memory 4096`). Do not create a new AVD.
- lead (REL-07): review the PR; triage #270 (sev-4), #271 (sev-4), #272 (sev-3, store policy: fix before any store submission).
- mobile (REL-07): #272 set `enableBackgroundPlayback: false` on the expo-audio plugin (Info.plist `UIBackgroundModes audio`, Android foreground-service permissions); #271 dark/cream launch screen (expo-splash-screen `dark` variant); #270 19 title from the question source, not the route. Optional: refetch Today on cold start when the persisted cache is < 30 s old (residual risk in the REL-07 report).
- qa (REL-07): #275 (sev-3) `qa/contract/little-things.test.ts` fails every night 23:00-07:00 UTC (Sam's quiet hours not pinned); it made PR #274's `db-reset`/`ci-ok` red (docs-only PR). Also avoid starting `history`/`day-ended` suites right before Europe/Berlin midnight (day rollover mid-flow); a `history locked` run failed that way.
- PO: a device/EAS build plus RevenueCat sandbox and PostHog test keys for the blocked REL-07 halves.
- lead (REL-06, merged as #225): for the scope-map sources of `screen-requirements.csv`, please carry D55/D56/D08/D48 into the notes of 29, 30, 22, 42, 58, 41, 55, 19 (and the 17/34 History row) so I can drop those override rows.
- lead (REL-05): review the PR. For LEAD-13, update the sources of `qa/release/screen-requirements.csv` (scope-map.json notes and/or screens.json via PO) so the generated rows match D50–D53, then I drop the override table in RC_CHECKLIST: add T1, N, L, P2, P3 (P0, M5; MOB-60–62, BE-48); 14 BEH "Day-3 gift on the first 3-day streak badge, replaces 52b; once per couple; never after a trial or subscription", 14 DATA "couple_offers kind day3 eligibility (server)"; 15 BEH "Real 12 h countdown from first open, no extension; prices from RevenueCat", 15 DATA "RevenueCat offering day3, offer.expires_at (12 h from first open)"; 16 DATA "RevenueCat offering default; no trial shown on 16"; 17 BEH "D51 table, only shipped rows (D27); trial button only when trial-eligible"; 33 BEH/DATA "Sample question to read; no free pack question (D51)"; 34 BEH "17 rows, no trial, never Couple report (D53)"; 36 retired. Also the LEAD-13 P2 source note path, which BIZ-14 checks against.
- mobile (REL-05): please expose test ids on P3 (plan cards, CTA, ×), 17 (rows, main button) and the Today gift chip so FUN-17/BIZ-13/BIZ-15/BIZ-05 can be scripted.
- lead: review the REL-03d PR; triage #104-#110. Note: in REL-03d (c) Lea's join was committed at 11:28:40Z while the D37 sheet sat unattended on REL-A (no validator tap; probably the harness). Suggest QA adds a test that leaves the D37 sheet open and checks nothing is joined.
- mobile: #104 (sev-3) SE 08 fields behind the keyboard; #105 (sev-3) J2 no scroll at 200%; #106 (sev-3) 47 letter-by-letter labels at 200%; #107 #108 #109 #110 (sev-4).
- mobile: #84 (sev-3) 19 at AX5 on the SE: pinned "Today's question" title fills y 20-406, field invisible while typing. #85 (sev-4) J7/19 counter and privacy line behind the pinned button while typing. #86 (sev-4) 20 at AX5 sealed-card name breaks per letter. J5 pair summary still blocked on backend (MOB-34).
- lead: review/merge the REL-03c PR; close #66 and #68 (pass); triage #84/#85/#86; is the seeded "unseen milestone" catch-up on sign-in (25 at streak 11, 52b at streak 6) intended?; earlier asks still open: SCR-03-DATA destination, scope-map notes (38, 10, 32, 31), Spicy wording in the release-check skill/agent file, #38 status.
- qa: `.maestro/pairing/joiner-couple-full.yaml` still expects J10 -> `01-start`; since D37 a signed-in joiner gets "Back to my space" -> Today. Its tap-away can also cancel the D37 sheet on 12 for a solo joiner.
- backend: partner ritual-time RPC for J6 (SCR-J6-DATA); BE-10 `send_nudge` for FUN-10/23 pinned nudge.
- PO: a device/EAS build for the device-only checks (domain answered: trybonded.com).

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
