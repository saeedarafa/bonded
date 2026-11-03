# Backend / data developer status

Updated: 2026-11-03 · Branch: `be/BE-test-50-hardening-update` · Task: issue #50 (SEC-01 regression evidence)

## Resume here

- Last AI / date: Codex · 2026-11-03. Worktree: `/Users/saeedarafa/dev/bonded-be` only.
- Current task: **issue #50 / PR #55** (https://github.com/saeedarafa/bonded/pull/55), assigned by lead review on #41, branch `be/BE-test-50-hardening-update` from `origin/main` (`2241253`); implementation `ddbb04b`. Separate task/PR; never merge main.
- Exact next step: await lead review/integration of **BE-10/#53** and **issue #50/#55**; return to #41 if backend review comments appear. All seven CI checks passed on BE-10 `9f20655` (run 41661388288) and issue #50 `294a66e` (run 41661914456), including real Supabase reset/QA contracts, DB suites, app and functions. This final commit records those results only; implementation remains `9aec30f` (BE-10) / `ddbb04b` (#50). QA-10/#54 carries BE-26; lead integrates it, then MOB-32. Never merge main. No additional backend task started.
- Uncommitted work: none after this checkpoint commit/push. Git default credential helper fails; use per-command `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' fetch/pull/push` (never print credentials).
- **BE-26 / #41**: branch `be/BE-26-typed-code-approval`, tested checkpoint `5352a83`, documentation handoff `d874f51`; main merged (no rebase). SEC-04 F1/F2 and N1–N3 already implemented at `3a730c1`. Follow-up `0335e42` documents exact limits + adds cooldown/expiry boundary tests. Inviter-only first-name lookup ≤30 chars; 3 live requests; 15-minute request expiry; decline blocks typed retries for the invite's entire remaining lifetime (≤48 h from creation). Existing pending retries preserve id/deadline; valid link bypasses cap/decline; new invite resets decline. No email/avatar/profile access expansion.
- BE-26 verification in this folder: full **18 DB suites pass**, join-requests **58/58**, invite-link **45/45**, reveal-rule/RLS **23/23**. Types/seed/plan/agent-sync checks, Deno lint/check/test/format, app typecheck/lint/format pass; Jest **40 suites / 646 tests** pass. Review reply: https://github.com/saeedarafa/bonded/pull/41#issuecomment-6607294850 . SEC-04 backend/source sign-off now granted through `5352a83`: https://github.com/saeedarafa/bonded/pull/41#issuecomment-6607270890 . Mobile explicitly acked in #41 review at `0335e42`. Still waits on QA-10 fixtures, MOB-32 UI and lead integration; lead will merge QA-10 carrying #41, then MOB-32. No further backend feature change requested on #41. Return if review comments appear.
- Commands: `npm --prefix supabase/tests ci`; `npm --prefix supabase/tests test`; `SUPABASE_TELEMETRY_DISABLED=1 npm --prefix supabase/tests run check:types`; `node supabase/scripts/build-seed.mjs --check`; `bash qa/ci/functions.sh`; `deno fmt --check supabase/functions`; `npm run typecheck`; `npm run lint`; `npm run format:check`; `npm test -- --runInBand`; `gh pr view 41 --comments`.
- Watch out: never reset/stop QA's shared `bonded` stack, never use hosted production, never deploy without an identified dev project. PGlite is isolated. Main migrations are immutable. Node 24 and Deno available; local root/test dependencies installed. Commit/push/update this handoff after each finished step.

## Doing

- Issue #50 / PR #55: assertion fixed, hardening 91/91 + reveal-rule 23/23 pass; mutation detected (90/1 expected). **All seven CI checks green at `294a66e`**: https://github.com/saeedarafa/bonded/actions/runs/41661914456 . Ready for lead review; no product/schema/policy change.
- BE-10 / PR #53: implemented at `9aec30f`, handoff `9f20655`; local 18 DB suites pass (nudge 30/30, reveal 23/23). **All seven CI checks green at `9f20655`**: https://github.com/saeedarafa/bonded/actions/runs/41661388288 . Ready for lead review. Dev deployment remains blocked on project identity.
- BE-26 / #41 latest `d874f51` has documentation-only status/ack/rendering updates after signed-off/tested `5352a83`; both security source sign-off and mobile ack received, awaiting QA-10 + MOB-32 UI integration.

## Done

- Issue #50: non-vacuous own-answer edit assertion with isolated mutation proof; tests 91/91 + reveal-rule 23/23. No production/schema/policy changes.

- BE-26 review fixes verified, explicit limits/cooldown tests and PO recognition question pushed/commented on #41.
- BE-08/#17, BE-09/#5, BE-25/#21, BE-16/#35 and BE-28/#46 already merged. Email templates/callback config (#44) merged.

## Next

- Lead review/integration for BE-10/#53 and #50/#55. Mobile flips `NUDGE_AVAILABLE` when BE-10 lands. BE-19 daily reminders is the next unblocked backend backlog task if assigned; not started.
- Return to BE-26 for review comments or merged QA/mobile companions; lead alone integrates it.

## Blocked

- BE-26 merge waits on QA-10 and MOB-32; mobile breaking-contract ack and backend SEC-04 source sign-off granted.
- BE-27 hosted parity and all deployments: no unambiguous hosted dev project. Do not write to `nciyrepyphvksusoigzx` (labelled production).
- Hosted Realtime DELETE UUID-only validation (SEC-04 N4) waits on BE-27.

## Needs from

- **PO:** safest SEC-04 recognition default is display-name-derived first name only, trimmed/capped at 30 characters (may be empty), inviter-only while pending on an open invite. No email/avatar or general profile access. Review MOB-32's presentation: the name is user-supplied, not verified identity. Exact limits/cooldown are in CONTRACTS. Also identify the hosted dev project for BE-27/deployments.
- **Mobile MOB-32:** ack received on #41; show requester name from `pending_join_requests()` before approval and refetch on request signals; handle cap/decline errors. BE-10 now provides `rpc('send_nudge')` types for MOB-10's `NUDGE_AVAILABLE` flag in its own PR; mobile flips it after lead integration. Suppressed pushes still consume the sender's daily quota.
- **QA QA-10:** token/approval pairing fixtures and pending/name/cap/decline PostgREST tests for #41. Shared stack left untouched.
- **Lead/security:** re-review #41's SEC-04 fixes; lead coordinates QA/mobile merge gates. Backend never merges to main.
