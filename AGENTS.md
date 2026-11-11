# Bonded: agent team charter

Bonded is a couples app for iOS and Android. Every day both partners answer the same question; answers stay locked until both have replied, then they reveal together and talk about it. Stack: Expo (React Native, TypeScript) + Supabase (Postgres with RLS, Auth, Realtime, Edge Functions) + RevenueCat. The product brief is [docs/PRODUCT_BRIEF.md](docs/PRODUCT_BRIEF.md).

Every agent reads this file first. It is owned by the lead architect.

## The team

| Agent | Definition | Owns (writes) | Never edits |
|---|---|---|---|
| Lead architect | [.github/agents/lead-architect.agent.md](.github/agents/lead-architect.agent.md) | `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/ANALYTICS.md`, `docs/plan/{BACKLOG,DESIGN_DELTA,SCOPE}.md`, `docs/plan/scope-map.json`, `docs/plan/ACCOUNTS.md`, `CODEOWNERS`, the CONTRACTS change log; merges to `main` | Feature code (reviews it instead) |
| Mobile app developer | [.github/agents/mobile-developer.agent.md](.github/agents/mobile-developer.agent.md) | `app/`, `src/` (not `src/types/database.ts`), `assets/`, `plugins/`, `app.config.ts`, `eas.json`, `package.json`, `tsconfig.json`, app `.env.example`, unit tests in `src/**/__tests__` | `supabase/**`, `qa/**`, `design-handoff/**` |
| Backend / data developer | [.github/agents/backend-data-developer.agent.md](.github/agents/backend-data-developer.agent.md) | `supabase/**` (migrations, seed, functions, DB tests, config), `src/types/database.ts` (generated), CONTRACTS §2–§7 | `app/`, `src/` (except generated types), `qa/**`, `supabase/content/*` copy |
| QA / automation engineer | [.github/agents/qa-automation.agent.md](.github/agents/qa-automation.agent.md) | `qa/**` (not `qa/release/`), `.github/workflows/**`, `.maestro/` | Product code (files bugs instead) |
| Release validator | [.github/agents/release-validator.agent.md](.github/agents/release-validator.agent.md) | `qa/release/**` | Everything else |
| Security reviewer | [.github/agents/security-reviewer.agent.md](.github/agents/security-reviewer.agent.md) | Audit reports outside the repo (see its README) | Product code |
| Product owner (human) | — | `design-handoff/**`, `supabase/content/**` copy, priorities, credentials, store accounts | — |

Shared files and their rules:
- `docs/CONTRACTS.md`: each section names its owner. A change goes in the owner's PR with a change-log line; a breaking change needs the consumer's ack.
- `docs/plan/status/<agent>.md`: each agent writes **only its own** file.

## Local dev environment (founder's Mac)

Verified 2026-11-10. Do not reinstall these; use them.

- **Android Studio 2026.2** is at `/Applications/Android Studio.app`. SDK: `~/Library/Android/sdk` (platform android-37.0, build-tools 36.0.0, platform-tools, emulator). `JAVA_HOME` (Android Studio's bundled JBR), `ANDROID_HOME` and `PATH` (`adb`, `emulator`) are already set in `~/.zshrc`; in a non-interactive shell, source them or use the full paths.
- **Android emulator:** AVD `Medium_Phone_API_37.0` (arm64, Android 17, Google Play image). Start it with `emulator -avd Medium_Phone_API_37.0`, then wait for `adb shell getprop sys.boot_completed` to print `1`. It shows as `emulator-5554` in `adb devices`. A second AVD (for two-device tests) does not exist yet: QA creates it in Android Studio's Device Manager.
- `cmdline-tools` (`sdkmanager`, `avdmanager`) are **not** installed; use Android Studio's SDK Manager if a task needs them.
- **iOS:** Xcode 27.2 with iOS 18.0 and 18.3 simulator runtimes. Do not set `DEVELOPER_DIR` to CommandLineTools: it hides `simctl`.
- The disk is nearly full (about 13 GB free). Avoid creating extra AVDs or large build caches without need, and clean up worktree `node_modules` and build output you no longer use.

## Where the truth lives

| Question | Source |
|---|---|
| What does a screen look like? | `design-handoff/DESIGN.md`, `design-handoff/specs/`, `design-handoff/source/*.dc.html` |
| Which screens ship, in which milestone? | [docs/plan/SCOPE.md](docs/plan/SCOPE.md) (generated from `scope-map.json`) |
| Who does what, in what order? | [docs/plan/BACKLOG.md](docs/plan/BACKLOG.md) |
| Where the design differs from the original contracts | [docs/plan/DESIGN_DELTA.md](docs/plan/DESIGN_DELTA.md) |
| How app, database and functions talk | [docs/CONTRACTS.md](docs/CONTRACTS.md) |
| System design | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Which analytics events exist, and what must never be sent | [docs/ANALYTICS.md](docs/ANALYTICS.md) |
| Development content and test data | `supabase/content/`, `qa/fixtures/` |
| Release checks | `qa/release/RC_CHECKLIST.md`, `qa/release/screen-requirements.csv` |
| How the founder runs the team and switches AI tools | [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md), copy-paste prompts in [docs/PROMPTS.md](docs/PROMPTS.md) |

If two sources disagree, the order is: DESIGN_DELTA (`decided`) > CONTRACTS > design-handoff > ARCHITECTURE. Report the conflict to the lead in your status file.

## Skills

Project skills live in `.github/skills/` (the source). Copies for Claude Code (`.claude/skills/`) and Codex (`.agents/skills/`) are generated by `node scripts/agents/sync.mjs`; never edit the copies. Load the ones your role needs before starting work:

| Skill | Used by |
|---|---|
| [bonded-team-protocol](.github/skills/bonded-team-protocol/SKILL.md) | everyone |
| [bonded-screen-build](.github/skills/bonded-screen-build/SKILL.md) | mobile, QA, release |
| [bonded-db-change](.github/skills/bonded-db-change/SKILL.md) | backend, QA, security |
| [bonded-edge-function](.github/skills/bonded-edge-function/SKILL.md) | backend |
| [bonded-test-automation](.github/skills/bonded-test-automation/SKILL.md) | QA, plus mobile and backend for their own tests |
| [bonded-release-check](.github/skills/bonded-release-check/SKILL.md) | release, lead |
| [security-audit](.github/skills/security-audit/SKILL.md) | security |

## Three AI tools, one project

The founder switches between Claude Code, Codex (ChatGPT) and GitHub Copilot in VS Code, often mid-task when a usage limit hits. **The repo is the memory:** anything not committed and not written in a status file is lost when you switch.

| Tool | Reads automatically | Role agents | Skills |
|---|---|---|---|
| Claude Code | `CLAUDE.md` (imports this file) | `.claude/agents/` (sub-agents, generated) | `.claude/skills/` (generated) |
| Codex | `AGENTS.md` (this file) | none: read `.github/agents/<role>.agent.md` when told your role | `.agents/skills/` (generated) |
| Copilot (VS Code) | `.github/copilot-instructions.md`, `AGENTS.md` | `.github/agents/` (agent picker) | `.github/skills/` (source) |

To edit an agent or a skill, change `.github/`, then run `node scripts/agents/sync.mjs`. CI runs it with `--check`.

### Starting a session (any tool)
Paste this, filling in the role (lead, mobile, backend, qa, release or security):

> You are the **<role>** agent for Bonded. Read `AGENTS.md`, then `.github/agents/<role-file>.agent.md`, then the **Resume here** section of `docs/plan/status/<role>.md`. Load the skills your role lists. Continue from "Exact next step". Update **Resume here** and commit after every step.

Role files: `lead-architect`, `mobile-developer`, `backend-data-developer`, `qa-automation`, `release-validator`, `security-reviewer`.

### Switching AI tools (when a limit is near or hit)
1. **Work so that switching is cheap.** After every finished step (a test passing, a component done), commit to your task branch, using `wip:` commits if needed, and update **Resume here**. Don't wait for the end of the session; a limit can stop you mid-sentence.
2. **If you see a limit warning:** stop starting new work. Commit, write **Resume here** (branch, last commit, uncommitted files, the exact next step, commands to re-run, gotchas) and push.
3. **The new tool** starts with the prompt above. It runs `git status` and `git log -5` on the branch, reads **Resume here**, and verifies the last step (re-runs its tests) before continuing.
4. If the previous tool stopped without updating the status file, the new tool reconstructs the state from `git status`, `git diff` and the last commits, writes **Resume here** first, then continues.
5. **One tool per worktree at a time.** Never run two AIs in the same worktree; two roles in parallel means two worktrees.

## Working together (summary of bonded-team-protocol)

1. **One worktree per agent**, one branch per task: `lead/…`, `mobile/MOB-09-pairing`, `be/BE-04-invites`, `qa/QA-03-contract-tests`, `release/REL-03-m2-dry-run`. Only the lead merges to `main`.
2. **Start of every session:** pull `main`, read your status file, the BACKLOG rows you own, the CONTRACTS change log and every other agent's "Needs from" section that names you.
3. **Commits and PRs** name the task and screen: `[MOB-11][20] Hold to reveal`.
4. **Blocked?** Write it in your status file under *Blocked*, then work on the next unblocked task. Never edit another agent's files to unblock yourself.
5. **Contract change?** The owner proposes it in their PR with a change-log line; the consumer acks in the PR.
6. **End of every session:** update your status file (Done / Doing / Next / Blocked / Needs from).

## Definition of done (all code tasks)
- Acceptance in BACKLOG met; tests added and green in CI.
- Contract changes recorded; types regenerated when the schema changed.
- No answer or message text in logs, analytics or crash reports.
- The reveal rule test passes (release blocker).
- Status file updated; PR reviewed by the lead.

## Non-negotiables
- Business rules live in the database (RLS, RPCs), never only in the app.
- Prices only from RevenueCat offerings. No fake ratings or reviews.
- Original design and content only; nothing copied from other apps.
- Secrets never in the repo or the app bundle (`SUPABASE_SERVICE_ROLE_KEY` only in functions).
- Test accounts and data only: never real user data, never production for testing.
- **Simulators (founder rule, 2026-11-11).** At most two iOS simulators exist for Bonded, ever: `REL-A` (iPhone 16 Pro Max, iOS 18.0) and `REL-B` (iPhone SE 3rd, iOS 18.0); find them with `xcrun simctl list devices | grep -E "REL-A|REL-B"`. Never create one (`xcrun simctl create`, Xcode or any other tool) and never delete REL-A/REL-B or devices you did not create; for other screen sizes use `xcrun simctl erase` plus another build config, or ask the lead. Check `xcrun simctl list devices booted` before booting and reuse what is booted; never more than two booted, and only one unless the task is a two-device Maestro flow (pairing, daily, reveal). Shut down what you booted when the task ends (`xcrun simctl shutdown <udid>`). Only one sub-agent at a time uses the simulators.
- **No AI attribution.** Commits and PRs never credit an AI tool: no `Co-authored-by:` trailer for Claude, Codex, ChatGPT or Copilot, and no "Generated with …" line. The founder is the only author. `.githooks/commit-msg` strips them; enable it once per clone with `git config core.hooksPath .githooks`.
