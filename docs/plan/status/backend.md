# Backend / data developer status

Updated: 2026-11-04 · Branch: `be/BE-34-expired-invite` · Task: BE-34 / D39

## Resume here

- Primary worktree `/Users/saeedarafa/dev/codex-backend/bonded`, branch `be/BE-34-expired-invite`; implementation `1e1dafe`, latest-main integration `3d31014` (main aaef349), verification checkpoint `f245b6e`. Temporary `/private/tmp/bonded-be34` was used while startup tests ran on #80; moved the clean committed task back to the primary checkout before ending. No secrets/hosted calls.
- Exact next step: check #90 CI and security/lead comments; mark ready when focused security + CI gates are met. Implementation/verification complete and pushed. Then take the next unblocked BE task; do not wait for humans. BE-34 draft PR **#90** https://github.com/saeedarafa/bonded/pull/90; implementation `1e1dafe`, latest-main integration `3d31014` (no backend delta). Then BE-11 may branch from #80 explicitly, or start from main after #81 merges. Migration 210000 is after pending #80/190000 and #83/200000; lead must preserve migration order or explicitly renumber before merge. Only lead merges main.
- BE-34 implementation: expired SQL `invite_preview` keeps HTTP400/P0001/INVITE_EXPIRED and adds only `details.inviter_name` (first name ≤30) for matching link tokens. Typed expiry counts, wrong/revoked/accepted tokens get no name, existing D02 actor lock and limit preserved. No avatar/answer/expiry in expired response. Avatar Edge endpoint still rejects expiry; mobile already falls back to SQL.
- **All 23 DB suites pass** on BE-34 (exit0), including focused26/reveal23/hardening91/link45/avatar37/race56. Generated types current; seed/plan/sync/diff checks pass. Real fresh isolated reset/seed and anonymous PostgREST smoke pass: exact HTTP400 details allow-list/retry, typed-code privacy/counting, wrong token denial. Stack `bonded_backend_be34` API57321/DB57322 under `supabase/.temp/be34-review-stack` stopped with --no-backup; shared QA stack untouched. No hosted writes. Root BE-18 startup checks completed: DB23, backendDeno52, app771 and all static checks pass; QA8+1 known fixture failure fixed by #81. Current-main integration here only changes mobile/release files. Typecheck/lint/format pass. Local Edge tests32 backend +9 QA pass. App and functions CI pass at f245b6e (41849910035); initial run41849341307 had all7 required jobs succeed before being superseded/cancelled. Current DB/reset checks pending. Two extra local Jest runs in the symlinked temporary worktree stalled before test output and were interrupted; **do not count them green**. Root startup771 tests and current app CI pass; no app product failure established. Logs `/private/tmp/bonded-be34-*.log` and `/private/tmp/bonded-loop-*.log`.
- Re-run: `node supabase/tests/expired-invite.test.mjs`; `npm --prefix supabase/tests test`; `npm --prefix supabase/tests run check:types`; `bash qa/ci/functions.sh`; `node supabase/scripts/build-seed.mjs --check`; plan/sync/diff checks. Node24 PATH `/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin`; hooks `.githooks`; per-command gh git credential helper. Primary checkout has installed dependencies. Temporary dependency symlinks were removed with the clean temporary worktree; no untracked source remains.
- Reviews checked first: #75 SEC-07 signed off c5cacad, CI41830450898 green, **marked ready** this session. #80 SEC-08 source sign-off at16f08ca; **#81 is lead-designated merge vehicle**, not a request to copy QA files into #80. #81 source signed off/CI41834008885 green; fresh combined CI needed after integration. #83 ready/current CI41837637886 green. No outstanding backend code requests. All PRs stay separate.
- Dev only `nyqbrsqqalygydtwvybb`, never prod `nciyrepyphvksusoigzx`. Never plain Supabase reset/stop (shared QA stack `bonded`); isolated project/ports only. Hosted functions require dev secrets/Vault; BE-27 GET/SMTP credentials unavailable. BE-31 waits PO go.
- Uncommitted work: none after final checkpoint/push. Isolated stack stopped, no test sessions remain active.

## Doing

- BE-34/#90 implementation and DB/reset/HTTP verification complete; draft pending focused source security and current full CI.

## Done

- Startup fetch/status/log/pull, backend skills, task/contract/status reads; open backend PR reviews checked.
- #75 marked ready after named-head security sign-off and green CI.
- BE-34 fullDB/reveal/pairing regressions, generated types/seed/plan/sync, real reset + actual anonymous HTTP details verified; PR#90 draft open. Contracts/migration added; public return type unchanged.

## Next

- BE-34 source/security/lead review, MOB-38/QA consume additive error details.
- BE-11 may branch from #80 while unmerged, or proceed after lead merges #81; one branch/PR per task.

## Blocked

- BE-34 needs security review and ordered dev migration deployment.
- #75 waits lead merge/QA-13 workflow/configuration; #80/#81 waits lead integration; #83 waits migration order.
- Hosted secrets/Vault, Auth GET/SMTP acceptance; BE-31 PO go.

## Needs from

- Lead/security: review BE-34 token-gated name disclosure; preserve migration order190000 →200000 →210000.
- Mobile/QA: contract changed BE-34/D39, optional object `error.details.inviter_name`; generic fallback when absent/empty. No expired avatar/answer/expiry. MOB-38 consumes.
- Lead: #75 source security + CI gates met, now ready. #81 is BE-18 merge vehicle; #83 current CI green.
- PO: dev-only credentials/secrets/Vault/SMTP; never production for testing.
