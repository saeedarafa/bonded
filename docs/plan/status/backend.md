# Backend / data developer status

Updated: 2026-11-03 · Branch: `be/BE-32-dev-content` · Task: BE-32/#72 loader handoff

## Resume here

- Last session: Codex, 2026-11-03. Worktree `/Users/saeedarafa/dev/codex-backend/bonded`.
- #60 BE-30 is merged. #64 lead accepted and SEC-06 source sign-off at `9e9cabc`; merged origin/main `467f15f` without rebase. Conflicts only backend status and test command; retained approval-race and reminder suites. README stale dev-identity sentence corrected per security review. No reminder product SQL/function changes.
- Exact next step: check #64 CI run `41710446306` and local `/tmp/bonded-be64-db.log` in the original worktree (session 17324). App 42 suites/729 tests, Deno 23+9, type/seed/plan/sync/format checks pass; DB suite still running in 10,000-code boundary case at checkpoint. Integration `e4eeafa` pushed and lead replied to. After lead merges #64, integrate main into #69 without rebase and re-run CI. Lead merges #64 before #69 (170000 before 180000).
- #69 BE-20b branch `be/BE-20b-invite-avatar`, implementation `485e094`, checkpoint `26afa86`: lead accepted, SEC-01 source sign-off, previous CI 7/7 green. After #64 merges, merge latest main without rebase, regenerate types, re-run checks, push/reply. Signed-avatar leases are bounded TTL, not immediate revocation; hosted expiry/cache behavior unverified.
- BE-32 loader prepared from latest origin/main `3250088` in temporary worktree `/private/tmp/bonded-be32` to avoid changing files under the running #64 DB suite. Branch `be/BE-32-dev-content`. Focused tests pass: dev-only ref guard before HTTP; fixed/redacted errors; atomic content-only SQL; D33 forced off; exact replay equality (153 questions/6 packs/15 badges), no users. Draft PR awaits QA workflow wiring per #72 and lead merge order #64 → #69 → BE-32. No hosted calls/writes. Read `supabase/scripts/DEV_CONTENT.md`. Next independent task BE-18; BE-31 waits for PO go.
- Dev is bonded-dev `nyqbrsqqalygydtwvybb`; main auto-deploys migrations, production disconnected. BE-27 Auth config GET remains unverified: CLI projects list works, management credential unavailable. No hosted writes performed. Function rollout needs PO secrets/Vault configuration; see `supabase/functions/README.md`. Never use production `nciyrepyphvksusoigzx`.
- Commands: `npm --prefix supabase/tests ci`; `npm --prefix supabase/tests test`; `SUPABASE_TELEMETRY_DISABLED=1 npm --prefix supabase/tests run check:types`; `node supabase/scripts/build-seed.mjs --check`; `bash qa/ci/functions.sh`; `deno fmt --check supabase/functions`; `npm run typecheck`; `npm run lint`; `npm run format:check`; `npm test -- --runInBand`; `node scripts/plan/generate.mjs --check`; `node scripts/agents/sync.mjs --check`; `gh pr checks 64`; `gh pr checks 69`.
- Tooling: Node 24 `PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH`; hooks `.githooks`. Git fetch/pull/push: `-c credential.helper= -c 'credential.helper=!gh auth git-credential'`. Set `SUPABASE_TELEMETRY_DISABLED=1` for CLI. Isolated PGlite only; never reset/stop QA's shared stack.
- Uncommitted work: none after checkpoint commit/push; integration verification pending.

## Doing

- #64 latest-main integration pushed; local DB and CI pending.
- BE-32 loader ready; QA-owned workflow still required.
- #69 accepted; awaits #64 merge before integration.

## Done

- BE-30/#60, BE-29/#55, BE-10/#53, History/#61, nudge UI/#62 merged.
- BE-26/#41 via QA-10/#54, MOB-32/#56, D37/#58 merged.

## Next

- BE-32 (M2/P1), BE-18 (M4/P0); one branch/PR per task.

## Blocked

- BE-27 hosted Auth GET needs management credential access; templates wait for SMTP.
- Hosted function rollout/device acceptance needs PO configuration.
- #69 integration waits for #64 merge.

## Needs from

- Lead: merge #64 once fresh combined CI passes, then #69 after main integration.
- QA: wire BE-32 loader into post-main-merge dev deployment; see `supabase/scripts/DEV_CONTENT.md` and #72. Workflow files remain untouched by backend. Reminder retry/cap and device acceptance after deployment.
- PO/lead: configure dev function secrets/Vault; hosted Auth/Storage acceptance remains unverified.
- Mobile: MOB-35 consumes #69 Edge preview for token links with SQL/initial fallback; never persist/log tokens or signed URLs.
