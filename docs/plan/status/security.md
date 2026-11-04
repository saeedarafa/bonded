# Security reviewer status
Updated: 2026-11-04 · Branch: security/SEC-06-reminder-review · Milestone: M3

## Resume here
- Session: 2026-11-04; only `/Users/saeedarafa/dev/bonded-security`. Fetched first; recovered requested `security/SEC-06-reminder-review` from origin (folder was on older SEC-05). Fast-forwarded to origin/main `78490f0`; no rebase. #70 has merged. Checkpoint is the commit containing this handoff (`git log -1`); status only.
- Finished SEC-06 integration check: #64 merged, reminder SQL/handler unchanged from accepted `9e9cabc`. #69 at `4f4d4c39e0a862f6bb1231ff7bc0c93408e95a25` has main integrated; avatar migration, handler/tests and SQL regressions byte-identical to accepted `26afa86`. Wrapper allowlist/test commands preserve both changes. Current-head CI run 41713248011 has all seven required jobs green; Supabase Preview skipped. Refreshed verdict posted on #69 (2026-11-04). Guidance only; no new confirmed finding.
- Exact next step: focused review of #75 at `c03ad8d` (BE-32) in its own task branch. Lead requests credential-scope review and data-driven test counts. Current Supabase official docs now support project-scoped PATs, so do not repeat the claim that every PAT is account-wide. Require an explicit bonded-dev-only credential, no Legacy PAT fallback, and owner evidence of selected scope without exposing secrets. Review loader SQL/redaction/workflow trust boundaries. BE-18 has no open PR at initial inventory; re-check after #75 and review webhook auth/idempotency/client entitlement denial when it opens.
- Commands: `git status`; `git log -5 --oneline`; `gh pr view 69 --json headRefOid,mergeable,statusCheckRollup`; `gh pr view 75 --comments`; `gh pr list --state open`; source-only `git diff --check`. Fetch/push use `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' ...`.
- Validation: source/CI inspection only. No compliant OS sandbox for target execution (network isolation, allowlisted empty environment, read-only target/toolchain, scratch-only writes and resource limits). No target tests, shared services, device pushes or production access. Git hooks disabled per command to avoid target-controlled execution; no AI attribution.

## Doing
- #64 integrated; #69 refreshed source verdict and combined CI complete. #75 credential review next; owner runtime evidence remains pending.

## Done (since last update)
- 2026-11-04: recovered local handoff, checked #70 feedback/merge and #64 integration; refreshed #69 verdict at `4f4d4c3` with independently inspected 7/7 combined CI (41713248011). No avatar/reminder implementation changes. No product edits.
- Addressed lead comments on #70/#71: consolidated both review records into #70, merged main `467f15f` without rebase and resolved only own status file. Preserved newer main approval acceptance alongside reminder/avatar source verdicts; #71 superseded. No product edits.
- Rechecked authored PR discussions and inline review comments (#60/#63/#64/#69/#70/#71). #64/#69 unchanged, each seven required CI checks green, both conflicting with main. #60/#63 merged; accepted approval SQL identical on main. #57 remains open. Diff whitespace checks passed for reminder/avatar branches. Reviewed updated backlog, contract changes and team needs; no new unblocked SEC task.
- #69 BE-20b/D06: capability-shaped token plus invite-bound hash resolver, live solo inviter checks, service-only wrapper and revoked private clock, canonical inviter avatar lookup, unchanged private bucket/RLS, outward four-field allowlist, stream byte limit, server clock and <=60-second requested TTL; no caller path/TTL/time or profile URL accepted. Minimal first name/progress/expiry; no answer text, logging or cache. SQL/Deno regression source inspected; whitespace check passed. No new confirmed vulnerability. Lease is not immediate revocation: delayed in-flight signing does not prove an absolute <=60 seconds after revocation; actual Storage expiry/cache behavior remains unverified. Posted verdict: https://github.com/saeedarafa/bonded/pull/69#issuecomment-6612756120 .
- Final checks: fetched main still 299eb75; #69 head still 26afa86, CI plan/sync/functions passed, app/db-tests/db-reset pending. No inline review comments on #60/#63/#64/#69/#70/#71; no new #64/#70 discussion replies. Status PR #71 carries the latest cumulative handoff. No uncommitted files after checkpoint.
- #64 verdict posted and checkpoint pushed 87783f5; status PR #70. New fetch kept main at 299eb75, #69 advanced from 485e094 to 26afa86 with backend-status-only delta.
- Read charter, role, team/database/security-audit skills, validation guidance and mobile companion. Clean worktree, fetch/log/status/pull completed. Checked authored PRs #63/#60/#64/#69 and prior #55; #63 has no comments/review requests. Approval checkpoint pushed to #63 as `a86cc97`.
- #60 BE-30: no approval migration/regression diff from source-reviewed `0bd4846` to merged head `62c26b4`; all seven required CI checks green in run 41696463154, mergeable. Prior verdict: https://github.com/saeedarafa/bonded/pull/60#issuecomment-6609323220 . Requester cannot set approved-invite bypass/clock or mutate requests; only inviter-authorized approval supplies pinned invite id. Stale target expires request uncounted, prior failures retained; deadline still counts. QA #57 remains open, strict loser assertion still pending.
- #55 BE-29 merged 2026-11-03; non-vacuous stored-answer assertion intact on main.
- #64 BE-19: service-only due_reminders, RLS/client-denied reminder ledger, dispatcher revoked from every API role, hardened search paths, bound Vault values, fail-closed Edge secret and server clock; source-only sign-off. Same recipient lock and private claim helper enforce shared four/day cap, reminder per-type/date dedupe and persistent unknown-outcome claims. Possible dropped reminders are explicitly documented, including a partially delivered batch; no claim release/retry duplicates. Recipient preferences/quiet hours, bounded partner name and static copy, no answer/message text. Inspected SQL/Deno regression source and CI run 41675474034 (seven required checks green). Diff whitespace check passed. Runtime/hosted behavior unverified.
- Prior focused pairing/approval/nudge source checkpoints and limits: `a75d6e9`, `3377eee`, `a86cc97`; prior status PR #63. BE-10/#53 merged with source acceptance at 9f20655; MOB-10b/#62 activation source checked. BE-26/#41 integrated via #54, MOB-32 via #56, D37 via #58; pending-only typed join and inviter-name/cap/decline controls reviewed. These focused checks do not complete SEC-02.

## Next
- Monitor #64 then #69 integration; both focused reviews complete and pre-integration CI is green. #70 consolidates the cumulative security handoff; #71 superseded.
- After main integration, preserve source sign-off for unchanged implementation and inspect fresh combined CI; re-review relevant product deltas.
- Full SEC-02 only when all P0 prerequisites are ready, then dependent SEC-03.

## Blocked
- SEC-02: all-P0 prerequisites incomplete (including BE-11/MOB-19/MOB-24); SEC-03 depends on SEC-02. No full audit/release acceptance claimed.
- Runtime sandbox unavailable as above. Owner/QA must supply isolated dummy-account real concurrency, PostgREST HTTP-400 persistence and shared cap/retry evidence. PGlite deterministic seams do not prove concurrency.
- Hosted: gateway provenance (SEC-01 F3), API/Storage parity, protected Vault/pg_net/cron, Realtime DELETE UUID-only delivery (SEC-04 N4), and native email/share-sheet behavior unverified. New named dev identity is recorded by lead/backend; this role made no hosted calls. #38 physical-device PRIV-04 remains unverified despite simulator fix/closed issue.

## Needs from
- backend: #60 is merged; merge main without rebase into #64, refresh CI, then #69 after #64 integration. Update #64 runbook's stale unknown-dev sentence. No security source fix requested in #64/#69; hosted rollout/config/ACL and actual signed-URL expiry evidence remain owner work. Do not promise immediate URL revocation or a wall-clock bound measured from revocation.
- qa: tighten #57 concurrent loser to JOIN_REQUEST_EXPIRED, expired row and unchanged attempts; validate real overlap/HTTP-400 persistence in approved isolation. Exercise reminders alongside event/nudge pushes under shared caps.
- lead: #60 source acceptance preserved through 62c26b4; #64 source acceptance at 9e9cabc, pending combined CI/integration and deployment gates. #69 source acceptance at 26afa86; require green combined CI and inspect relevant deltas. Full SEC-02 waits on all P0.
- mobile/release: retain physical-device PRIV-04 and native email callback checks; do not infer device privacy from simulator output.

## Contract changes in flight
- #60 stale approved-invite expiry/accounting, no RPC shape change.
- #64 service-only due_reminders and persistent reminder claims; weekly recap remains BE-14. Dropped claims are deliberate at-most-once tradeoff.
- #69 anonymous capability avatar preview source accepted at 26afa86; requested TTL <=60 seconds, actual Storage behavior pending owner validation.

## Questions for the product owner
- none
