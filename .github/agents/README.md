# Security Reviewer setup

The [Security Reviewer agent](./security-reviewer.agent.md) uses Cloudflare's
[security-audit skill](../skills/security-audit/SKILL.md), installed locally for
this workspace. No global agent configuration was changed.

## Usage

Select **Security Reviewer** from the VS Code chat agent picker, then provide
the target and scope. For example:

> Review the authentication implementation for authorization vulnerabilities.
> Use guidance mode and return findings in chat.

For a complete audit:

> Perform a full security audit of this project's application source. Follow the
> security-audit workflow, use its default external report directory, and report
> any unavailable sandbox or independent-verification capabilities.

The skill is also discoverable separately as `security-audit`. If the agent does
not appear after installation, reload the VS Code window and check that workspace
custom agents are enabled and the workspace is trusted.

## Coordination

The lead can delegate to this custom agent where supported. For a separate worker
session, select this agent in that session. Merely naming a session "Security
Reviewer" does not activate the custom agent or its tool configuration.

The reviewer does not change application source. Developer agents implement fixes;
the reviewer checks the fixed revision. Execution and editing tools are needed
for trusted validators and audit outputs, so this is not a tool-enforced read-only
or sandboxed agent.

## Requirements and limitations

- Node.js for the bundled zero-dependency validators.
- Parallel delegation for the full audit's independent hunters and verifiers.
- An OS-enforced sandbox satisfying the skill's requirements before executing
  target-controlled code. Without it, execution-dependent leads remain
  `needs_validation`.
- Actual application source to review; installing this configuration does not
  audit the design handoff or certify an iOS/Android release.

## Upstream and maintenance

- Source: https://github.com/cloudflare/security-audit-skill
- Installed revision: `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8`
- License: [MIT, Cloudflare, Inc.](../skills/security-audit/LICENSE)

The upstream skill, companion documents, schema, validators, and validator tests
are copied without modification. The MIT license is retained alongside them.
Each downloaded file was checked against its Git blob hash at the pinned revision.
The custom agent and this usage guide are local integration files.

To update, review a newer upstream revision, replace the upstream files together,
preserve the license, record the new revision here, and rerun both validator test
suites. The files are vendored, not managed by a successful Skills CLI install.

# Bonded team agents

Five role agents work with the Security Reviewer. The charter, ownership map and workflow are in [`AGENTS.md`](../../AGENTS.md); the shared protocol is the [`bonded-team-protocol`](../skills/bonded-team-protocol/SKILL.md) skill.

| Agent (picker name) | File | Project skills it loads |
|---|---|---|
| Lead Architect | [lead-architect.agent.md](./lead-architect.agent.md) | bonded-team-protocol, bonded-release-check |
| Mobile Developer | [mobile-developer.agent.md](./mobile-developer.agent.md) | bonded-team-protocol, bonded-screen-build, bonded-test-automation |
| Backend Data Developer | [backend-data-developer.agent.md](./backend-data-developer.agent.md) | bonded-team-protocol, bonded-db-change, bonded-edge-function, bonded-test-automation |
| QA Automation Engineer | [qa-automation.agent.md](./qa-automation.agent.md) | bonded-team-protocol, bonded-test-automation |
| Release Validator | [release-validator.agent.md](./release-validator.agent.md) | bonded-team-protocol, bonded-release-check, bonded-screen-build |
| Security Reviewer | [security-reviewer.agent.md](./security-reviewer.agent.md) | security-audit |

**Claude Code and Codex:** `node scripts/agents/sync.mjs` generates Claude sub-agent wrappers in `.claude/agents/`, and skill copies in `.claude/skills/` (Claude) and `.agents/skills/` (Codex). Codex has no agent files; it takes roles through `AGENTS.md`. Edit only `.github/`.

**Running them in parallel:** open one session per agent, each in its own git worktree (`git worktree add ../bonded-<role> -b <role>/<TASK-ID>-<slug> main`). Start each session with: "You are the <agent>. Follow AGENTS.md and pick up your next task."
