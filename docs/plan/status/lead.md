# Lead architect status
Updated: 2026-11-03 · Branch: lead/MOB-auth-email · Milestone: M1

## Resume here
<!-- Keep this current after every step: the next AI (Claude, Codex or Copilot) starts from it. -->
- Email authentication follow-up (2026-11-03): initial mobile changes are committed at `4e2ef05` on `mobile/MOB-auth-email-links-final`; backend templates/redirect allow-list are committed at `afab10a` on `be/auth-email-link-code`. Product owner approved fixing the sole security concern (implicit-token callback session swapping) and committing SECURITY-REVIEW.md. Mobile remediation is in progress: PKCE-code callbacks only, with token-bearing callbacks rejected and manual OTP preserved. Pre-fix mobile suite (560), typecheck/lint and backend static Auth tests (4) passed; post-fix checks are pending. Native email round-trip and hosted Auth configuration remain unverified. Do not restart/reset QA's shared Supabase stack.
- Open PR check (2026-11-03): #41 remains based on `be/BE-25-solo-archive`; `app`, `db-reset`, `db-tests`, and `ci-ok` fail. Existing change requests still apply; do not merge. #35 remains `DIRTY`; `db-reset` and `ci-ok` fail, though app/db-tests/functions/plan/agents-sync pass. Existing avatar-removal request still applies; do not merge.
- Local preview troubleshooting (2026-11-03 10:23): Bonded was already installed on iPhone 16 simulator `B46EDC57-ADCE-453F-B9CC-079C40C5D463`. Launched `app.bonded.mobile` successfully and verified its welcome screen by `simctl io ... screenshot`. This is an existing bundled build, not a fresh main build or Metro live reload. Simulator GUI could not open: `/Applications/Xcode.app/Contents/Developer/Applications/Simulator.app` is missing. Root `ios/` remains incomplete after interrupted prebuild/pod installs; do not delete/regenerate it repeatedly. Expo is not the blocker. For future builds use the ad-hoc signing recipe in `qa/e2e/README.md` (not `CODE_SIGNING_ALLOWED=NO`, which breaks SecureStore). Restored only Expo's script rewrites in `package.json`; preserved `.env.example` edits. Left other worktrees/builds and the shared backend untouched.
- Last AI / date: Copilot (VS Code) · 2026-11-03. Continuing email sign-in follow-up.
- Branch + last commit: `lead/MOB-auth-email` @ `52bd4a6`, based on `origin/main`.
- Uncommitted work: `SECURITY-REVIEW.md`, CONTRACTS callback policy and this status update. Main checkout separately has local `.env.example` and `package.json` changes; do not touch or commit them.
- This session: confirmed #41 remains based on BE-25 with `app`, `db-reset`, `db-tests`, `ci-ok` failing; #35 remains dirty with `db-reset` and `ci-ok` failing. No existing PRs merged or changed. Added BE-27, refined MOB-08 acceptance, added QA-11, and documented the email auth contract. Reviewed both email branches; mobile full suite (560), typecheck, lint, backend Auth tests (4), generated-type and seed checks passed. Security follow-up and device/runtime verification remain outstanding.
- State per role:
  - Mobile: `mobile/MOB-auth-email-links-final` @ `4e2ef05` completed link callback + visible email label; native checks remain.
  - Backend: `be/auth-email-link-code` @ `afab10a` completed local Auth templates and callback redirect allow-list; hosted Auth settings and end-to-end mail remain unverified.
  - QA: `qa/QA-06-pairing-personas` @ 5a416a7; simulator build was blocked on an RNReanimated compile error (see qa.md); email runtime verification not run.
  - Release: waits until QA's simulator runs are finished.
  - Backend/security (Codex): #35 and #41 have review comments to address; SEC-02 not started.
- Exact next step: product owner approved options 2 and 3 (fix all findings and commit SECURITY-REVIEW.md). Mobile owner is removing implicit callbacks and adding regression tests on `mobile/MOB-auth-email-links-final`. After its completion, record the exact fix commit and validation results in the report and commit lead documentation. Then coordinate safe local mail round-trip and native-device checks. Hosted Auth settings remain unchanged. Keep #35 and #41 unmerged until their existing review requests and checks are resolved.
- Merged 2026-11-03: #23 QA-04b · #29 QA-05a · #30 MOB-09 fixes (#26, #27, inviter 11) · #17 BE-08 notify · #21 BE-25 (D04 archive) · #25 BE-20 (unread counts, private avatars) · #39 BE-15 feedback · #40 REL-03 M2 iOS dry run · #31 MOB-17 milestones/badges/review · #34 BE-06 completed_today. Backend merges done locally with conflict resolution (status/backend.md: kept main's; CONTRACTS rows combined).
- Open: #41 BE-26 (see review). #35 BE-16 delete-account: asked to remove `avatars/{uid}/avatar.jpg` + test, rebase. CI `db-reset` keeps failing on Docker Hub `toomanyrequests` (infra): re-run, or merge locally after DB suites pass and let main CI run db-reset.
- Lead decisions 2026-11-03: (1) D06 avatar: `avatars` stays private; `invite_preview.inviter_avatar_url` = null until BE-20b (signed URL via edge function, valid token only, P1 M3); J2 shows the initial. (2) Local stack: the one shared stack (project `bonded`, run from ~/dev/bonded-qa) belongs to QA; release/mobile may seed through QA's script but never `db reset`/stop it; QA E2E and release runs are not run at the same time; backend's Codex clone must use its own `project_id` + ports. (3) MOB-17 badge colours: board choice kept, flagged to the PO.
- REL-03 findings: #32 (sev 2, SE keyboard covers Lock in), #33 (sev 3, Answer under tab bar on SE), #36 (11 no day-1 card), #37 (sev 4 copy), #38 (PRIV-04 share sheet logs invite token: security triage), #28 (backend mail template).
- Commands to re-run: `git worktree list`; `gh pr list --state open`; `gh pr checks <n>`; `npm --prefix supabase/tests test`; `bash qa/ci/app.sh`
- Watch out for: push/fetch with `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' ...` (plain fetch hangs); no AI attribution; never touch ~/dev/bonded-be or ~/dev/codex-backend; PRs are from the PO's own account, so reviews are comments; main checkout's node_modules is stale (run `npm ci` before typecheck here).

## REL-03 brief (ready to delegate)
Start when QA-04b reports the app runs on an iOS 18 simulator against the local stack, and a sub-agent slot is free. Brief for the release validator, worktree ~/dev/bonded-release, branch `release/REL-03-m2-dry-run` from origin/main:
- Build identity: a local simulator build (not EAS) from a named `main` commit, built with the exact command QA recorded in qa/e2e/README.md; backend = local Supabase (`supabase status`), seeded scenarios from qa/fixtures; RevenueCat = none (purchases out of scope in M2). Record all of it in §1 of the report.
- Scope: M2 rows of `qa/release/screen-requirements.csv` whose tasks are merged (MOB-07, 08, 09, 10, 11, and 12 if merged); everything else in M2 is "not in build".
- iOS only for now. Android rows are `blocked: emulator not set up (PO)`. Simulator-impossible checks (real push, Sign in with Apple/Google on device, haptics, purchases, App Store items) are `blocked: needs device/EAS build`, never `pass`.
- Evidence: `xcrun simctl io <udid> screenshot`, light/dark via `xcrun simctl ui <udid> appearance`, large text via `xcrun simctl ui <udid> content_size`, reduced motion, VoiceOver labels via the accessibility inspector where possible. Store under `qa/release/evidence/<build>/` (git-ignored, per the bonded-release-check skill); the report cites the paths.
- Report: `qa/release/reports/REL-03-m2-dry-run-ios.md` from TEMPLATE.md. It is a dry run, so the verdict is a findings list, not a store GO. The reveal rule (FUN) must be checked by hand with two simulators.
- Bugs: GitHub issues with the screen id and evidence path; list them in docs/plan/status/release.md under Needs from. Only qa/release/** is writable.
- Git: plain git, never DEVELOPER_DIR; push with the gh credential helper; no AI attribution.

## Roles running outside
- Email follow-up tasks in this session: Mobile Developer in `/Users/saeedarafa/dev/bonded-auth-email-final` (`mobile/MOB-auth-email-links-final`) and Backend Data Developer in `/Users/saeedarafa/dev/bonded-be-auth-email-link-code` (`be/auth-email-link-code`). Coordinate through their commits and status files; do not edit their worktrees.
- Existing backend/security Codex worktrees and the mobile, QA and release worktrees are historical/inactive for this task; do not reuse their branches.

## Doing
- LEAD-00: repo on GitHub, CI green on main (all 7 jobs incl. db-reset); no branch protection by PO choice (private repo)
- M1 integration: merging role branches as they land (all roles run in Claude Code for now)

## Done (since last update)
- LEAD-00 (local): git init, first commit, CODEOWNERS (all @saeedarafa), PR template, .gitignore for machine-local files
- LEAD-01: kickoff answers recorded in DESIGN_DELTA (D02, D07, D21, D26, D32, D33, D34); BACKLOG re-scoped: MOB-30 widgets P0 M4–M5, new MOB-31 Rive mascot (M3), new LEAD-08 content drafts (M3–M4); scope-map 38 → P0 M4

## Next
- LEAD-00, LEAD-01, LEAD-03

## Blocked
- — (LEAD-00 branch protection dropped: PO keeps the repo private, no Pro; the lead merges only with green CI)

## Needs from
- Backend (Codex): **#41 BE-26: retarget to main + rebase, fix content.test.mjs (typed-code fixtures now pending → answers RLS), mark the accept_invite change breaking in CONTRACTS (see review).** #35 BE-16: delete the avatar object in delete-account + Deno test, rebase. Then BE-26 (D02 typed-code approval; BE-25 is merged), BE-10 nudges (BE-08 merged), BE-27 email templates + callback allow-list, issue #9 (QA-BUG-4), `streak-11-fresh-day` scenario once QA lists it in personas.json, the partner ritual-time read for J6 "Same as Maya", BE-20b (P1). Use your own local `project_id`/ports in your clone: never reset the shared `bonded` stack QA runs (it wiped an E2E run). Refresh status/backend.md: the lead kept main's copy when resolving merge conflicts. MOB-17 asks: backfill `badge_awards` for streaks that passed a step before BE-12; nothing awards achievement badges yet; partner awards unreadable (board shows "Sam's" badges): propose.
- Security: SEC-02 re-verify SEC-01 F1-F12 on main (BE-04c, BE-09, BE-25 merged) + new surface: notify/claim_push, unread_thread_counts, avatars storage policies, feedback, typing broadcast on public `couple:{id}` topic; triage #38 (share sheet logs the invite token); sign off D02 (BE-26) when it opens.
- Mobile: MOB-16 History in progress (flip `UNREAD_COUNTS_AVAILABLE`); J2 shows the initial (avatar URL is null, see decision); feedback insert uses `return=minimal`. #32/#33/#36 done in #42.
- QA: pairing flows for J6/09 (MOB-15); add `streak-11-fresh-day` to qa/fixtures/personas.json; drop the QA-BUG-3 `it.fails` pin (#34 merged); flows for MOB-17 testIDs (25, 52, 52b); re-run pairing link/typed after #30.

## Contract changes in flight
- —

## Questions for the product owner
- Backend needs an unambiguous **dev** Supabase project ref for deploying BE-08 (the linked project is labelled production; nothing deployed until you name one).
- MOB-17: board 52 colours shared badges gold, but DESIGN.md reserves gold for premium. Built per the board; confirm or change.
- REL-03: screen 03 `last_learned` has no backend column (kept local only); confirm it is not needed server-side.
- D30: final bundle id + invite domain (blocks the first store upload only)
- D32: who makes the Rive mascot file, and by when (MOB-31 needs it in M3)
- D02/D04: decided by the lead on PO delegation (2026-11-02); PO can still revisit the look of the pending-join state (MOB-32).

## Risks
- Widgets (D26) + animated mascot (D32) added to launch scope: expect M4–M5 pressure; first candidates to cut if the RC slips
