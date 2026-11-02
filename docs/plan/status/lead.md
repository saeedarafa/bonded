# Lead architect status
Updated: 2026-11-02 · Branch: — · Milestone: M1

## Resume here
<!-- Keep this current after every step: the next AI (Claude, Codex or Copilot) starts from it. -->
- Last AI / date: Copilot · 2026-11-02
- Branch + last commit: main 902b2c7, pushed. Merged: fix-routes-flake, QA-02 stack (BE-04 invites v2, BE-05 content, QA-03b, QA-02; local db-tests 99 pass). In flight: backend (Codex, ~/dev/bonded-be) be/BE-04c-hardening (unfinished, tests pending), BE-06/BE-07 branches exist unmerged, stacked on BE-05 (review after BE-04c). Sub-agents: mobile MOB-05 then MOB-08 (bonded-mobile), QA-07 (bonded-qa). REL-03 blocked on MOB-09/11. Pending decisions: QA-BUG-1 (expired-invite limiter), D-open questions 3-6, branch protection.
- Uncommitted work: none
- In flight (sub-agents, one worktree each): backend ~/dev/bonded-be: be/BE-04-invites + be/BE-05-content (done, NOT merged: contract suite must be updated first; temp integration branch lead/integrate-be05, delete after merge), now be/BE-04c-hardening (SEC-01 F2 reveal-rule cut-off, F4/F5/F8-F12) then BE-06, BE-07, BE-09. QA ~/dev/bonded-qa: qa/QA-03b-be04-be05 (contract tests for BE-04/05, must verify the HTTP-400 design on real PostgREST in CI) then qa/QA-02-seed-scenario. Mobile ~/dev/bonded-mobile: fix-routes-flake, MOB-05, MOB-08, MOB-07. Release idle (REL-03 needs MOB-09 + MOB-11). Security: SEC-01 done, report at ~/security-audit-skill/bonded/sec-01-pairing/REPORT.md (2 HIGH: F1 typed-code enumeration, F2 solo answers readable by joiner).
- Exact next step: merge mobile/fix-routes-flake; when QA-03b is green in CI on top of lead/integrate-be05, merge BE-04+BE-05 (then BE-04c once reviewed) then QA-03b; mark D01, D02, D04, D05, D06, D11, D12, D14, D33 done in DESIGN_DELTA; ask the PO the new open questions 3-6.
- Decisions made: BE-03 backend choices accepted (stage `engaged_married`); 42501 = signed out unless message mentions row-level security (mobile); 400-body design for accept_invite/invite_preview accepted pending real-PostgREST verification. D03/D10 done.
- Commands to re-run: `git worktree list`; `bash qa/ci/app.sh`; `bash qa/ci/db-tests.sh`; `node scripts/plan/generate.mjs --check`; `node scripts/agents/sync.mjs --check`; `gh run list -L 3`
- Watch out for:
  - git needs DEVELOPER_DIR=/Library/Developer/CommandLineTools.
  - Plain `git push`/`fetch` fails in agent shells (keychain -128). Use `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push ...` (gh is logged in).
  - Branch protection unavailable (private repo, free plan, HTTP 403): PO decision pending. Merge only after CI is green locally and on GitHub.
  - core.hooksPath = .githooks (shared by all worktrees). No AI attribution anywhere.
  - The iCloud folder (~/Library/Mobile Documents/.../Inbox/GitHub/bonded) is an OLD copy; only take PO edits from it after a diff.

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
- —

## Contract changes in flight
- —

## Questions for the product owner
- D30: final bundle id + invite domain (blocks the first store upload only)
- D32: who makes the Rive mascot file, and by when (MOB-31 needs it in M3)
- Branch protection on a private repo needs GitHub Pro (~$4/month), or make the repo public. Which one?

## Risks
- Widgets (D26) + animated mascot (D32) added to launch scope: expect M4–M5 pressure; first candidates to cut if the RC slips
