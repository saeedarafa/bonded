# Security reviewer status
Updated: 2026-11-03 · Branch: security/SEC-04-approval-race · Milestone: M2

## Resume here
- Session: 2026-11-03; dedicated clone `/Users/saeedarafa/dev/codex-security/bonded` only. Reconstructed newer handoff from `origin/security/SEC-05-nudge-abuse` at `a75d6e9`; do not revert to the stale SEC-04 handoff at 17e07cd.
- Branch: `security/SEC-04-approval-race`, from fetched `origin/main` `b30573f`. Review checkpoint `3377eee`, handoff `497c519`, final commit is `git log -1`. Status PR #63: https://github.com/saeedarafa/bonded/pull/63 . Status only, no product source changed.
- Completed source review: SEC-04/SEC-01 focused BE-30/#60 fix verification at `0bd48460c120ff86eaa94f5caf5ef090c215dbe8` (implementation `6f5f16f`). No new confirmed vulnerability; source sign-off granted for stale-approval expiry/accounting. Verdict posted: https://github.com/saeedarafa/bonded/pull/60#issuecomment-6609323220 . Review checkpoint `3377eee`; final handoff is this commit (`git log -1`).
- Exact next step: focused lead-requested BE-19/#64 reminder review, then BE-20b/#69 anonymous avatar exchange review (SEC-01 continuation). Use a separate status branch/PR per task from fetched origin/main. #60 approval SQL/regression source is unchanged through 62c26b4; all seven required checks pass. #55 merged. QA still owns strict #57 concurrent-approval acceptance. SEC-02 waits on all P0; SEC-03 depends on SEC-02.
- Commands to re-run: `git status`; `git log -5 --oneline`; `gh pr view 60 --comments`; `gh pr view 60 --json headRefOid,mergeable,statusCheckRollup`; `gh pr view 55 --comments`; `gh issue view 57`; source-only `git diff --check origin/main...origin/be/BE-30-approval-race`. Fetch first using the per-command credential workaround below.
- Uncommitted work: none after this commit; push checkpoints with `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push`. No target tests executed: the required OS-enforced security-audit sandbox is unavailable. Do not repeat historical unsandboxed test commands or touch any shared/local/hosted Supabase stack.

## Doing
- BE-30 focused source verification complete; queued lead-requested BE-19/#64 and BE-20b/#69 focused reviews.

## Done (since last update)
- Resume confirmation: fetched origin/main 299eb75 and pulled this branch fast-forward (already current); clean worktree. Open authored PRs #63/#60/#64/#69 checked, including comments; #63 has no review requests/comments. #60 changed to 62c26b4 after main integration; approval migration and regression have no diff from 0bd4846. All seven required checks pass in run 41696463154, PR mergeable. #55 merged with its stored-body assertion intact on main. #57 remains open. New lead review requests: #64 service-only reminder scheduling/Vault/claims/caps; #69 capability avatar signing. No target execution or hosted probes.
- Read required charter/role/team/database/security-audit skills and mobile companion. Fetched, checked clean worktree/log, pulled both handoff branches fast-forward, reviewed open authored PR comments (#60/#55/#62) and prior #52 (merged, no comments). Re-ran old/new handoff's Git/PR/issue source checks; #41 is integrated via #54, MOB-32 via #56, D37 via #58.
- BE-30/#60: reviewed new migration `20261103160000_approval_race_expiry.sql`, compared replacement functions with 140000, traced public wrappers/private grants, resolver, failure accounting, table privileges and regression source. `git diff --check origin/main...origin/be/BE-30-approval-race` passed.
- #60 requester-bypass question: public `accept_invite(text,text)` supplies only three arguments, so approved-invite defaults null. Only inviter-authorized `approve_join` supplies the stored request's exact invite id, after locking the request/checking pending/deadline. Private four-argument completion and clock seam are revoked from public/anon/authenticated/service_role. Requesters have SELECT only on join_requests and cannot select the bypass or rewrite its invite/requester/status. Invalid/revoked/used-code guesses, wrong tokens and ordinary typed stale-state failures remain counted; limiter, three-live-request cap and invite-lifetime decline remain intact. Revoking a requester's own invite does not revoke the target invite. Existing failure rows are never removed by uncounted expiry. A cooperating inviter invalidating its own invite is within that inviter's authority, not evidence of arbitrary guess bypass.
- #60 stale approved resolution/id mismatch and post-lock used/revoked/missing/full/ended/expired target return HTTP 400 JOIN_REQUEST_EXPIRED without a new failure. Approval restores inviter identity, marks that request expired, and returns the body so state commits. Already-decided retry cannot count again. Deadline expiry still counts once; decline helper unchanged. Losing paths precede solo archival and membership insertion. Actor -> sorted couples -> invite lock order, token capability path, success writes and hardened search paths preserved.
- #60 regression source covers six deterministic interleavings: competing approval before resolution/before couple locks, token winner, revocation, target ended and expiry. It asserts HTTP body/status, request/decision timestamp, four existing failures retained, restored inviter, no losing membership, solo retained, winner retained, retry and ordinary typed failure accounting. These are single-connection PGlite seams, not real PostgreSQL concurrency proof. Backend reports 56/56 race checks and 19 suites passing; not reviewer execution.
- Independently inspected #60 CI run 41671019852 at 0bd4846: all seven required checks succeeded, including db-tests/db-reset/functions. Existing QA contract accepts either losing code; green CI does not establish the stricter #57 acceptance yet.
- BE-10/#53 merged at 5072d08 with all seven checks green (run 41667798157). The main-merge added reviewed BE-26 migrations/fixtures; nudge implementation unchanged. Prior focused source sign-off at 9f20655: https://github.com/saeedarafa/bonded/pull/53#issuecomment-6608386387 . One accepted nudge per sender/couple-local date plus recipient-local one-nudge/four-total-push caps; recipient controls quiet hours/preferences. Calendar caps are not rolling 24-hour cooldowns.
- #55/#50: prior a75d6e9 review verified privileged stored-body reread fixes vacuous UPDATE result assertion, with no policy changes. Run 41667343335 at bff7d65 now has all seven checks green; Final fetch: backend resolved main merge at 046468c; PR is now mergeable. The stored-body assertion has no delta from bff7d65. Check refreshed CI before lead integration. Backend mutation proof is owner-reported, not reviewer reproduction.
- Carried pairing verification at a75d6e9: integrated BE-26/MOB-32 preserves pending-only typed join, inviter-only name <=30 chars before approval, three-request cap, persistent decline, correct parsing/navigation, SELECT-only request access and invite-id pinning. Prior SEC-01 pair-period/reveal/archive/limiter/helper fixes survive reviewed integration. Prior SEC-04 sign-off: https://github.com/saeedarafa/bonded/pull/41#issuecomment-6607270890 . BE-28/#46 previously signed off at e876172. This is partial source coverage only.

- Final fetch: main advanced to `29eb343` through MOB-10b/#62. Focused nudge activation source check: typed zero-argument send_nudge RPC, no client-supplied recipient/couple/time/payload, success/NUDGE_LIMIT display marker and normal error refresh. No backend authorization change or new confirmed security finding in this delta. `git diff --check b30573f..origin/main` passed. UI/native rendering not exercised; this does not expand to a full mobile audit. #60 head remained 0bd4846; status PR #63 is mergeable and had no comments.

## Next
- Check status PR and #60 replies, then re-review security/product deltas if backend updates it; preserve sign-off for unchanged code, require green combined CI.
- Follow QA's strict #57 race regression. Review new #64 reminder and #69 avatar surfaces; preserve #60-before-#64-before-#69 migration ordering for automatic dev deployment.
- Full SEC-02 workflow when all P0 candidate is ready, then dependent SEC-03.

## Blocked
- SEC-02: all P0 prerequisites unfinished; no release acceptance claim.
- Runtime: no configured sandbox provides network isolation, empty allowlisted environment, read-only target/toolchain, scratch-only writes and all resource limits. Owner/QA must supply approved isolated dummy-account multi-session pairing/crossing-approval and nudge/answer/unpair/cap evidence, and PostgREST HTTP-400 persistence.
- Hosted: gateway header provenance (SEC-01 F3), API/Storage parity, Vault/pg_net/cron installation and Realtime DELETE UUID-only delivery (SEC-04 N4) cannot be established from source. BE-27 needs named dev. No live/shared-service probes.
- #38 closed after #47; physical-device share-sheet log/redaction remains unverified. Simulator output does not confirm a device leak.

## Needs from
- backend: retain #60 auth/accounting/expiry invariants on main merge; retain green combined CI after integration. #55 merged. No new product fix requested by this review.
- qa: tighten #57 concurrent loser to JOIN_REQUEST_EXPIRED, expired row and unchanged attempts; validate on approved isolated environment. Keep real concurrency, HTTP-400, Realtime/device checks distinct from PGlite evidence.
- lead: #60 focused source review clears the security gate at 0bd4846; retain QA strict regression/integration gates. Full SEC-02 still waits on all P0.
- mobile: preserve pending/name-before-approval; retain physical-device PRIV-04/#38 checks. BE-10 is merged; backend remains authority for nudge quotas.

## Contract changes in flight
- BE-30/#60: stale approved invite expires request uncounted with HTTP 400 JOIN_REQUEST_EXPIRED; deadline expiry still counts. No RPC shape change. Source sign-off at 0bd4846.

## Questions for the product owner
- none
