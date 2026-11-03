# Security reviewer status
Updated: 2026-11-03 · Branch: security/SEC-04-fix-rereview · Milestone: M1

## Resume here
- Session: 2026-11-03; dedicated clone `/Users/saeedarafa/dev/codex-security/bonded` only.
- Branch + last commit: `security/SEC-04-fix-rereview` from latest `origin/main` at `2241253`; this status commit records SEC-04 source sign-off (resolve with `git log -1`). Prior SEC-01 checkpoint `39006a2` / PR #51 is preserved below; merge #51 before this newer status snapshot, or close #51 as superseded. Prior SEC-04 PR #49 is merged.
- Uncommitted work: none after this commit; push this status checkpoint. Per-command `git -c credential.helper= -c 'credential.helper=!gh auth git-credential'` avoids the credential-helper stall without exposing credentials.
- Exact next step: SEC-04 backend/source sign-off is granted at #41 head `0335e422f1cb3cc6650ab794ad1a61bf40e04792`. QA-10 and MOB-32/mobile ack remain merge gates. Re-review security/product changes in the combined candidate; this is not full SEC-02 or release acceptance. Backend/QA should resolve regression-evidence issue #50. SEC-02 full pre-RC audit remains blocked on all P0; SEC-03 depends on SEC-02.
- Commands to re-run: `gh pr view 41 --comments`; `gh pr diff 41`; `gh pr view 41 --json headRefOid,statusCheckRollup`; `gh issue view 50`; source-only `git diff --check origin/main...origin/be/BE-26-typed-code-approval`. Backend/QA safe validation plan: run reveal-rule, hardening, ended-couples, invite-link and contract regressions in their approved isolated environment, plus two-session limiter/crossing-pair races and HTTP-400 persistence. Reviewer has not run them.
- Watch out for: original handoff is on `origin/security/SEC-04-typed-code` at `115b065`, not main. Do not repeat its unsandboxed test commands. No target-controlled test execution without every security-audit sandbox control. No shared/local/hosted Supabase stack was touched. Historical SEC-02 label in comments includes focused fixes; it is not completion of the full BACKLOG SEC-02 audit.

## Doing
- SEC-04 fix re-review complete; verdict posted on #41. No background monitor is configured.

## Done (since last update)
- SEC-04 re-reviewed implementation `3a730c1`, checkpoint `a92db3c`, subsequent head `5d1429e` (status-only delta), and new push `0335e42` (contract clarifications and boundary tests, no product implementation change). Verdict: backend/source sign-off granted, no remaining confirmed finding in this focused re-review. https://github.com/saeedarafa/bonded/pull/41#issuecomment-6607270890 .
- F1 resolved in source: `pending_join_requests` exposes only request id, <=30-character first name and expiry to the inviter for live pending requests on their current open invite/active couple; no general profile policy or Realtime name exposure (`20261103140000_typed_code_approval_complete.sql:206-229`).
- F2 resolved in source: persistent requester/invite decline check, maximum three live pending requests under existing couple/invite locks, retry id/expiry preserved at capacity, expiry frees slots, valid token capability bypasses decline/cap (`:49,59,74-101`). New regressions cover exact 15-minute reclamation and decline through the 48-hour invite boundary.
- N1-N3 resolved in source: obsolete complete_invite dropped, inviter subject restored on approval normal/body-error/exception paths, join_requests client grants reduced to SELECT. Name/authz/cap/decline/token/identity/grant regression source reviewed.
- Source checks passed: `git diff --check e9c6994..5d1429e`, `git diff --check origin/main...5d1429e`, and `git diff --check 5d1429e..0335e42`. No target code was executed. Independently inspected CI run 41635442845 at 3a730c1: db-tests/app/functions/plan/agent-sync pass; db-reset fails. Backend reports focused 54/54 and reveal-rule 23/23 through a92db3c; not reviewer execution. Latest 0335e42 CI had not completed when checked.
- SEC-01 focused source fix verification complete at main `c00655303882cd09dd7dc9842dc3b94692d4a9f7`; no new confirmed product vulnerability in this subset. This is not the SEC-02 full audit or release readiness.
- SEC-01 F2/R1 fixed in source: paired_at/backfill and pair-period guards cover answer edits, threads, reactions and read markers (`20261102235000_pairing_hardening.sql:16-119`); BE-09 retains those guards and makes archive writes active-only (`20261102240000_ended_couples.sql:88-192`). Unread counts also require pair period + both answered (`20261103010000_history_realtime.sql:18-31`).
- SEC-01 F5/F7 fixed in source: final main accept path locks actor and both couples, re-checks membership, ends the old solo couple, marks left_at and revokes its invite (`20261102300000_solo_couple_archive.sql:19-74`). Old history remains member-only, read-only and bounded by 30 days through BE-09.
- SEC-01 F4/F8/F9 fixed in source: bounded indexed attempt query, sharded global alert, purge, serialized actor check/record and 10/hour create_invite cap survive subsequent migrations. Actual concurrent PostgreSQL and gateway persistence validation remain outstanding; the PGlite race seam uses one connection.
- SEC-01 F10/F11/F12 fixed in source: preview first name <=30 chars and avatar null (BE-20); profile/settings bounds; hardened definer paths, revoked public CREATE, private helpers not exposed by local API config. BE-28 still uses 192-bit tokens stored only as hashes, with per-invite issuance cap.
- Carried SEC-01 F1 remains on main: typed codes still pair immediately; #41 is its remediation, blocked by SEC-04 F1/F2. F3 gateway header trust remains needs_validation. F6 used-code/invalid-code distinction is documented contract behavior; no additional private payload was found in that error path.
- Filed backend regression-evidence issue #50: https://github.com/saeedarafa/bonded/issues/50 . hardening.test.mjs:89 checks rows from UPDATE without RETURNING, which does not establish that body stayed unchanged. Not a new confirmed product vulnerability.
- Synced the dedicated clone with `git fetch && git pull --ff-only`; reconstructed stale main status from historical security branches and PR #41 comments.
- Posted SEC-04 verdict on PR #41: https://github.com/saeedarafa/bonded/pull/41#issuecomment-6603599337 . Changes requested, carrying forward F1 Medium (blind approval) and F2 Low (uncapped pending requests / decline can be retried).
- Reviewed final request creation, approval/decline authorization, invite-id pinning, profile policy, client grants and regression source. `git diff --check` passed. Existing CI db-tests pass; db-reset fails; no tests were executed in this session.
- Prior SEC-03 focused BE-28 review signed off PR #46 at `e876172` (now merged). This does not complete the full-audit-dependent BACKLOG SEC-03.

## Next
- Review the combined QA-10 / MOB-32 candidate if it changes the reviewed security boundary; preserve requester-name-before-approval and pending state handling.
- Follow #50 and approved-environment evidence for SEC-01 fixes; source re-check is complete.
- SEC-02 full audit when all P0 prerequisites are complete, then BACKLOG SEC-03 fix verification.

## Blocked
- No remaining SEC-04 backend source blocker at 0335e42. QA-10, MOB-32/mobile breaking-response ack and green combined CI remain integration/merge gates.
- Runtime validation: no configured OS-enforced sandbox providing all skill controls. Backend/QA must supply approved-environment regression evidence; PostgREST/concurrency/Realtime integration remain separate validation items.
- Source cannot establish gateway header provenance, hosted API/Storage parity, cron installation or Realtime DELETE delivery. No production or shared-service checks authorized/performed. Issue #38 is closed after #47, but the physical-device log/redaction check remains unverified; do not treat simulator observations as a confirmed device leak.

## Needs from
- backend: no remaining SEC-04 source changes requested; retain approved boundaries in later pushes. Fix #50's own-answer edit regression assertion separately.
- mobile: fetch pending_join_requests and show requester name before approval on MOB-32, handle pending joins, explicitly ack breaking response; name is user-supplied recognition only. Retain on-device PRIV-04/#38 check after merged #47.
- lead: SEC-04 backend source review gate is cleared. Keep QA-10, MOB-32/mobile ack and combined CI gates; preserve this newer sign-off when resolving status #51. Do not treat focused review as RC/full-audit acceptance.
- qa: fix typed-immediate assumptions behind #41 db-reset failures and provide approved local-stack concurrency/HTTP-400 evidence.

## Contract changes in flight
- BE-26/#41: typed accept_invite returns pending object; valid token still returns couple-id string. SEC-04 backend/D02 source sign-off granted through 0335e42. Breaking mobile ack/UI and QA-10 remain outstanding.

## Questions for the product owner
- none
