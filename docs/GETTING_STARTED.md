# Getting started: running the Bonded agent team

> Every prompt mentioned here, ready to copy, is in [PROMPTS.md](PROMPTS.md).

You (the founder and product owner) drive the AI agents. This page covers one-time setup, how to start development, the daily routine, and what to do when an AI hits its limit.

## 1. One-time setup

### 1.1 Move the project out of iCloud Drive (strongly recommended)
iCloud syncs `.git`, `node_modules` and build folders file by file. That corrupts git repos, creates "file 2" duplicates and breaks worktrees. Keep code in a normal folder and use GitHub as the backup:
```bash
mkdir -p ~/Developer && cp -R "$HOME/Library/Mobile Documents/com~apple~CloudDocs/Inbox/GitHub/bonded" ~/Developer/bonded
```
Open `~/Developer/bonded` in VS Code from now on. Delete the iCloud copy once GitHub has everything.

### 1.2 Fix Xcode (git and xcodebuild currently fail on this Mac)
`git --version` and `xcodebuild` fail with `Symbol not found: _XPCTypeBool`: Xcode's device framework doesn't match the installed macOS/Xcode.
1. Update macOS and Xcode (App Store) to versions that match.
2. Open Xcode once and let it install its components, or run `sudo xcodebuild -runFirstLaunch`.
3. Check:
   ```bash
   git --version && xcodebuild -version
   ```
If git still fails, `brew install git` gives you a working git independent of Xcode. You still need a working Xcode for iOS builds.

### 1.3 Install the tools
| Tool | Install | Used by |
|---|---|---|
| Docker Desktop or OrbStack | from their website | `supabase start` (local database) |
| Supabase CLI | `brew install supabase/tap/supabase` | backend, QA |
| Deno | already installed | edge functions |
| Node LTS | already installed (v24) | everything |
| EAS CLI | `npm i -g eas-cli` | mobile builds |
| Android Studio + an emulator; Java 17 | already installed (see "Local dev environment" in `AGENTS.md`) | Android |
| Maestro | `brew tap mobile-dev-inc/tap && brew install maestro` | QA end-to-end tests |
| GitHub CLI | `brew install gh && gh auth login` | PRs |

### 1.4 Create the repo (task LEAD-00)
```bash
cd ~/Developer/bonded && git init -b main && git add -A && git commit -m "Bonded: design hand-off, agents, plan"
```
```bash
gh repo create bonded --private --source=. --push
```
Turn on the hook that keeps AI tools out of commit authorship (once per clone; worktrees share it):
```bash
git config core.hooksPath .githooks
```
Claude Code (`.claude/settings.json`) and Copilot (`.vscode/settings.json`, `git.addAICoAuthor: off`) are also set not to add co-authors. Codex follows the rule in `AGENTS.md`, and the hook catches anything that slips through. PR descriptions can't be filtered by a hook, so the rule in `AGENTS.md` covers them.
Then let the lead agent finish LEAD-00 (branch protection, CODEOWNERS, PR template).

### 1.5 Accounts
Work through [docs/plan/ACCOUNTS.md](plan/ACCOUNTS.md). M1 needs only GitHub, Supabase (`dev`) and Expo. Apple and Google can follow in week 1–2. You create the accounts and hold the keys; agents never do.

## 2. Which AI reads what (already set up)
| | Claude Code | Codex (ChatGPT) | Copilot in VS Code |
|---|---|---|---|
| Project context, loaded automatically | `CLAUDE.md` → imports `AGENTS.md` | `AGENTS.md` | `.github/copilot-instructions.md` + `AGENTS.md` |
| Role agents | `.claude/agents/` (generated) | by prompt: "read `.github/agents/<role>.agent.md`" | agent picker (`.github/agents/`) |
| Skills | `.claude/skills/` (generated) | `.agents/skills/` (generated) | `.github/skills/` |
| Where work state lives | git + `docs/plan/status/<role>.md` | same | same |

Edit agents and skills only in `.github/`, then run:
```bash
node scripts/agents/sync.mjs
```

The other dot-folders: `.codex/` holds Codex hooks, `.engram/` is the knowledge-graph cache, and `.agents/` is Codex's skill folder. All of them are expected.

## 3. Start developing (week 1)
Start one session per role, each in **its own worktree**, so two AIs never edit the same folder.

| Order | Role | Where | First tasks |
|---|---|---|---|
| 1 | Lead | main checkout | LEAD-00, LEAD-01 (answers your open questions), LEAD-03 |
| 2 | Backend | `../bonded-backend` | BE-01 → types + seed (**unblocks everyone**), then BE-02, BE-23 |
| 3 | Mobile | `../bonded-mobile` | MOB-01, MOB-03, MOB-29, MOB-04 (no backend needed) |
| 4 | QA | `../bonded-qa` | QA-01 (CI), then QA-02 after BE-05 |
| later | Release | `../bonded-release` | REL-01/02 in week 1–2, dry run at M2 |
| later | Security | main checkout, read-only | SEC-01 when BE-04 has a PR |

Create a worktree:
```bash
git worktree add ../bonded-backend -b be/BE-01-local-stack main
```

The prompt to start any session, in any AI:
> You are the **backend** agent for Bonded. Read `AGENTS.md`, then `.github/agents/backend-data-developer.agent.md`, then the **Resume here** section of `docs/plan/status/backend.md`. Load the skills your role lists. Continue from "Exact next step". Update **Resume here** and commit after every step.

Shortcuts per tool:
- **Claude Code:** "Use the backend-data-developer agent to …". The lead can delegate to the other agents itself, but they all share your Claude limit.
- **Copilot:** pick **Backend Data Developer** in the chat agent picker, then paste the prompt.
- **Codex:** paste the prompt as is.

**A realistic solo routine:** run 2 AIs at once (for example backend in Claude and mobile in Codex), each in its own worktree. Use the third AI for QA or review. Open the lead session once a day: it reads every status file, answers the "Needs from lead" items, reviews PRs and merges.

### 3.1 Running the app
Bonded uses native modules (MMKV, Google sign-in, in-app review), so it runs in a **development build**, not in Expo Go (Expo Go is not supported).
- `npm run ios` / `npm run android` build the development build and install it on the iOS simulator or Android emulator. They need Xcode or Android Studio, and the first run is slow (about 10 minutes). Build again only when native dependencies change.
- After that, `npm start` serves the JavaScript to the installed build. Open Bonded on the simulator, not Expo Go.
- `expo run:ios` regenerates `ios/` and may rewrite the `ios`/`android` scripts in `package.json`. Run `git checkout -- package.json` before you commit.

## 4. Daily loop
1. **Morning:** lead session. "Read all status files, review open PRs, merge what's ready, and tell me what needs my decision."
2. Answer the product questions the lead raises (they're also in DESIGN_DELTA's open questions).
3. **Role sessions:** each continues from its **Resume here**.
4. **Evening:** each role session finishes its step, commits, pushes and updates its status file.

## 5. When an AI hits its limit
1. **Ideally before it happens:** when the tool warns you, say "Limit is close: commit, push, and update Resume here now."
2. **Switch** to another AI in the **same worktree** (close the old one first) and paste the start prompt with the same role.
3. The new AI checks `git status` and the last commits, re-runs the tests from **Resume here**, and continues.
4. **If the old AI stopped mid-edit without notes:** tell the new one, "The previous session stopped without updating status. Reconstruct the state from git diff and the last commits, write Resume here, then continue."

This works because everything an agent needs is in the repo (AGENTS.md, contracts, backlog, status files, commits), not in a chat history. Never keep decisions only in a chat. Ask the AI to write them into the status file or DESIGN_DELTA.

## 6. Housekeeping
- Changed an agent or skill? Run `node scripts/agents/sync.mjs`.
- Changed priorities in `docs/plan/scope-map.json`? Run `node scripts/plan/generate.mjs`.
- CI (QA-01) runs both with `--check`, so stale copies fail the build.
