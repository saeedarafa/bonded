# Backend / data developer status

Updated: 2026-11-03 · Branch: `be/BE-20b-invite-avatar` · Task: BE-20b/#69 main integration

## Resume here

- Last session: Codex, 2026-11-03. Worktree `/Users/saeedarafa/dev/codex-backend/bonded`.
- #64 is merged (latest CI 7/7 at `610e436`, run 41711377428). #69 now merges origin/main `a55b32d` without rebase. Integration conflicts: backend status, README (both runbooks retained), test command (avatar/race/reminders retained), helper allowlist (both service RPCs retained). No avatar SQL/Edge product changes.
- Exact next step: complete fresh #69 integration checks, push and reply to lead; then start BE-18 from latest origin/main. Signed-avatar leases are bounded TTL, not immediate revocation; hosted expiry/cache behavior unverified. Prior avatar implementation `485e094`, accepted + SEC-01 source sign-off at `26afa86`.
- Local resume full run was invalidated when branch switching briefly removed an imported migration during an active suite; do not count it as pass/fail product evidence. Re-run on the stable integrated branch; never switch branches during an active test command. Isolated BE-18 draft files (not committed) are in `/private/tmp/bonded-be18-draft`; draft DB assertions need correction (zero-row UPDATE can succeed under RLS). Do not lose these when starting BE-18.
- BE-32 loader prepared from latest origin/main `3250088` in temporary worktree `/private/tmp/bonded-be32` to avoid changing files under the running #64 DB suite. Branch `be/BE-32-dev-content`. Focused tests pass: dev-only ref guard before HTTP; fixed/redacted errors; atomic content-only SQL; D33 forced off; exact replay equality (153 questions/6 packs/15 badges), no users. Draft PR #75 (code `6e611a1`, checkpoint `c03ad8d`) awaits QA workflow wiring per #72 and lead merge order #64 → #69 → BE-32. No hosted calls/writes. Read `supabase/scripts/DEV_CONTENT.md` on BE-32; QA handoff posted on #72. Temporary worktree has no uncommitted changes. Next independent task BE-18; BE-31 waits for PO go.
- Dev is bonded-dev `nyqbrsqqalygydtwvybb`; main auto-deploys migrations, production disconnected. BE-27 Auth config GET remains unverified: CLI projects list works, management credential unavailable. No hosted writes performed. PO explicitly authorized dev link/push/deploy/test in origin/main `3250088`; credentials still unavailable. Function rollout needs PO secrets/Vault configuration; see `supabase/functions/README.md`. Never use production `nciyrepyphvksusoigzx`.
- Commands: `npm --prefix supabase/tests ci`; `npm --prefix supabase/tests test`; `SUPABASE_TELEMETRY_DISABLED=1 npm --prefix supabase/tests run check:types`; `node supabase/scripts/build-seed.mjs --check`; `bash qa/ci/functions.sh`; `deno fmt --check supabase/functions`; `npm run typecheck`; `npm run lint`; `npm run format:check`; `npm test -- --runInBand`; `node scripts/plan/generate.mjs --check`; `node scripts/agents/sync.mjs --check`; `gh pr checks 64`; `gh pr checks 69`; `gh pr checks 75`.
- Tooling: Node 24 `PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH`; hooks `.githooks`. Git fetch/pull/push: `-c credential.helper= -c 'credential.helper=!gh auth git-credential'`. Set `SUPABASE_TELEMETRY_DISABLED=1` for CLI. Isolated PGlite only; never reset/stop QA's shared stack.
- Uncommitted work: none after this checkpoint commit/push. Original worktree stays on #64; BE-32 worktree is clean and pushed. No test sessions remain running.

## Doing

- #64 merged; #69 integration verification in progress.
- BE-32 loader ready; QA-owned workflow still required.
- BE-18 draft prepared outside the worktree; migrate to its own branch only after #69 checks finish.

## Done

- BE-30/#60, BE-29/#55, BE-10/#53, History/#61, nudge UI/#62 merged.
- BE-26/#41 via QA-10/#54, MOB-32/#56, D37/#58 merged.

## Next

- BE-32 (M2/P1), BE-18 (M4/P0); one branch/PR per task.

## Blocked

- BE-27 hosted Auth GET needs management credential access; templates wait for SMTP.
- Hosted function rollout/device acceptance needs PO configuration.


## Needs from

- Lead: #64 merged; #69 main integration/checks now in progress.
- QA: wire BE-32 loader into post-main-merge dev deployment; see `supabase/scripts/DEV_CONTENT.md` and #72. Workflow files remain untouched by backend. Reminder retry/cap and device acceptance after deployment.
- PO/lead: configure dev function secrets/Vault; hosted Auth/Storage acceptance remains unverified.
- Mobile: MOB-35 consumes #69 Edge preview for token links with SQL/initial fallback; never persist/log tokens or signed URLs.
