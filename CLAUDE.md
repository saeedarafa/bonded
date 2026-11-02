## engram

This project has an engram knowledge graph at .engram/.

Rules:
- For codebase or architecture questions, when `.engram/graph.json` exists, first run `engram query "<question>"` (or `engram path "<A>" "<B>"` / `engram explain "<concept>"`); these return a scoped subgraph, usually much smaller than `GRAPH_REPORT.md` or raw grep output
- If .engram/wiki/index.md exists, navigate it instead of reading raw files
- If .engram/graph.json is missing but graphify-out/graph.json exists, run `engram migrate-state --dry-run` first; if tracked legacy artifacts are reported, ask before using the recommended `git mv -f graphify-out .engram` and commit message
- If .engram/needs_update exists or .engram/branch.json has stale=true, warn before relying on semantic results and run /engram . --update when appropriate
- Before proposing or committing .engram artifacts, run `engram portable-check .engram`; commit-safe graph artifacts must use repo-relative paths, and never commit .engram/branch.json, .engram/worktree.json, .engram/needs_update, or .engram/cache/. If a repo already tracks any of them, first add them to .gitignore, then propose `git rm --cached .engram/branch.json .engram/worktree.json .engram/needs_update` and `git rm -r --cached .engram/cache`; never mutate git state without asking
- Before deep graph traversal, prefer `engram summary --graph .engram/graph.json` for compact first-hop orientation
- For review impact on changed files, use `engram review-delta --graph .engram/graph.json` instead of generic traversal
- Read `.engram/GRAPH_REPORT.md` only for broad architecture review or when `query` / `path` / `explain` do not surface enough context
- After modifying code files in this session, run `npx engram hook-rebuild` to keep the graph current

## Bonded team
The team charter is imported below and applies to every session. Role sub-agents are in `.claude/agents/` and skills in `.claude/skills/`; both are generated from `.github/`, so edit them there and run `node scripts/agents/sync.mjs`.

@AGENTS.md
