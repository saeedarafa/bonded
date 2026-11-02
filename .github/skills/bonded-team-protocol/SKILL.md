---
name: bonded-team-protocol
description: How the Bonded agents work in parallel without conflicts. Covers worktrees and branches, task pickup, status files, handoffs, contract changes, PRs, milestone merges and escalation. Load at the start of every Bonded session, whatever your role.
---

# Bonded team protocol

Five agents (lead, mobile, backend/data, QA, release) plus the security reviewer work on one repo at the same time. This protocol keeps them from blocking or overwriting each other. Ownership is in `AGENTS.md`.

## 1. Workspace
- One git **worktree per agent** next to the main checkout:
  ```bash
  git worktree add ../bonded-mobile -b mobile/MOB-01-scaffold main
  ```
  Never share a working directory with another agent.
- One branch per task, named `<role>/<TASK-ID>-<slug>`. Roles: `lead`, `mobile`, `be`, `qa`, `release`.
- Rebase on `main` at the start of each session and before opening a PR. Never force-push a branch someone else has reviewed.
- Only the lead merges to `main`; `main` is protected (PR, green CI, one review).

## 2. Session start (in this order)
1. `git fetch && git rebase origin/main`.
2. Read `docs/plan/status/<you>.md` (your own notes from last time).
3. Read the *Needs from <you>* sections in every other status file and answer them first.
4. Read the change log at the bottom of `docs/CONTRACTS.md` since your last session. If a contract you consume changed, adapt or object in the PR.
5. Pick the next task: your lowest-milestone unblocked row in `docs/plan/BACKLOG.md`. Dependencies may still be in flight; build against the contract and mark it *waiting on merge*.

## 3. Status file format
Each agent writes only `docs/plan/status/<you>.md`:

```markdown
# <Agent> status
Updated: 2026-11-03 14:20 · Branch: be/BE-04-invites · Milestone: M1

## Resume here
- Last AI / date: Codex · 2026-11-03 14:20
- Branch + last commit: be/BE-04-invites @ 3f2a1c9 "wip: rate limit table + test"
- Uncommitted work: none (pushed)
- Exact next step: write invite_preview() in the new migration, then its anon test
- Commands to re-run: supabase db reset && node supabase/tests/rls.test.mjs supabase/migrations/*.sql
- Watch out for: the 15-min window test pins p_now; don't use now()

## Doing
- BE-04 Invites v2: rate limit done, invite_preview in progress

## Done (since last update)
- BE-03 merged in #12

## Next
- BE-05, BE-23

## Blocked
- BE-04 needs SEC-01 sign-off on D02 before merge

## Needs from
- lead: confirm D02 option (token in link?)
- mobile: none
- qa: contract tests for accept_invite error codes (CONTRACTS §2)

## Contract changes in flight
- accept_invite: new code RATE_LIMITED (PR #14)

## Questions for the product owner
- none
```

Keep it short and current; replace stale lines instead of appending forever.

## 3b. Switching AI tools mid-task
The founder moves between Claude Code, Codex and Copilot when a usage limit hits. Treat every session as one that can end without warning:
- After each finished step: commit (`wip:` is fine on your task branch), push, and rewrite **Resume here**.
- When you see a limit warning: start nothing new; commit, update **Resume here**, push.
- When you pick up someone else's session: read **Resume here**, run `git status`, `git log -5 --oneline` and the "Commands to re-run" to confirm the state, and only then continue. If **Resume here** is stale, rebuild it from git before writing code.
- Never leave important context only in the chat; the next tool can't see it.

## 4. Commits and PRs
- Commit subject: `[TASK-ID][screen-id] Summary`, for example `[MOB-11][20] Hold to reveal ring and haptics`. Omit the screen id when there is none.
- PR body:
  - task id and screen ids;
  - decisions (`Dnn`) implemented;
  - contract changes;
  - test evidence (commands and results);
  - screenshots for UI (light and dark);
  - "Files outside my ownership: none" (or why, with the owner's ack).
- No AI attribution in commit messages or PR descriptions (no `Co-authored-by:` an AI, no "Generated with …" line). Check `git config core.hooksPath` prints `.githooks` before your first commit.
- Small PRs: one task, ideally under 400 changed lines excluding generated files.

## 5. Contract changes
1. The owner of the section edits `docs/CONTRACTS.md` in the same PR as the code.
2. Add a change-log row: `| date | agent | change | breaking? | ack |`.
3. For a breaking change (rename, removal, new required arg, changed error code), the consuming agent writes `ack` in the PR, or the lead decides.
4. Additive changes don't need an ack, but post them under *Needs from* so consumers notice.

## 6. Handoffs
- Backend → mobile: "Types on `main` for BE-xx". Post in your status file the moment the PR merges.
- Mobile → QA: "Screen ready on `mobile/...` for E2E". Include the scenario name to seed.
- QA → owner: a GitHub issue with a failing test; link it in *Needs from*.
- Anyone → lead: a design conflict, a contract dispute, scope or a PO question.
- Lead → release: "Build X ready", with version, build, commit and channel.
- Anyone → security: anything callable by `anon`, any auth change, any new data flow. Route it through the lead.

## 7. Milestone merge (lead runs it, everyone prepares)
1. Each agent: finish or park its milestone tasks, rebase, get CI green, update the status file.
2. Lead merges in order **backend → mobile → QA**, then runs CONTRACTS §9 on a clean clone.
3. Lead tags `mN`, builds a preview with EAS, and asks the release validator for a pass.

## 8. Escalation rules
- Blocked for more than 2 hours of work: write it in *Blocked* and switch to another task.
- Two sources disagree: DESIGN_DELTA (`decided`) > CONTRACTS > design-handoff > ARCHITECTURE. Report the conflict.
- Never edit another agent's files to unblock yourself. Never change `design-handoff/**` or `supabase/content/**` copy (the product owner's).
- Never make a `needs-PO` product decision. Build the documented default and flag it.
