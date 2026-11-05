# Backend / data developer status

Updated: 2026-11-05 · Branch: `be/BE-27-hosted-auth-check` · Task: reviewed backend PR integrations / Auth evidence handoff

## Resume here

- Branch `be/BE-27-hosted-auth-check`, PR #102. This checkpoint merges origin/main `2d76a75` (BE-34 plus release/planning updates), preserves partial hosted evidence and records the lead's request to mark this documentation handoff ready. Hosted HTML parity and BE-27 acceptance remain open; see `supabase/AUTH_DEV_CHECK.md`. No hosted writes or credential/UI retries.
- Exact next step: fetch/status/log/pull ff-only; review authored open PR feedback and latest CI for #91/#97/#100/#102. Lead accepted all three feature PRs; reviewed migrations/functions unchanged. If main adds backend source or conflicts, merge it into affected branches without rewriting history; retain every test suite and contract log row. Lead alone merges main. Preserve220000 →230000 →240000, apply240000 before updated daily-reminder. Once all checks pass, wait for lead merges/dev deployments; do not repeat complete suites for status-only changes.
- Current feature heads: #91 `3adb492`, #97 `2cb6f18`, #100 `d859361`; all now include main `2d76a75`. Latest merges add release/planning documents only; verified zero changes in `supabase/**`, generated types or CONTRACTS versus the preceding validated heads. #91 initial integration `cf6d720` and handoff `22b15d4` both passed seven checks; local full DB suite passed too. #97 integration `f6bbf61`/`87eba8d`, handoff `78d48d5`; #100 integration `e1da592`, handoff `e3fc5db`. Latest-head CI must be refreshed after these pushes; no unmerged task migrations were added to another task branch.
- Local verification: #91 complete DB suite, saver46, types, functions52+QA10, seed/plan/agent-sync/whitespace pass. #97 offers46/reveal23/onboarding37/expired26/types/static pass. #100 recap55/reveal23/onboarding37/expired26/types/functions54+QA10/static pass. Logs `/private/tmp/bonded-be11-after90-{db,saver,types,functions}.log`, `/private/tmp/bonded-be17-after90-focused.log`, `/private/tmp/bonded-be14-after90-{focused,functions}.log`. Shared stack never reset/stopped.
- Startup authored PR comments/reviews/inline reviewed (#91/#97/#100/#102); inline empty. Lead asked #91 to merge main after #90 and accepted #97/#100 source; addressed. Source acceptances: #91 `e7c98cb`, #97 `17b6c47`, #100 `ad8845d`. D21 confirmed; D28 local-day3 interpretation still flagged in #97. #90 merged `3baa484`,210000 dev deploy OK per lead; #83's stale check is superseded by successful later deployments including200000.
- #102 marked ready for review and PR body updated per lead disposition; local auth4/seed/plan/agent-sync/whitespace pass at `72895d9`. Final status-only checkpoint follows; refresh CI after push.
- #102 lead clarification at `531c61e`: docs/status report may be marked ready; no security review needed. PO owns hosted settings; leave dev templates while custom SMTP unavailable. Site URL `http://localhost:3000` differs; subjects differ; bodies unverified. Callback `bonded://auth/callback` and OTP6 match. Keep actual parity/SMTP/device acceptance open; do not claim completion from this report.
- Commands: `export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH`; `export SUPABASE_HOME=/private/tmp/bonded-cli-resume SUPABASE_TELEMETRY_DISABLED=1`; `node supabase/tests/auth-email.test.mjs`; `node supabase/scripts/build-seed.mjs --check`; `node scripts/plan/generate.mjs --check`; `node scripts/agents/sync.mjs --check`; `git diff --check`; `gh pr checks 91`; `gh pr checks 97`; `gh pr checks 100`; `gh pr checks 102`; `gh pr list --author @me`. Full DB `npm --prefix supabase/tests test`; types `npm --prefix supabase/tests run check:types`; functions `bash qa/ci/functions.sh` only when source/failed checks justify it. The 10,000-invite fixture takes minutes.
- Dev only `nyqbrsqqalygydtwvybb`; never prod `nciyrepyphvksusoigzx`. Hooks `.githooks`; no secrets or AI attribution. No uncommitted work after checkpoint commit/push.

## Doing

- Reviewed backend integration PRs refreshed after #90; green latest-head CI required before lead merges.
- #102 partial Auth report ready for lead review under explicit documentation-only disposition.

## Done

- BE-33 and BE-34 on main; #90/210000 deployed to dev (lead confirmation).
- #91/#97/#100 main conflicts resolved; reviewed feature source unchanged; local validations pass.

## Next

- Lead merges/deploys #91 → #97 → #100 in migration order after latest checks pass.
- No new unblocked launch BE implementation found in BACKLOG. BE-32 loader merged; QA-13 workflow/environment remains QA/PO-owned.

## Blocked

- BE-31 requires PO go; BE-22 approved milestone; BE-13 after launch.
- Hosted Auth Site URL/template/SMTP/device acceptance needs PO/QA/release; function secrets/Vault/device checks and QA-13 environment pending. D28 local-day3 needs lead confirmation.

## Needs from

- Lead: merge green feature PRs in order, confirm deployments and D28, review #102 report without treating hosted parity as complete.
- PO: hosted Auth Site URL/templates/custom SMTP, QA-13 environment; no credentials in comments/repo.
- Mobile/QA: BE-34 token-only bounded `error.details.inviter_name` now on main; generic fallback otherwise. BE-11/17/14 await integration. Callback/OTP6 confirmed; body parity and device PKCE acceptance pending.
- Release: BE-10 nudge already on main. Partner ritual-time/J5 extra preview fields need lead contract/privacy decision before expanding data.
