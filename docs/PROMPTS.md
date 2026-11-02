# Prompts: copy, paste, run

Ready-made messages for running the Bonded agents in Claude Code, Codex and Copilot. Replace the parts in `<angle brackets>`. Background: [GETTING_STARTED.md](GETTING_STARTED.md).

**Roles:**

| Role | Agent file (`.github/agents/…`) | Status file (`docs/plan/status/…`) | Task prefix | Worktree |
|---|---|---|---|---|
| lead | `lead-architect.agent.md` | `lead.md` | `LEAD-` | main checkout |
| mobile | `mobile-developer.agent.md` | `mobile.md` | `MOB-` | `../bonded-mobile` |
| backend | `backend-data-developer.agent.md` | `backend.md` | `BE-` | `../bonded-backend` |
| qa | `qa-automation.agent.md` | `qa.md` | `QA-` | `../bonded-qa` |
| release | `release-validator.agent.md` | `release.md` | `REL-` | `../bonded-release` |
| security | `security-reviewer.agent.md` | `security.md` | `SEC-` | main checkout (read-only) |

**Which AI for which role:**
- **Claude Code:** lead (it can run the others as sub-agents) and mobile.
- **Codex:** backend, QA, security reviews. One role per session, never the lead.
- **Copilot:** backup for whichever AI hit its limit. Pick the role in the agent picker, then paste the role prompt.

---

## 1. Very first message (Claude Code, lead)
Use it once, after git works and the project is out of iCloud.

```text
You are the lead agent for Bonded. Read AGENTS.md and .github/agents/lead-architect.agent.md, then every file in docs/plan/status/.
Start with LEAD-00: git setup, first commit, GitHub repo. Then LEAD-01: ask me the open questions in docs/plan/DESIGN_DELTA.md one at a time.
After that, delegate the M1 tasks to the role agents, following these rules:
- Give every agent that writes code its own git worktree and branch.
- Never delegate a role I say is running in another AI.
- After each finished step, make sure the agent has committed and updated the "Resume here" section of its status file.
```

## 2. Daily opening (Claude Code, lead)
```text
You are the lead agent for Bonded. Read AGENTS.md, .github/agents/lead-architect.agent.md and every file in docs/plan/status/.
Today <role(s)> is running in <Codex/Copilot>; don't delegate that role.
Review and merge what's ready, answer the "Needs from lead" items, delegate the next tasks, and list what needs my decision.
```

## 3. Start a role session (any AI)
First open the role's worktree. Create it once with:
```bash
git worktree add ../bonded-<role> -b <prefix>/<TASK-ID>-<slug> main
```

Then:
```text
You are the <role> agent for Bonded. Read AGENTS.md, .github/agents/<agent-file>.agent.md and the "Resume here" section of docs/plan/status/<status-file>.md, and load the skills your role lists.
Take your next unblocked <PREFIX>-* task from docs/plan/BACKLOG.md and work on a branch named after it.
After every step, commit and update "Resume here". When the task meets its acceptance, push and open a PR. Don't merge to main. Then start the next task on a new branch.
```

**Example (Codex, backend):**
```text
You are the backend agent for Bonded. Read AGENTS.md, .github/agents/backend-data-developer.agent.md and the "Resume here" section of docs/plan/status/backend.md, and load the skills your role lists.
Take your next unblocked BE-* task from docs/plan/BACKLOG.md and work on a branch named after it.
After every step, commit and update "Resume here". When the task meets its acceptance, push and open a PR. Don't merge to main. Then start the next task on a new branch.
```

## 4. Limit is close (send to the AI that is running out)
```text
Limit is close. Stop starting new work. Commit everything to your branch (a wip: commit is fine), push, and update the "Resume here" section of every status file for roles that worked in this session: branch, last commit, uncommitted files, exact next step, commands to re-run. Reply with one line per role.
```

## 5. Continue in another AI after a limit
Open the same folder (the role's worktree) in the new AI, then:
```text
Another AI just hit its usage limit while working on Bonded. Read AGENTS.md, then every file in docs/plan/status/. Run git status, git worktree list and git log -5 --oneline. Tell me in 3–5 lines which roles have unfinished work and what state each one is in.
Then continue as the <role> agent: read .github/agents/<agent-file>.agent.md, re-run the commands in its "Resume here" to confirm the state, and carry on from "Exact next step". Update "Resume here" and commit after every step.
```
If you don't know which role was cut off, send only the first paragraph. The AI will tell you, and you reply with the role.

## 6. The previous AI stopped without notes
Add this to prompt 5:
```text
The previous AI didn't update its status file. Rebuild the state from git status, git diff and the last commits, write "Resume here" first, then continue.
```

## 7. Back in an AI whose limit has reset
Don't type "continue" in the old chat: other AIs have worked since, so its memory is stale. Start a **new chat** with prompt 3 (same role) or prompt 2 (lead).

## 8. Moving a role from one AI to another for the day
To the AI giving up the role (if it still has limit):
```text
Hand off the <role> role: finish or park the current step, commit, push, and update "Resume here". Then stop working on <role>.
```
Then, in the AI taking over: prompt 5, or prompt 3 if the handoff was clean. Tell the lead (prompt 2) which AI has the role now.

## 9. Ask for a review from a different AI
Run this in Codex when the code was written in Claude, or the other way round:
```text
You are the security agent for Bonded. Read AGENTS.md and .github/agents/security-reviewer.agent.md and load the security-audit skill.
Review <branch or PR> in guidance mode. Focus on <e.g. pairing, invite_preview, RLS>. Report confirmed findings separately from needs-validation ones. Don't change code. Write a summary in docs/plan/status/security.md.
```

## 10. Milestone check (lead)
```text
You are the lead agent for Bonded. M<N> work should be finished. Check every status file and the open PRs. Merge in the order backend, mobile, QA. Run the integration check in docs/CONTRACTS.md §9. Tag m<N>. Then tell me what failed, what's left, and what the release validator should check on this build.
```

---

## Rules worth remembering
1. One AI per folder at a time. Two roles in parallel means two worktrees.
2. A new AI has no memory of other chats. The status files and git are the memory.
3. Codex and Copilot open PRs; only the lead (or you) merges to `main`, backend PRs first.
4. Tell the lead which roles are running outside Claude, so nothing is done twice.
