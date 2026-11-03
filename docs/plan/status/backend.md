# Backend / data developer status

Updated: 2026-11-03 · Branch: `be/BE-10-nudges` · Task: BE-10 (D16); BE-26 review follow-up pushed

## Resume here

- Last AI / date: Codex · 2026-11-03. Worktree: `/Users/saeedarafa/dev/bonded-be` only.
- Current task: **BE-10**, branch `be/BE-10-nudges` created from `origin/main` at `2241253`; one task/PR, never merge main. BE-08 is merged, so this task is unblocked.
- Exact next step: full BE-10 DB suite is running; finish verification, inspect CI, open/update the BE-10 PR and hand off to lead/mobile. Implementation complete: migration `20261103150000_send_nudge.sql`, private RLS ledger (sender/date unique), parent/question locks, BE-08 dispatch, generated types, CONTRACTS and tests. Focused nudge 30/30; private helpers/error-codes/hardening pass; Deno lint/check/test/format and app typecheck pass. Exact tests include Berlin midnight, 25-hour DST day, re-pair quota, retry, partner eligibility and rollback on dispatch failure.
- Uncommitted work: none after this checkpoint commit/push. Git default credential helper fails; use per-command `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' fetch/pull/push` (never print credentials).
- **BE-26 / #41**: branch `be/BE-26-typed-code-approval`, latest checkpoint `5352a83`; main merged (no rebase). SEC-04 F1/F2 and N1–N3 already implemented at `3a730c1`. Follow-up `0335e42` documents exact limits + adds cooldown/expiry boundary tests. Inviter-only first-name lookup ≤30 chars; 3 live requests; 15-minute request expiry; decline blocks typed retries for the invite's entire remaining lifetime (≤48 h from creation). Existing pending retries preserve id/deadline; valid link bypasses cap/decline; new invite resets decline. No email/avatar/profile access expansion.
- BE-26 verification in this folder: full **18 DB suites pass**, join-requests **58/58**, invite-link **45/45**, reveal-rule/RLS **23/23**. Types/seed/plan/agent-sync checks, Deno lint/check/test/format, app typecheck/lint/format pass; Jest **40 suites / 646 tests** pass. Review reply: https://github.com/saeedarafa/bonded/pull/41#issuecomment-6607294850 . SEC-04 backend/source sign-off now granted through `5352a83`: https://github.com/saeedarafa/bonded/pull/41#issuecomment-6607270890 . Still waits on QA-10 fixtures, mobile ack/MOB-32 UI and lead integration. Return if review comments appear.
- Commands: `npm --prefix supabase/tests ci`; `npm --prefix supabase/tests test`; `SUPABASE_TELEMETRY_DISABLED=1 npm --prefix supabase/tests run check:types`; `node supabase/scripts/build-seed.mjs --check`; `bash qa/ci/functions.sh`; `deno fmt --check supabase/functions`; `npm run typecheck`; `npm run lint`; `npm run format:check`; `npm test -- --runInBand`; `gh pr view 41 --comments`.
- Watch out: never reset/stop QA's shared `bonded` stack, never use hosted production, never deploy without an identified dev project. PGlite is isolated. Main migrations are immutable. Node 24 and Deno available; local root/test dependencies installed. Commit/push/update this handoff after each finished step.

## Doing

- BE-10 `send_nudge()` (D16): implementation complete, full regression/CI verification and PR next.

## Done

- BE-26 review fixes verified, explicit limits/cooldown tests and PO recognition question pushed/commented on #41.
- BE-08/#17, BE-09/#5, BE-25/#21, BE-16/#35 and BE-28/#46 already merged. Email templates/callback config (#44) merged.

## Next

- Finish BE-10 and hand mobile the types/availability gate. BE-19 daily reminders is another unblocked backend task afterward.
- Return to BE-26 for review comments or merged QA/mobile companions; lead alone integrates it.

## Blocked

- BE-26 merge waits on QA-10 and mobile breaking-response ack/MOB-32; backend SEC-04 source sign-off granted.
- BE-27 hosted parity and all deployments: no unambiguous hosted dev project. Do not write to `nciyrepyphvksusoigzx` (labelled production).
- Hosted Realtime DELETE UUID-only validation (SEC-04 N4) waits on BE-27.

## Needs from

- **PO:** safest SEC-04 recognition default is display-name-derived first name only, trimmed/capped at 30 characters (may be empty), inviter-only while pending on an open invite. No email/avatar or general profile access. Review MOB-32's presentation: the name is user-supplied, not verified identity. Exact limits/cooldown are in CONTRACTS. Also identify the hosted dev project for BE-27/deployments.
- **Mobile MOB-32:** ack #41's breaking typed-code pending response, show requester name from `pending_join_requests()` before approval and refetch on request signals; handle cap/decline errors. BE-10 now provides `rpc('send_nudge')` types for MOB-10's `NUDGE_AVAILABLE` flag in its own PR; mobile flips it after lead integration. Suppressed pushes still consume the sender's daily quota.
- **QA QA-10:** token/approval pairing fixtures and pending/name/cap/decline PostgREST tests for #41. Shared stack left untouched.
- **Lead/security:** re-review #41's SEC-04 fixes; lead coordinates QA/mobile merge gates. Backend never merges to main.
