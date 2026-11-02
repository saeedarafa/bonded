# Lead architect status
Updated: 2026-11-02 · Branch: — · Milestone: M1

## Resume here
<!-- Keep this current after every step: the next AI (Claude, Codex or Copilot) starts from it. -->
- Last AI / date: Copilot · 2026-11-02
- Branch + last commit: main 8c2f95e, pushed. Merged this session: BE-23, BE-06, BE-07 (PRs #2-#4), QA-03c (#7), MOB-07 + MOB-09 (#8).
- Open: PR #1 BE-04c fails db-reset because the QA test is outdated; fix is on `qa/QA-03d-be04c-tests` (b205cc7), Codex must merge it into be/BE-04c-hardening, then merge PR #1. QA-BUG-3: get_streak().completed_today is null with no history (backend, coalesce). BE-09 in progress in ~/dev/bonded-be (Codex).
- Exact next step: merge PR #1 once green; then MOB-10 (needs BE-06, now on main), MOB-11, QA-04 and REL-03.
- Uncommitted work: none
- Commands to re-run: `git worktree list`; `bash qa/ci/app.sh`; `gh pr list`; `gh run list -L 3`
- Watch out for: git needs DEVELOPER_DIR=/Library/Developer/CommandLineTools; push with `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push`; no AI attribution; never touch ~/dev/bonded-be.

## Doing
- LEAD-00: repo on GitHub, CI green on main (all 7 jobs incl. db-reset); branch protection blocked by plan (PO)
- M1 integration: merging role branches as they land (all roles run in Claude Code for now)

## Done (since last update)
- LEAD-00 (local): git init, first commit, CODEOWNERS (all @saeedarafa), PR template, .gitignore for machine-local files
- LEAD-01: kickoff answers recorded in DESIGN_DELTA (D02, D07, D21, D26, D32, D33, D34); BACKLOG re-scoped: MOB-30 widgets P0 M4–M5, new MOB-31 Rive mascot (M3), new LEAD-08 content drafts (M3–M4); scope-map 38 → P0 M4

## Next
- LEAD-00, LEAD-01, LEAD-03

## Blocked
- LEAD-00 branch protection: needs GitHub Pro or a public repo (PO decision)

## Needs from
- Security (SEC-02): once PR #1 (BE-04c) and PR #5 (BE-09) are merged, re-verify SEC-01 F1-F12 against `main` (F2 reveal cut-off via `couples.paired_at`, F4/F8 limiter, F5 lock order, F9-F12) plus new surface: `unpair()` ended-couple 30-day read access and re-pairing, purge cron, BE-06/07/23 functions. Report findings to the lead.
- Backend (Codex): PR #1 needs a rebase on `main` (conflicts); PR #5 needs a rebase and a QA handoff for the changed `unpair()` contract.

## Contract changes in flight
- —

## Questions for the product owner
- D30: final bundle id + invite domain (blocks the first store upload only)
- D32: who makes the Rive mascot file, and by when (MOB-31 needs it in M3)
- Branch protection on a private repo needs GitHub Pro (~$4/month), or make the repo public. Which one?

## Risks
- Widgets (D26) + animated mascot (D32) added to launch scope: expect M4–M5 pressure; first candidates to cut if the RC slips
