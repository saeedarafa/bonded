# Security reviewer status
Updated: 2026-11-03 · Branch: security/SEC-01-avatar-review · Milestone: M3

## Resume here
- Dedicated clone: `/Users/saeedarafa/dev/codex-security/bonded`. Branch `security/SEC-01-avatar-review`, based on fetched origin/main `299eb75`; final checkpoint is `git log -1`. Status only; no product edits.
- Completed: BE-20b/#69 SEC-01 focused source review at `26afa86c9d13f72aa296f433b8e27617a4cc0232` (implementation unchanged from 485e094); source sign-off, no new confirmed vulnerability. BE-19/#64 source sign-off at 9e9cabc: https://github.com/saeedarafa/bonded/pull/64#issuecomment-6612720590 . Guidance mode, not SEC-02. Prior checkpoint 87783f5 / status PR #70; this handoff carries those results.
- Exact next step: check authored status PRs #63/#70 and this branch PR plus #60/#64/#69 for replies/product changes. Both queued reviews are complete; await lead/backend integration and fresh combined CI, re-review only relevant changes. #69 run 41698008591 was in progress at review; recheck checks. #60 approval SQL unchanged through 62c26b4, seven required checks green; #55 merged. QA owns strict #57 real-stack assertion. Preserve #60 -> #64 -> #69 migration order. If no new request/delta, SEC-02 waits on all P0 and SEC-03 on SEC-02; do not invent completion or run unsafe tests.
- Commands to re-run: `git status`; `git log -5 --oneline`; `gh pr list --author @me`; `gh pr view 64 --comments`; `gh pr view 64 --json headRefOid,mergeable,statusCheckRollup`; `gh pr view 60 --comments`; `gh pr view 69 --comments`; `gh pr view 69 --json headRefOid,mergeable,statusCheckRollup`; `gh issue view 57`; `git diff --check origin/main...origin/be/BE-20b-invite-avatar`.
- Fetch/pull/push: `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' <command>`. Initial default fetch updated refs despite credential-helper warnings; subsequent fast-forward pull succeeded. No uncommitted work after final checkpoint; push this branch.
- No target-controlled tests executed: the required OS-enforced sandbox is unavailable (network isolation, empty allowlisted environment, read-only target/toolchain, scratch-only writes, all resource limits). Do not repeat historical unsandboxed tests or touch shared Supabase. Commits disable repository hooks to avoid executing target code; attribution manually excluded.

## Doing
- #64 and #69 focused source reviews complete; awaiting integration/CI and owner runtime evidence.

## Done (since last update)
- #69 BE-20b/D06: capability-shaped token plus invite-bound hash resolver, live solo inviter checks, service-only wrapper and revoked private clock, canonical inviter avatar lookup, unchanged private bucket/RLS, outward four-field allowlist, stream byte limit, server clock and <=60-second requested TTL; no caller path/TTL/time or profile URL accepted. Minimal first name/progress/expiry; no answer text, logging or cache. SQL/Deno regression source inspected; whitespace check passed. No new confirmed vulnerability. Lease is not immediate revocation: delayed in-flight signing does not prove an absolute <=60 seconds after revocation; actual Storage expiry/cache behavior remains unverified. Posted verdict on #69; retrieve with gh pr view 69 --comments.
- #64 verdict posted and checkpoint pushed 87783f5; status PR #70. New fetch kept main at 299eb75, #69 advanced from 485e094 to 26afa86 with backend-status-only delta.
- Read charter, role, team/database/security-audit skills, validation guidance and mobile companion. Clean worktree, fetch/log/status/pull completed. Checked authored PRs #63/#60/#64/#69 and prior #55; #63 has no comments/review requests. Approval checkpoint pushed to #63 as `a86cc97`.
- #60 BE-30: no approval migration/regression diff from source-reviewed `0bd4846` to merged head `62c26b4`; all seven required CI checks green in run 41696463154, mergeable. Prior verdict: https://github.com/saeedarafa/bonded/pull/60#issuecomment-6609323220 . Requester cannot set approved-invite bypass/clock or mutate requests; only inviter-authorized approval supplies pinned invite id. Stale target expires request uncounted, prior failures retained; deadline still counts. QA #57 remains open, strict loser assertion still pending.
- #55 BE-29 merged 2026-11-03; non-vacuous stored-answer assertion intact on main.
- #64 BE-19: service-only due_reminders, RLS/client-denied reminder ledger, dispatcher revoked from every API role, hardened search paths, bound Vault values, fail-closed Edge secret and server clock; source-only sign-off. Same recipient lock and private claim helper enforce shared four/day cap, reminder per-type/date dedupe and persistent unknown-outcome claims. Possible dropped reminders are explicitly documented, including a partially delivered batch; no claim release/retry duplicates. Recipient preferences/quiet hours, bounded partner name and static copy, no answer/message text. Inspected SQL/Deno regression source and CI run 41675474034 (seven required checks green). Diff whitespace check passed. Runtime/hosted behavior unverified.
- Prior focused pairing/approval/nudge source checkpoints and limits: `a75d6e9`, `3377eee`, `a86cc97`; prior status PR #63. BE-10/#53 merged with source acceptance at 9f20655; MOB-10b/#62 activation source checked. BE-26/#41 integrated via #54, MOB-32 via #56, D37 via #58; pending-only typed join and inviter-name/cap/decline controls reviewed. These focused checks do not complete SEC-02.

## Next
- Monitor #69 source acceptance/CI and #64 reminder acceptance through integration; both focused reviews complete.
- After main integration, preserve source sign-off for unchanged implementation and inspect fresh combined CI; re-review relevant product deltas.
- Full SEC-02 only when all P0 prerequisites are ready, then dependent SEC-03.

## Blocked
- SEC-02: all-P0 prerequisites incomplete (including BE-11/MOB-19/MOB-24); SEC-03 depends on SEC-02. No full audit/release acceptance claimed.
- Runtime sandbox unavailable as above. Owner/QA must supply isolated dummy-account real concurrency, PostgREST HTTP-400 persistence and shared cap/retry evidence. PGlite deterministic seams do not prove concurrency.
- Hosted: gateway provenance (SEC-01 F3), API/Storage parity, protected Vault/pg_net/cron, Realtime DELETE UUID-only delivery (SEC-04 N4), and native email/share-sheet behavior unverified. New named dev identity is recorded by lead/backend; this role made no hosted calls. #38 physical-device PRIV-04 remains unverified despite simulator fix/closed issue.

## Needs from
- backend: retain #60 -> #64 -> #69 migration order, merge main without rebase and refresh CI. Update #64 runbook's stale unknown-dev sentence. No security source fix requested in #64/#69; hosted rollout/config/ACL and actual signed-URL expiry evidence remain owner work. Do not promise immediate URL revocation or a wall-clock bound measured from revocation.
- qa: tighten #57 concurrent loser to JOIN_REQUEST_EXPIRED, expired row and unchanged attempts; validate real overlap/HTTP-400 persistence in approved isolation. Exercise reminders alongside event/nudge pushes under shared caps.
- lead: #60 source acceptance preserved through 62c26b4; #64 source acceptance at 9e9cabc, pending combined CI/integration and deployment gates. #69 source acceptance at 26afa86; require green combined CI and inspect relevant deltas. Full SEC-02 waits on all P0.
- mobile/release: retain physical-device PRIV-04 and native email callback checks; do not infer device privacy from simulator output.

## Contract changes in flight
- #60 stale approved-invite expiry/accounting, no RPC shape change.
- #64 service-only due_reminders and persistent reminder claims; weekly recap remains BE-14. Dropped claims are deliberate at-most-once tradeoff.
- #69 anonymous capability avatar preview source accepted at 26afa86; requested TTL <=60 seconds, actual Storage behavior pending owner validation.

## Questions for the product owner
- none
