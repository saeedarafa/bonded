# Lead architect status
Updated: 2026-11-03 · Branch: lead/MOB-auth-email · Milestone: M1

## Resume here
<!-- Keep this current after every step: the next AI (Claude, Codex or Copilot) starts from it. -->
- **Worktree rule (PO 2026-11-03, standing):** one worktree per role: ~/dev/bonded-be, ~/dev/bonded-mobile, ~/dev/bonded-qa, ~/dev/bonded-release, ~/dev/bonded-security (lead uses ~/dev/bonded). If a role's worktree is busy with another task, finish or park that task (commit, push, Resume here) and switch branches there; never create a new folder for it. A temporary worktree only if truly needed, removed as soon as its PR merges. At most two sub-agents at a time.
- **FOCUS COMPLETE 2026-11-03 (email sign-in, D35):** all four steps merged; main CI green at 0e06d78. #44 (backend templates + mobile PKCE link, closed #28) · #45 QA-11 (fetch-otp removed, contract test: 6-digit code + working `bonded://auth/callback?code=` link) · D35 recorded in DESIGN_DELTA/CONTRACTS §10/ACCOUNTS 7. Open leftovers (not blocking): hosted dev-project check (BE-27, waits on the PO naming the project); QA-11 cold/warm link E2E. The PO may delete ~/dev/bonded-tools/focus.txt. Also merged: #35 BE-16 delete account (6878bad).
- Status-file rule (PO 2026-11-03): every sub-agent records its task (BE-28 / MOB-33 / QA-12 …) in its own Resume here before it stops, committed and pushed. Pending: QA has not yet recorded QA-12 (and the QA-11 link E2E leftover); brief QA when a slot frees (branch `qa/QA-12-invite-link` from origin/main in ~/dev/bonded-qa).
- In flight (2026-11-03): **#46 BE-28 MERGED (db6e9e7)**, SEC-03 signed off (report ~/security-audit-skill/bonded/sec-03-invite-link/REPORT.md). #41 BE-26 retargeted to main by backend (head aa08649; migrations renamed after invite_link; fixed an approve_join bug where a reissued 4-digit code could pair into another couple); next: backend merges main again (4 expected conflicts, BE-28 test block must pass, not skip), then SEC-02 sign-off on #41 incl. the approve fix, then mobile ack (breaking accept_invite). Lead decisions: MOB-33 fixes #38; D37 entry points behind `JOIN_FROM_SOLO_ENABLED=false` until #41 merges. QA (~/dev/bonded-qa): records QA-12, then QA-11b link E2E PR; QA-12 contract tests can start now that #46 is merged. D36 (keep the shared invite code) and D37 (solo account joins a partner later) decided; BE-28 (backend, ~/dev/bonded-be) and MOB-33 + D37 (mobile, ~/dev/bonded-mobile; MOB-16 parked) running. Mobile then sends D36/D37 simulator screenshots for PO review and opens the dev-build scripts PR.
- **#44 MERGED 2026-11-03 (d9db934)**, all seven CI checks green at 7af0321 on main 9e44983; closed #28. Focus steps 1-3 done. Step 4: QA-11 delegated in ~/dev/bonded-qa on `qa/QA-11-email-auth` (QA-06 parked, clean and pushed). Remaining hosted check (BE-27) waits on the PO naming the dev project (see Questions).
- Email authentication integration (2026-11-03): backend `afab10a` merged before mobile `b6001c7` into this isolated lead branch. Independent Security Reviewer accepts the PKCE-only remediation for source merge, with no remaining findings in scope. Lead reran the combined candidate: 613 Jest tests, typecheck, lint, full formatting, four static Auth tests, 23 reveal-rule/RLS tests, types/seed freshness, plan and agent-sync checks all passed. The security summary was moved out of the repo (charter: audit reports live outside it) to `~/security-audit-skill/bonded/email-auth-2026-11-03.md`. Native email round-trip and hosted Auth configuration remain unverified. Do not restart/reset QA's shared Supabase stack.
- Auth integration PR: #44 targets main. All seven CI checks passed at `12986d9` in run `41614175672`, including full DB tests and clean Supabase reset/contract tests. GitHub is authoritative for the merge state; the final documentation-only evidence update must also remain green. No hosted deployment was performed.
- Open PR check (2026-11-03): #41 remains based on `be/BE-25-solo-archive`; `app`, `db-reset`, `db-tests`, and `ci-ok` fail. Existing change requests still apply; do not merge. #35 remains `DIRTY`; `db-reset` and `ci-ok` fail, though app/db-tests/functions/plan/agents-sync pass. Existing avatar-removal request still applies; do not merge.
- Local preview troubleshooting (2026-11-03 10:23): Bonded was already installed on iPhone 16 simulator `B46EDC57-ADCE-453F-B9CC-079C40C5D463`. Launched `app.bonded.mobile` successfully and verified its welcome screen by `simctl io ... screenshot`. This is an existing bundled build, not a fresh main build or Metro live reload. Simulator GUI could not open: `/Applications/Xcode.app/Contents/Developer/Applications/Simulator.app` is missing. Root `ios/` remains incomplete after interrupted prebuild/pod installs; do not delete/regenerate it repeatedly. Expo is not the blocker. For future builds use the ad-hoc signing recipe in `qa/e2e/README.md` (not `CODE_SIGNING_ALLOWED=NO`, which breaks SecureStore). Restored only Expo's script rewrites in `package.json`; preserved `.env.example` edits. Left other worktrees/builds and the shared backend untouched.
- Last AI / date: Claude Code (lead, running all roles as sub-agents; Codex out of credits) · 2026-11-03.
- Focus (~/dev/bonded-tools/focus.txt) step 1 DONE on this branch: PO_ANSWERS entry applied → DESIGN_DELTA D35 (new "Sign-in" section), CONTRACTS §10 tagged D35, ACCOUNTS 7 rewritten, BACKLOG QA-11 now includes dropping `fetch-otp` + the email-content check; every role told under Needs from. Step 2: code in #44; backend sub-agent checking the hosted dev project (redirect allow-list, template link style) read-only. Step 3: done in #44 (PKCE link + OTP, tests). Step 4: QA after #44 merges.
- Branch + last commit: `lead/MOB-auth-email`, PR #44; code accepted at `12986d9`, followed by this CI-evidence update; based on `origin/main` @ `9e44983`.
- Uncommitted work: main checkout keeps the PO's local `package.json` change (`ios`/`android` → `expo run:ios`/`expo run:android`). **PO 2026-11-03: keep it**; mobile opens a small PR with the same change + a run note; after it merges, discard the local copy (`git checkout -- package.json`, PO-approved) so main stays clean.
- This session: read all 60 status copies across ten worktrees (24 distinct contents), reviewed existing PR blockers, obtained independent focused security acceptance, integrated backend then mobile, and validated the combined candidate. No unrelated PRs changed. Hosted/native verification remains outstanding.
- State per role:
  - Mobile: `mobile/MOB-auth-email-links-final` @ `b6001c7` completed PKCE-only link callbacks, regression tests and visible email label; native checks remain.
  - Backend: `be/auth-email-link-code` @ `afab10a` completed local Auth templates and callback redirect allow-list; hosted Auth settings and end-to-end mail remain unverified.
  - QA: `qa/QA-06-pairing-personas` @ 5a416a7; simulator build was blocked on an RNReanimated compile error (see qa.md); email runtime verification not run.
  - Release: waits until QA's simulator runs are finished.
  - Backend/security (Codex): #35 and #41 have review comments to address; SEC-02 not started.
- Exact next step: review and merge the QA-11 PR; then report focus complete here (PO deletes ~/dev/bonded-tools/focus.txt). Backlog: #35 BE-16 (backend finishing the Codex branch in ~/dev/bonded-be, normal push, no force), #41, MOB-16, unpark QA-06.
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
- **All roles (D35, 2026-11-03):** email sign-in sends both a 6-digit code (primary) and a PKCE link to `bonded://auth/callback` (convenience; only on the requesting install). Contract: CONTRACTS §10. Backend: hosted parity + redirect check (BE-27). Mobile: done in #44; keep code entry the main path. QA: QA-11 after #44 (drop `fetch-otp`, check the email has code + link). Release/security: re-check 08/J4 email sign-in on the next build; implicit-token callbacks are rejected by design.
- Backend (Codex): **#41 BE-26: retarget to main + rebase, fix content.test.mjs (typed-code fixtures now pending → answers RLS), mark the accept_invite change breaking in CONTRACTS (see review).** #35 BE-16: delete the avatar object in delete-account + Deno test, rebase. Then BE-26 (D02 typed-code approval; BE-25 is merged), BE-10 nudges (BE-08 merged), issue #9 (QA-BUG-4), `streak-11-fresh-day` scenario once QA lists it in personas.json, the partner ritual-time read for J6 "Same as Maya", BE-20b (P1). BE-27 local templates/allow-list are accepted in this integration; hosted Auth rollout requires a named dev project and operator action. Use your own local `project_id`/ports in your clone: never reset the shared `bonded` stack QA runs (it wiped an E2E run). Refresh status/backend.md: the lead kept main's copy when resolving merge conflicts. MOB-17 asks: backfill `badge_awards` for streaks that passed a step before BE-12; nothing awards achievement badges yet; partner awards unreadable (board shows "Sam's" badges): propose.
- Security: SEC-02 re-verify SEC-01 F1-F12 on main (BE-04c, BE-09, BE-25 merged) + new surface: notify/claim_push, unread_thread_counts, avatars storage policies, feedback, typing broadcast on public `couple:{id}` topic; triage #38 (share sheet logs the invite token); sign off D02 (BE-26) when it opens.
- Mobile: MOB-16 History in progress (flip `UNREAD_COUNTS_AVAILABLE`); J2 shows the initial (avatar URL is null, see decision); feedback insert uses `return=minimal`. #32/#33/#36 done in #42.
- QA: pairing flows for J6/09 (MOB-15); add `streak-11-fresh-day` to qa/fixtures/personas.json; drop the QA-BUG-3 `it.fails` pin (#34 merged); flows for MOB-17 testIDs (25, 52, 52b); re-run pairing link/typed after #30.

## Contract changes in flight
- —

## Questions for the product owner
- **D35 / BE-27 (blocks only the hosted check):** PO_ANSWERS says you edited the template on "the Supabase dev project", but the only Bonded project is `nciyrepyphvksusoigzx` (labelled production; no `bonded-dev`). Is that the project you edited, and may agents treat it as dev? Then backend reads its auth config (GET only). Checklist to verify yourself: Site URL `bonded://`; Redirect URLs include `bonded://auth/callback`; Magic Link + Confirm signup templates link with `{{ .ConfirmationURL }}` (not a custom `{{ .TokenHash }}` link, which the app rejects) and show `{{ .Token }}`; OTP length 6.
- Backend needs an unambiguous **dev** Supabase project ref for deploying BE-08 (the linked project is labelled production; nothing deployed until you name one).
- MOB-17: board 52 colours shared badges gold, but DESIGN.md reserves gold for premium. Built per the board; confirm or change.
- REL-03: screen 03 `last_learned` has no backend column (kept local only); confirm it is not needed server-side.
- D30: final bundle id + invite domain (blocks the first store upload only)
- D32: who makes the Rive mascot file, and by when (MOB-31 needs it in M3)
- D02/D04: decided by the lead on PO delegation (2026-11-02); PO can still revisit the look of the pending-join state (MOB-32).

## Risks
- Widgets (D26) + animated mascot (D32) added to launch scope: expect M4–M5 pressure; first candidates to cut if the RC slips
