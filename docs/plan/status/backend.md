# Backend / data developer status

Updated: 2026-11-03 · Branch: `be/BE-30-approval-race` · Task: BE-30 / issue #57 (M2)

## Resume here

- Last AI/date: Codex · 2026-11-03. Worktree `/Users/saeedarafa/dev/bonded-be` only.
- Current task: BE-30 / #57, separate branch `be/BE-30-approval-race` from `origin/main` (`47f02c0`). Exact current base: `git log -1` before this checkpoint. No feature changes yet.
- Exact next step: add a deterministic interleaving regression for two approvals of one invite. Reproduction already confirms loser gets `COUPLE_FULL`, pending row and +1 failed attempt when another approval wins at `before_couple_lock`. Add a new migration (never edit merged 130000/140000): approved completion must normalize a stale invite/full/ended target to uncounted `JOIN_REQUEST_EXPIRED`, and approval must mark the losing request expired. Preserve normal typed/token behavior, auth and lock order. Add tests for winner, loser status/error/body/accounting/retry/auth restoration; regenerate/check types, update CONTRACTS, verify and open one PR.
- Prior reviews completed first: #41 merged via QA-10/#54, MOB-32/#56 and D37/#58 merged. #55 main merged without rebase in `bff7d65`, hardening 91/91 and reveal-rule/RLS 23/23 pass; **all seven CI checks green**, run 41667343335. #53 main merged without rebase in `5072d08`, types regenerated, both contracts/suites preserved; **all seven CI green**, run 41667798157. Local #53 full **19 DB suites pass** (nudge 30/30, join requests 58/58, reveal 23/23); Deno/type/seed/plan/sync/typecheck/lint/format pass; Jest **40 suites / 681 tests** pass. Security source sign-off on #53 received at `9f20655`; nudge migration/notify implementation unchanged by main merge. Replies posted on #53/#55. Both await lead integration; backend never merges main.
- Uncommitted work: none after checkpoint commit/push. Commit and push after each finished step, update this handoff.
- Commands: `node supabase/tests/join-requests.test.mjs`; new approval-race test; `npm --prefix supabase/tests test`; `SUPABASE_TELEMETRY_DISABLED=1 node supabase/tests/gen-types.mjs`; `npm --prefix supabase/tests run check:types`; `bash qa/ci/functions.sh`; `npm run typecheck`; `gh pr checks 53`; `gh pr checks 55`.
- Git credential workaround: per-command `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' fetch/pull/push`. Hooks `.githooks` configured; no attribution trailers or secrets.
- Never reset/stop shared `bonded` stack; PGlite is isolated and real reset evidence comes from CI. Never use production or unidentified hosted projects. No rebases/force-pushes/main merges.

## Doing

- BE-30 / #57: deterministic regression + approved-completion race fix next.

## Done

- #53 and #55 lead review requests addressed: main merged, fresh local checks and all seven CI checks pass on each merged code head; PR replies posted.
- BE-26/#41 and QA-10/#54, MOB-32/#56, D37/#58 merged; no remaining backend request on #41 except separately tracked BE-30.
- BE-29/#55 checks stored answer body and detects the isolated UPDATE-policy mutation.

## Next

- Finish BE-30, one PR from main; QA tightens its owned concurrent-approval assertion when the fix is ready.
- BE-19 daily reminders remains the next unstarted M3 task after this M2 follow-up.

## Blocked

- BE-27 hosted parity/deployment and SEC-04 N4: no unambiguous dev project. No writes to `nciyrepyphvksusoigzx` (production-labelled).

## Needs from

- Lead: integrate #55 and #53 (merged-head CI green; #53 security source sign-off received). Mobile flips `NUDGE_AVAILABLE` after #53 lands.
- QA/lead: acceptance for BE-30 requires tightening `qa/contract/join-requests.test.ts` race loser to `JOIN_REQUEST_EXPIRED` plus expired-row/uncounted assertions. Backend will supply regression evidence in its own tests; no QA-owned files edited. Use an isolated approved stack for real two-session validation.
- Security: review BE-30 approved-completion normalization and unchanged requester/inviter authorization when its PR opens.
- PO: identify hosted dev project; review MOB-32 display-name recognition UI (name is user-supplied, not verified identity).
