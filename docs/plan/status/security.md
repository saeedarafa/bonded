# Security reviewer status
Updated: 2026-11-03 · Branch: security/SEC-01-pairing-recheck · Milestone: M1

## Resume here
- Session: 2026-11-03; dedicated clone `/Users/saeedarafa/dev/codex-security/bonded` only.
- Branch + last commit: `security/SEC-01-pairing-recheck` from latest `origin/main` at `c006553`; this status commit records the completed source review (resolve with `git log -1`). SEC-04 checkpoint: `security/SEC-04-typed-code-review` @ `fa838e6`, PR #49: https://github.com/saeedarafa/bonded/pull/49 . Merge #49 before this status PR to retain the review sequence.
- Uncommitted work: none after this commit; push the task branch. Git credential helper stalled; per-command `git -c credential.helper= -c 'credential.helper=!gh auth git-credential'` succeeds without exposing credentials.
- Exact next step: re-check PR #41 after backend pushes F1/F2 fixes. Last observed head: `e9c6994a9da75a866f5107e4c5589e69d4d3f204`; D02 sign-off withheld. Resume SEC-04 on its own branch, preserving the newer SEC-01 disposition below when updating status. Backend/QA should resolve regression-evidence issue #50. SEC-02 full pre-RC audit is blocked on all P0; SEC-03 depends on SEC-02.
- Commands to re-run: `gh pr view 41 --comments`; `gh pr diff 41`; `gh pr view 41 --json headRefOid,statusCheckRollup`; `gh issue view 50`; source-only `git diff --check origin/main...origin/be/BE-26-typed-code-approval`. Backend/QA safe validation plan: run reveal-rule, hardening, ended-couples, invite-link and contract regressions in their approved isolated environment, plus two-session limiter/crossing-pair races and HTTP-400 persistence. Reviewer has not run them.
- Watch out for: original handoff is on `origin/security/SEC-04-typed-code` at `115b065`, not main. Do not repeat its unsandboxed test commands. No target-controlled test execution without every security-audit sandbox control. No shared/local/hosted Supabase stack was touched. Historical SEC-02 label in comments includes focused fixes; it is not completion of the full BACKLOG SEC-02 audit.

## Doing
- SEC-04: waiting for F1/F2 fixes; source-only re-check at `e9c6994` complete. This push changed no migrations, join-request tests or contracts; verdict unchanged and posted on #41.

## Done (since last update)
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
- SEC-04 re-review on each new #41 head observed during the session.
- Follow #50 and approved-environment evidence for SEC-01 fixes; source re-check is complete.
- SEC-02 full audit when all P0 prerequisites are complete, then BACKLOG SEC-03 fix verification.

## Blocked
- #41 D02 source sign-off: F1 and F2 remain at `e9c6994`.
- Runtime validation: no configured OS-enforced sandbox providing all skill controls. Backend/QA must supply approved-environment regression evidence; PostgREST/concurrency/Realtime integration remain separate validation items.
- Source cannot establish gateway header provenance, hosted API/Storage parity, cron installation or Realtime DELETE delivery. No production or shared-service checks authorized/performed. Issue #38 is closed after #47, but the physical-device log/redaction check remains unverified; do not treat simulator observations as a confirmed device leak.

## Needs from
- backend: #41 F1 inviter-only, pending/open-invite-only, trimmed <=30-character requester first name; F2 decline sticks per invite and bounded pending capacity with retry/expiry/token regressions. N1-N3 optional. Fix #50's own-answer edit regression assertion.
- mobile: show requester name on MOB-32 approval card; retain on-device PRIV-04/#38 check after merged #47.
- lead: merge BE-26 with MOB-32/mobile breaking-contract ack; reconcile historical SEC numbering with BACKLOG. Do not treat focused review as RC/full-audit acceptance.
- qa: fix typed-immediate assumptions behind #41 db-reset failures and provide approved local-stack concurrency/HTTP-400 evidence.

## Contract changes in flight
- BE-26/#41: typed `accept_invite` returns pending object; valid token still returns couple-id string. Breaking mobile ack and D02 security sign-off outstanding.

## Questions for the product owner
- none
