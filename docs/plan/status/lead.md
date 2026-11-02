# Lead architect status
Updated: 2026-11-02 · Branch: — · Milestone: M1

## Resume here
<!-- Keep this current after every step: the next AI (Claude, Codex or Copilot) starts from it. -->
- Last AI / date: Claude Code · 2026-11-02 (stopped near usage limit)
- Branch + last commit: main @ "[LEAD-05] Status: limit stop" (pushed). Merged this session: MOB-03 (fc86e16), BE-24 (3022a88; db-tests rls 22, error-codes 44, private-helpers 74; app 50 tests; all green).
- Uncommitted work: none
- Ready for review, NOT merged (all pushed, worktrees clean):
  - be/BE-03-couples-v2 @ 79bf5a8 (contains BE-24). BREAKING §2: `create_invite` needs `create_couple` first; app can't write couples.status/ended_at/ids. Needs mobile ack in its status file before merge (nothing in app/ calls it yet, as with BE-02). Backend choices to confirm: stage values per D10 (`engaged_married`, not spec 05's `married`); partner_name stored on couples; unknown stage → 22P02, not a contract code; over-long goals/names truncated.
  - mobile/MOB-29-i18n @ 3650209: i18next + react-i18next + expo-localization; raw-string lint rule combined with tokenOnlyRules; 58 tests. Agent reports all checks green; lead hasn't reviewed yet.
  - qa/QA-01b-format-check: format:check added to qa/ci/app.sh (workflow unchanged); green locally. Ready to merge.
  - qa/QA-03-contract-tests @ f6d3e82 (draft; 995d3c7 is a wip: commit, squash on merge): qa/contract/ Vitest + supabase-js, 35 passed / 45 todo in CI run 41475226546 (all 7 jobs green). Runs inside the db-reset job because the gh token lacks the `workflow` scope (PO: `gh auth refresh -h github.com -s workflow`), so it isn't pinned to Node 24 yet.
- Exact next step: review + merge QA-01b and MOB-29, then BE-03 (after mobile ack), then QA-03 (rebase on BE-03; turn the BE-03/BE-24 todos into tests); re-run CI scripts after each merge and push. Then: mark D03/D10 `done (BE-03)` in DESIGN_DELTA; update `.github/skills/bonded-db-change/SKILL.md` §1 helper names to `private.*` and run `node scripts/agents/sync.mjs`; mobile + qa ack the BE-24 change-log row; route BE-24 + BE-03 to SEC-01. Round 3: BE-04 then BE-05; MOB-06 then MOB-04; QA-02 after BE-05; SEC-01 once BE-04 has a branch. Release stays idle until MOB-09/MOB-11.
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
