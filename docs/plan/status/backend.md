# Backend / data developer status

Updated: 2026-11-03 · Branch: `be/BE-10-nudges` · Task: BE-10/#53 review integration

## Resume here

- Current session 2026-11-03: worktree `/Users/saeedarafa/dev/codex-backend/bonded`; branch `be/BE-test-50-hardening-update`, PR #55 / BE-29 (#50). Lead requested another main merge after #53; merged current origin/main without rebase, retaining main status and the stored-body regression assertion. Verification pending below; next push #55, then check #60 review/CI and continue BE-19 on a new branch from origin/main. BE-26/#41 and BE-10/#53 are merged.

- Last AI/date: Codex · 2026-11-03. Worktree `/Users/saeedarafa/dev/bonded-be` only.
- Current step: merge `origin/main` (`47f02c0`) into BE-10/#53 as requested by lead (no rebase). Kept both contracts/change-log rows, both nudge/join-request DB suites, both public RPC allowlist entries and error-code auth checks; regenerate types. No feature changes to the accepted nudge implementation `9aec30f`.
- Exact next step: finish merged-head verification for #53 (full DB suite, type freshness, Deno/app checks), push and reply. #53 waits on independent security push-abuse sign-off; lead merges. Then BE-30/#57 is the next unblocked M2 backend task (ahead of BE-19/M3): concurrent approvals must expire the losing request with uncounted `JOIN_REQUEST_EXPIRED`, not `COUPLE_FULL`.
- #55 / BE-29 (#50): merged main `47f02c0` in `bff7d65`; only conflict was backend status. Hardening **91/91** and reveal-rule/RLS **23/23** re-run and pass. Lead accepted; CI running before lead merge. No product/schema changes.
- #41/BE-26 merged via QA-10/#54 (`373868a`); MOB-32/#56 and D37/#58 merged. Security source sign-off and mobile ack received. No new backend changes requested on #41; #57 tracks the concurrency follow-up separately.
- Earlier verification: #53 all seven CI checks green at `9f20655`; #55 all seven green at `294a66e`. Those preceded main integration and do not establish green merged-head CI.
- Commands: `npm --prefix supabase/tests test`; `SUPABASE_TELEMETRY_DISABLED=1 npm --prefix supabase/tests run check:types`; `bash qa/ci/functions.sh`; `deno fmt --check supabase/functions`; `npm run typecheck`; `node scripts/plan/generate.mjs --check`; `node scripts/agents/sync.mjs --check`; `gh pr checks 53`; `gh pr checks 55`.
- Git credential workaround: per-command `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' fetch/pull/push`. No credentials printed. Hooks `.githooks` configured.
- Uncommitted work: none after checkpoint commit/push. Never merge main, rebase a reviewed branch, or write to production. Never reset/stop the shared `bonded` stack; isolated PGlite tests and CI reset only.

## Doing

- BE-10/#53: main integration and fresh verification, then lead/security review.
- BE-29/#55: main merged, focused checks pass; waiting for CI and lead integration.

## Done

- BE-26/#41, QA-10/#54, MOB-32/#56 and D37/#58 merged. Typed requests await approval, inviter sees the safe name cue; 3 live request cap and invite-scoped decline cooldown.
- BE-10 implemented separately: once per sender/couple-local date, private RLS ledger, partner eligibility, BE-08 dispatch, no text. Focused nudge 30/30 before main integration.
- BE-29 assertion checks stored data; isolated UPDATE-policy mutation fails the assertion while SELECT policies remain unchanged.

## Next

- BE-30/#57 from origin/main, one task/PR. Never edit merged migrations or QA-owned tests; request QA tighten its concurrent-approval assertion.
- BE-19 reminders remains unstarted (M3, after M2 follow-up).

## Blocked

- #53 merge: independent security push-abuse sign-off and merged-head green CI required.
- BE-27 hosted parity/deployment and SEC-04 N4: no unambiguous dev project. No writes to `nciyrepyphvksusoigzx` (labelled production).

## Needs from

- Security/lead: #53 new push path review requested by lead (per-sender quota across re-pairing, recipient caps/quiet hours/preferences, suppression consumes quota, no text); sign off before lead integration.
- Mobile: flip `NUDGE_AVAILABLE` after #53 merges. `send_nudge()` is void; quota errors are `NUDGE_LIMIT`, partner answered = `PARTNER_ALREADY_ANSWERED`.
- QA: after BE-30, tighten concurrent `approve_join` loser to `JOIN_REQUEST_EXPIRED` and assert expired/uncounted. Backend will supply deterministic regression evidence; shared stack stays untouched.
- PO: identify the hosted dev project. MOB-32's display-name-derived first name remains a user-supplied recognition cue, not verified identity; review the UI.
