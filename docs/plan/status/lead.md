# Lead architect status
Updated: 2026-11-02 evening · Branch: main · Milestone: M1

## Resume here
<!-- Keep this current after every step: the next AI (Claude, Codex or Copilot) starts from it. -->
- Last AI / date: Claude Code · 2026-11-02 (evening)
- Branch + last commit: main @ 5356b45. Merged this session: #10 MOB-10a, #11 MOB-10b (Today 18/23/24/28).
- Open PRs: #1 BE-04c @ b65361e: rebased, R1 fixed, but db-reset red because the rebase dropped QA-03d (b205cc7) and the answers "edit own answer" policy still lacks cq_in_pair_period (comment posted). #5 BE-09 @ 0fa7a68: rebased on main; Codex rebases again after #1. #12 QA-03e (base be/BE-09): green; QA is rebasing it onto the rewritten BE-09 head; backend merges it into BE-09.
- Decided 2026-11-02 (PO delegated D02/D04 to the lead): D02 typed codes need inviter approval (BE-26, MOB-32, QA-10); D04 solo couple is ended, not deleted (BE-25). Both start after #1 and #5 merge.
- Running: mobile MOB-11 (answer, hold to reveal, reactions) in ~/dev/bonded-mobile; QA rebasing QA-03e in ~/dev/bonded-qa.
- Exact next step: `gh pr list --state open`; merge #1 when green, then #5 (after its rebase on #1, with #12 merged in); review MOB-11; then QA-04 and REL-03 (after MOB-11 is on main and a build exists).
- Uncommitted work: none
- Commands to re-run: `git worktree list`; `gh pr list --state open`; `gh pr checks <n>`; `bash qa/ci/app.sh`
- Watch out for: git needs DEVELOPER_DIR=/Library/Developer/CommandLineTools; fetch/push with `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' …`; no AI attribution; never touch ~/dev/bonded-be or ~/dev/bonded-security.

## Roles running outside
- Backend (~/dev/bonded-be) and security (~/dev/bonded-security) run in Codex. Coordinate only through PRs, reviews and status files. Codex has an unopened branch `be/BE-10-nudges-v2`.
- Mobile, QA and release run as Claude Code sub-agents from the lead session.

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
- Security (SEC-02): once PR #1 (BE-04c) and PR #5 (BE-09) are merged, re-verify SEC-01 F1-F12 against `main` (F2 reveal cut-off via `couples.paired_at`, F4/F8 limiter, F5 lock order, F9-F12) plus new surface: `unpair()` ended-couple 30-day read access and re-pairing, purge cron, BE-06/07/23 functions. Report findings to the lead.
- Backend (Codex): see the reviews on PR #1 and #5. #1: rebase on main, add SEC-01 R1 (cq_in_pair_period on thread_messages, reactions, read markers and answers update) + pre-hardening regression. #5: rebase on main, then on #1 after it merges; keep cq_in_pair_period in every recreated policy; merge qa/QA-03e-be09-tests; mark the unpair() change breaking in CONTRACTS. Also QA-BUG-3: coalesce get_streak().completed_today to false. After #1 and #5: BE-25 (D04 solo archive), then BE-26 (D02 typed-code approval).
- Backend also: QA-BUG-4 (issue #9) delete-account seed leaves Maya's left_at null; `get_streak` has no field for the streak that just ended (screen 28 "Before yesterday" row dropped until it exists); BE-10 types for the nudge button.
- Mobile: MOB-10 merged; follow-ups GAPS.md table, `paired_at` for Day N once #1 is on main.
- Security: sign off the D02 approval design (BE-26) along with SEC-02.

## Contract changes in flight
- —

## Questions for the product owner
- D30: final bundle id + invite domain (blocks the first store upload only)
- D32: who makes the Rive mascot file, and by when (MOB-31 needs it in M3)
- D02/D04: decided by the lead on PO delegation (2026-11-02); PO can still revisit the look of the pending-join state (MOB-32).

## Risks
- Widgets (D26) + animated mascot (D32) added to launch scope: expect M4–M5 pressure; first candidates to cut if the RC slips
