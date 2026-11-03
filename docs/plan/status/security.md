# Security reviewer status
Updated: 2026-11-03 · Branch: security/SEC-05-nudge-abuse · Milestone: M2

## Resume here
- Session: 2026-11-03; dedicated worktree `/Users/saeedarafa/dev/bonded-security` only.
- Branch: `security/SEC-05-nudge-abuse` from main `47f02c0`; first checkpoint `8ee12ef`, final checkpoint is the commit containing this handoff (`git log -1`). Status only; no product source changed.
- Finished: BE-10/#53 focused abuse review at `9f20655956b29becb71d6c5865377bba0b2f78c1`, source sign-off posted: https://github.com/saeedarafa/bonded/pull/53#issuecomment-6608386387 . No confirmed abuse finding. One accepted nudge per sender/couple-local date plus independent one nudge and four total pushes per recipient-local date; recipient controls quiet hours and preferences. Calendar-day caps are not rolling 24-hour cooldowns.
- Continued the next unblocked security work: SEC-01 pairing fix verification on merged main `47f02c0`, including BE-26/MOB-32/D37, plus #50's replacement assertion in #55 at `bff7d65536b391d4cecbfa051790bf145aeb4b55`. Source checks below passed; no new confirmed finding. This is guidance/fix verification, not the SEC-02 full audit or full-audit-dependent SEC-03 completion.
- Exact next step: re-review #53 after backend merges main if product/security behavior changes; preserve sign-off for unchanged code and require green combined CI. Follow #55 integration and #57/BE-30 race fix. SEC-02 full pre-RC audit remains blocked on all P0 prerequisites, including BE-11/MOB-19/MOB-24; start its complete skill workflow only when that candidate is available. SEC-03 depends on SEC-02.
- Commands: `git status`; `git log -5 --oneline`; `gh pr view 53 --json headRefOid,mergeable,statusCheckRollup`; `gh pr view 55 --json headRefOid,statusCheckRollup`; `gh issue view 57`; source-only `git diff --check`. Git fetch/push use per-command `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' ...`.
- Watch out: source + CI inspection only. No configured OS-enforced sandbox satisfies every security-audit execution control; never repeat the old unsandboxed test commands from historical handoffs. No target tests, shared stacks, hosted endpoints or device pushes were executed. PGlite queued calls on one connection do not prove PostgreSQL multi-session races.

## Doing
- No active source-review step left in this bounded pass; integration and runtime checks below remain outstanding.

## Done (since last update)
- #53 reviewed: caller/recipient binding, private helper/ledger grants, no client clock, active couple/question locks, sender/date unique quota, retry/rollback/re-pair behavior, recipient caps under advisory lock, internal-secret auth, recipient quiet hours/preferences, payload content. Verdict posted at the link above. CI run 41661388288 independently inspected at 9f20655: all seven required jobs succeeded, including db-tests, db-reset and functions. #53 still conflicted with main when verdict was posted; backend owns resolution.
- SEC-01 F1 on main: BE-26 migrations 130000/140000 match source signed off at 0335e42 (empty file diff to main). A typed code creates a request; a valid token or inviter-approved, invite-id-pinned private path completes pairing. Pending requesters gain no membership; client grants remain SELECT-only. Declines stick for the invite lifetime, three live requests maximum, 15-minute request expiry, retry id/deadline preserved; name lookup is inviter-only and <=30 characters. Prior SEC-04 F1/F2/N1-N3 source resolutions survive integration.
- MOB-32 boundary check: `api.ts` parses typed pending separately and rejects unknown success shapes; hooks retain pending state; JoinPendingScreen waits for actual complete-couple state before navigation. JoinRequestCards displays the server-returned first name and explicitly user-supplied recognition wording before approve, submits that request id, and offers decline. Empty names get neutral copy. Realtime invalidates/refetches instead of supplying names/authorization. Reviewed route regression source for named/empty requests, pending/declined/expired/error states and Realtime invalidation. Native rendering/device behavior was not exercised.
- #50/#55: verified the attempted authenticated UPDATE targets old1, soloAns refers to that stored answer, `as()` resets role in finally, and the replacement owner-side reread asserts the original body `SOLO-1`. This removes the vacuous UPDATE-without-RETURNING assertion and preserves the separate joiner-visibility check. No policy/product changes in the PR. Backend reports mutation proof (remove only own-answer UPDATE pair-period guards: 90 pass/1 fail); reviewer did not execute or independently reproduce that mutation. Independently inspected run 41661914456 at 294a66e: all seven jobs succeeded. At newer bff7d65 after main merge, app/functions/plan/agent-sync passed; db-tests/db-reset were still running. Source diff whitespace check passed.
- Prior SEC-01 focused source fix verification at c006553: F2/R1 pair-period/reveal/archive guards; F5/F7 actor/couple locking and retained solo archive; F4/F8/F9 indexed bounded attempt accounting/alerts/purge/create-invite cap; F10/F11/F12 minimal preview/settings bounds/definer paths/private API isolation. This remains partial coverage; runtime gateway/concurrency checks remain below.
- Prior focused reviews: SEC-04 sign-off on #41 through 5352a83: https://github.com/saeedarafa/bonded/pull/41#issuecomment-6607270890 . #41 merged via #54; MOB-32 via #56; D37 via #58. Prior BE-28/#46 source sign-off at e876172 (now merged). These historical SEC-03/SEC-04 labels do not complete BACKLOG SEC-02/SEC-03.

## Next
- Backend #53 main-merge delta and combined CI; lead integrates only after green.
- #55 integration closes #50; #57/BE-30 concurrent-approval error/attempt-accounting fix verification when available.
- Approved-environment PostgreSQL, gateway, Realtime and native checks; full SEC-02 when all P0 is ready, then SEC-03.

## Blocked
- SEC-02 full audit: all P0 prerequisites unfinished; no release-candidate acceptance claim.
- Runtime validation: no configured compliant OS sandbox. Need isolated multi-session nudge/answer/unpair and recipient claim-at-cap checks, pairing/crossing-approval races, and PostgREST HTTP-400 attempt persistence. Owner/QA must supply approved-environment evidence.
- Hosted evidence: source cannot establish gateway header provenance (SEC-01 F3), API/Storage parity, Vault/pg_net/cron installation, or Realtime DELETE UUID-only delivery (SEC-04 N4). BE-27 waits on an identified dev project. No live/shared-service probes performed.
- #38 closed after #47; physical-device share-sheet log/redaction remains unverified. Do not turn simulator observations into a confirmed device leak.

## Needs from
- backend: merge main into #53, preserve reviewed caps/auth/time/payload invariants, obtain green combined CI; finish #55/#50 and #57/BE-30. No new product fix requested by this nudge review.
- mobile: preserve requester-name-before-approval and pending handling; flip NUDGE_AVAILABLE only after BE-10 integration. Retain physical-device PRIV-04/#38 verification.
- lead: #53 focused source review gate cleared at 9f20655; retain main-merge/CI and native/hosted gates. SEC-01 F1 source remediation is now integrated. Full SEC-02 still waits on all P0.
- qa: approved-environment real PostgreSQL race/cap and HTTP-400 persistence evidence; retain device push/quiet-hour and Realtime DELETE validation.

## Contract changes in flight
- BE-10/#53: send_nudge becomes live; suppressed/no-device delivery still consumes sender quota. Source sign-off at 9f20655.
- BE-26 breaking pending response, requester-name lookup, caps/decline rules and MOB-32/D37 are merged; no new contract change proposed here.

## Questions for the product owner
- none
