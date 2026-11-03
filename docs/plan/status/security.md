# Security reviewer status
Updated: 2026-11-03 · Branch: security/SEC-04-approval-race · Milestone: M2

## Resume here
- Session: 2026-11-03; dedicated clone `/Users/saeedarafa/dev/codex-security/bonded` only. Reconstructed newer handoff from `origin/security/SEC-05-nudge-abuse` at `a75d6e9`; do not revert to the stale SEC-04 handoff at 17e07cd.
- Branch: `security/SEC-04-approval-race`, from latest fetched `origin/main` `b30573f`. This commit is the review checkpoint (`git log -1`); status only, no product source changed.
- Completed source review: SEC-04/SEC-01 focused BE-30/#60 fix verification at `0bd48460c120ff86eaa94f5caf5ef090c215dbe8` (implementation `6f5f16f`). No new confirmed vulnerability; source sign-off granted for stale-approval expiry/accounting. Post the prepared verdict on #60 next, then record its link here and open the status PR.
- Exact next step: finish #60 review handoff, then inspect remaining open reviews and any new security-relevant changes. QA must tighten its owned concurrent-approval assertion (#57). #55/#50 still waits on backend main-merge/status-conflict resolution and lead integration. SEC-02 full pre-RC audit waits on all P0, including BE-11/MOB-19/MOB-24; SEC-03 depends on SEC-02. Do not label focused verification as completion of either task.
- Commands to re-run: `git status`; `git log -5 --oneline`; `gh pr view 60 --comments`; `gh pr view 60 --json headRefOid,mergeable,statusCheckRollup`; `gh pr view 55 --comments`; `gh issue view 57`; source-only `git diff --check origin/main...origin/be/BE-30-approval-race`. Fetch first using the per-command credential workaround below.
- Uncommitted work: none after this commit; push checkpoints with `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push`. No target tests executed: the required OS-enforced security-audit sandbox is unavailable. Do not repeat historical unsandboxed test commands or touch any shared/local/hosted Supabase stack.

## Doing
- Finalize BE-30/#60 focused review handoff; no product fix requested.

## Done (since last update)
- Read required charter/role/team/database/security-audit skills and mobile companion. Fetched, checked clean worktree/log, pulled both handoff branches fast-forward, reviewed open authored PR comments (#60/#55/#62) and prior #52 (merged, no comments). Re-ran old/new handoff's Git/PR/issue source checks; #41 is integrated via #54, MOB-32 via #56, D37 via #58.
- BE-30/#60: reviewed new migration `20261103160000_approval_race_expiry.sql`, compared replacement functions with 140000, traced public wrappers/private grants, resolver, failure accounting, table privileges and regression source. `git diff --check origin/main...origin/be/BE-30-approval-race` passed.
- #60 requester-bypass question: public `accept_invite(text,text)` supplies only three arguments, so approved-invite defaults null. Only inviter-authorized `approve_join` supplies the stored request's exact invite id, after locking the request/checking pending/deadline. Private four-argument completion and clock seam are revoked from public/anon/authenticated/service_role. Requesters have SELECT only on join_requests and cannot select the bypass or rewrite its invite/requester/status. Invalid/revoked/used-code guesses, wrong tokens and ordinary typed stale-state failures remain counted; limiter, three-live-request cap and invite-lifetime decline remain intact. Revoking a requester's own invite does not revoke the target invite. Existing failure rows are never removed by uncounted expiry. A cooperating inviter invalidating its own invite is within that inviter's authority, not evidence of arbitrary guess bypass.
- #60 stale approved resolution/id mismatch and post-lock used/revoked/missing/full/ended/expired target return HTTP 400 JOIN_REQUEST_EXPIRED without a new failure. Approval restores inviter identity, marks that request expired, and returns the body so state commits. Already-decided retry cannot count again. Deadline expiry still counts once; decline helper unchanged. Losing paths precede solo archival and membership insertion. Actor -> sorted couples -> invite lock order, token capability path, success writes and hardened search paths preserved.
- #60 regression source covers six deterministic interleavings: competing approval before resolution/before couple locks, token winner, revocation, target ended and expiry. It asserts HTTP body/status, request/decision timestamp, four existing failures retained, restored inviter, no losing membership, solo retained, winner retained, retry and ordinary typed failure accounting. These are single-connection PGlite seams, not real PostgreSQL concurrency proof. Backend reports 56/56 race checks and 19 suites passing; not reviewer execution.
- Independently inspected #60 CI run 41671019852 at 0bd4846: all seven required checks succeeded, including db-tests/db-reset/functions. Existing QA contract accepts either losing code; green CI does not establish the stricter #57 acceptance yet.
- BE-10/#53 merged at 5072d08 with all seven checks green (run 41667798157). The main-merge added reviewed BE-26 migrations/fixtures; nudge implementation unchanged. Prior focused source sign-off at 9f20655: https://github.com/saeedarafa/bonded/pull/53#issuecomment-6608386387 . One accepted nudge per sender/couple-local date plus recipient-local one-nudge/four-total-push caps; recipient controls quiet hours/preferences. Calendar caps are not rolling 24-hour cooldowns.
- #55/#50: prior a75d6e9 review verified privileged stored-body reread fixes vacuous UPDATE result assertion, with no policy changes. Run 41667343335 at bff7d65 now has all seven checks green; PR currently conflicts after #53 due to backend status. Owner must resolve. Backend mutation proof is owner-reported, not reviewer reproduction.
- Carried pairing verification at a75d6e9: integrated BE-26/MOB-32 preserves pending-only typed join, inviter-only name <=30 chars before approval, three-request cap, persistent decline, correct parsing/navigation, SELECT-only request access and invite-id pinning. Prior SEC-01 pair-period/reveal/archive/limiter/helper fixes survive reviewed integration. Prior SEC-04 sign-off: https://github.com/saeedarafa/bonded/pull/41#issuecomment-6607270890 . BE-28/#46 previously signed off at e876172. This is partial source coverage only.

## Next
- #60 review comment/status PR, then re-review security/product deltas if backend updates it; preserve sign-off for unchanged code, require green combined CI.
- Follow QA's strict #57 race regression and backend #55 integration. Check MOB-10b/#62 activation against reviewed nudge boundary if product/security changes.
- Full SEC-02 workflow when all P0 candidate is ready, then dependent SEC-03.

## Blocked
- SEC-02: all P0 prerequisites unfinished; no release acceptance claim.
- Runtime: no configured sandbox provides network isolation, empty allowlisted environment, read-only target/toolchain, scratch-only writes and all resource limits. Owner/QA must supply approved isolated dummy-account multi-session pairing/crossing-approval and nudge/answer/unpair/cap evidence, and PostgREST HTTP-400 persistence.
- Hosted: gateway header provenance (SEC-01 F3), API/Storage parity, Vault/pg_net/cron installation and Realtime DELETE UUID-only delivery (SEC-04 N4) cannot be established from source. BE-27 needs named dev. No live/shared-service probes.
- #38 closed after #47; physical-device share-sheet log/redaction remains unverified. Simulator output does not confirm a device leak.

## Needs from
- backend: retain #60 auth/accounting/expiry invariants on main merge; resolve #55 status-only conflict and push green combined CI. No new product fix requested by this review.
- qa: tighten #57 concurrent loser to JOIN_REQUEST_EXPIRED, expired row and unchanged attempts; validate on approved isolated environment. Keep real concurrency, HTTP-400, Realtime/device checks distinct from PGlite evidence.
- lead: #60 focused source review clears the security gate at 0bd4846; retain QA strict regression/integration gates. Full SEC-02 still waits on all P0.
- mobile: preserve pending/name-before-approval; retain physical-device PRIV-04/#38 checks. BE-10 is merged; backend remains authority for nudge quotas.

## Contract changes in flight
- BE-30/#60: stale approved invite expires request uncounted with HTTP 400 JOIN_REQUEST_EXPIRED; deadline expiry still counts. No RPC shape change. Source sign-off at 0bd4846.

## Questions for the product owner
- none
