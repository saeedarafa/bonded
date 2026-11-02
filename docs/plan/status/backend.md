# Backend / data developer status

Updated: 2026-11-02 · Branch: `be/BE-10-nudges-v2` · Milestone: M3

## Resume here

<!-- Keep this current after every step: the next AI starts here. -->
- Last AI / date: Codex · 2026-11-02
- Branch + last commit: `be/BE-10-nudges-v2`, created from fetched `origin/main` (`1621788`); no product changes on this branch yet.
- Uncommitted work: this status handoff only.
- Exact next step: commit and push this blocked-task handoff. Then take BE-12 on a new branch based on `be/BE-06-streak-v2` / PR #3 (it depends on unmerged BE-06); say so in the BE-12 PR. Do not implement BE-10 until BE-08 lands or an explicit compatible dependency branch is provided.
- Commands to re-run: once BE-12 starts, first rerun its inherited BE-06 checks and then the full DB suite.
- Watch out for: no Docker locally. Git needs `DEVELOPER_DIR=/Library/Developer/CommandLineTools`; push with `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push`. Never add secrets or AI attribution.

## Doing

- BE-10 — blocked by its explicit BACKLOG dependency BE-08 (`notify`, `push_log`, quiet-hour/cap infrastructure). BE-08 is not merged or available as a dependency branch.

## Done

- BE-04c hardening: PR #1 open.
- BE-23 Edge Function foundation: PR #2 open; dev deployment remains blocked pending a Supabase management access token.
- BE-06 streak v2: PR #3 open.
- BE-07 notification preferences: PR #4 open.
- BE-09 ended couples: PR #5 open.

## Next

- BE-12 badges, stacked on BE-06 PR #3 because it explicitly depends on BE-06.

## Blocked

- BE-10 waits for BE-08. It must enqueue the `nudge_sent` notification through BE-08 infrastructure; substituting an ad-hoc queue would violate the dependency and duplicate business logic.
- BE-23 dev deployment remains blocked until the founder provides a Supabase management access token able to link/deploy to the supplied dev project. The provided project URL, database password and publishable key must not be committed.

## Needs from

- Lead: merge/review PRs #1–#5 when ready; provide or identify a BE-08 branch when work begins.
- Mobile and QA: BE-09 changed unpair to a 30-day read-only archive (PR #5).
