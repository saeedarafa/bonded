# Security reviewer status
Updated: 2026-11-04 · Branch: security/SEC-07-dev-content-review · Milestone: M3

## Resume here
- Session 2026-11-04; work only in `/Users/saeedarafa/dev/bonded-security`. Fetched first, clean prior SEC-07 checkpoint `adc8d92`; #77 merged. Advanced through origin/main `0cf8d71` without rebase. New task branch `security/SEC-08-revenuecat-review`; checkpoint = commit containing this handoff (`git log -1`). Status only; no product edits.
- Completed #80 focused source sign-off at `16f08ca3d579c71d31935042b6c22ea41abd10d1`; backend SQL/functions/types unchanged from `8e4874e`. Auth before body/admin, fixed canonical RevenueCat lookup, grace expiry, service-only writes, ledger dedupe/equal-or-older ordering, atomic transfers and partner-premium dispatch reviewed. Verdict posted on #80. No new confirmed vulnerability; guidance only, not SEC-02.
- #81 at `12e742326283b5a5d532582d48fa2258ca72520a`: backend identical; QA-only companion preserves 401 checks, expects 400 BAD_REQUEST after valid auth with empty body and 200 for TEST without REST/admin credentials. Comment posted. Independently inspected run 41834008885: all seven required jobs green. #80 current run 41834738381 has known old QA function assertion failure; combine #81 per lead, do not waive required CI.
- Completed #75 fix verification at `c5cacad627e0c1dd2d3e2f510ea78d94aff319da`: source sign-off granted for dev DB URL/psql design, superseding the earlier PAT hold. Reviewed exact host/user/port/database restrictions, explicit child environment, verify-full/system or public CA trust, no shell/credential argv/log output, D33/transaction and CSV-derived replay tests. CI 41830450898 seven green. Verdict: https://github.com/saeedarafa/bonded/pull/75#issuecomment-6631434170 . QA-13 actual workflow/credential configuration and hosted replay remain pending.
- Exact next step: finish #79 signed-avatar client privacy review and post verdict. Then check fresh #80/#81 integration/CI, preserve sign-off only for unchanged backend, and write final handoff. BE-34/D39 has no open PR yet; review when it opens.
- Commands: `git status`; `git log -5 --oneline`; `gh pr list --state open --json number,title,headRefName,headRefOid`; `gh pr view 80 --json headRefOid,mergeable,statusCheckRollup`; `gh pr view 81 --json headRefOid,statusCheckRollup`; `gh pr view 75 --comments`; source-only `git diff --check origin/main...origin/be/BE-18-revenuecat`. Fetch/push via `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' ...`.
- Watch out: no compliant OS sandbox (network isolation, empty allowlisted environment, read-only target/toolchain, scratch-only writes and resource limits); no reviewer target tests/hosted/production access. Source and existing CI inspection only. Commit hooks disabled per command; no AI attribution. GitHub Actions now runs again; historical billing blocker no longer current.

## Doing
- #75 source pass complete; waiting for backend changes, CI/integration and QA-13 workflow/configuration evidence.
- BE-18 review queued when its PR opens; no current implementation sign-off. Lead also requests BE-34/D39 review when open.

## Done (since last update)
- #75 revised dev DB credential source gate cleared at c5cacad, replacing the obsolete PAT-design hold. Hosted/configuration/workflow acceptance remains pending.
- SEC-08 #80/#81 source verdicts posted as above; auth/forgery/ordering/transfer/grace/push boundary reviewed, #81 seven required CI checks independently inspected. No target execution.
- #70/#64 integration and #69 main-merge/source equality independently checked. Posted refreshed #69 sign-off with CI evidence. SEC-06 checkpoint pushed, then switched to this dedicated SEC-07 task branch in the same folder.
- #75: traced ref/argument validation, fixed HTTPS destination, rejected redirects, fixed CLI errors, forced D33 exclusion, transactional timeouts/advisory lock and catalogue-only shared SQL generator. Inspected regression source for destination-before-HTTP, missing credentials, redaction, no users, D33 and replay equality. Whitespace checks passed. Current-head CI failure was inspected, not rerun; no target-controlled code executed.
- Corrected the credential assumption using current primary docs: https://supabase.com/docs/guides/platform/personal-access-tokens and https://supabase.com/changelog/scoped-personal-access-tokens-ga . Project-scoped PATs exist; Legacy PATs retain account authority. Requested mandatory exact dev project/Database read-write/expiry, no broad fallback, and owner-recorded scope metadata. No actual secret/configuration inspected and no production breach asserted.
- Prior accepted review records: #64 reminders https://github.com/saeedarafa/bonded/pull/64#issuecomment-6612720590 ; #69 avatar https://github.com/saeedarafa/bonded/pull/69#issuecomment-6612756120 ; #60 approval https://github.com/saeedarafa/bonded/pull/60#issuecomment-6609323220 ; #53 nudge https://github.com/saeedarafa/bonded/pull/53#issuecomment-6608386387 ; #41 pairing https://github.com/saeedarafa/bonded/pull/41#issuecomment-6607270890 . Earlier detailed traces retained in history at `01c7a01`. These focused checks do not complete SEC-02/SEC-03.

## Next
- Backend #75 mandatory credential policy and data-driven count assertions requested by lead; main integration and fresh CI. Review only the changed source and relevant dependencies.
- QA-13 actual workflow: main-only trusted checkout, bonded-dev environment/secret restrictions, successful matching dev migration prerequisite, serial loading/stale-run suppression. Do not expose Database write credential to PR code/unrelated steps.
- BE-18 when open; full SEC-02 only after all P0 prerequisites, then SEC-03.

## Blocked
- Historical Actions billing blocker resolved: new #75/#81 CI runs start and are green. #80 still requires its QA companion and fresh combined CI.
- #75 credential scope is deployment-dependent and unverified; source ref guard cannot limit a stolen account-wide token. Hosted transaction/replay and environment branch restrictions need owner evidence. No secret values or production probes requested.
- SEC-02 all-P0 prerequisites incomplete (including BE-11/MOB-19/MOB-24); SEC-03 depends on SEC-02. No release acceptance.
- No compliant runtime sandbox. Owner/QA evidence needed for isolated real multi-session races, PostgREST HTTP-400 persistence, reminder/nudge/event shared caps and unknown-outcome retries. PGlite single-connection scheduling does not prove concurrent behavior. QA #57 strict loser assertion remains pending.
- Hosted gateway header provenance (SEC-01 F3), API/Storage parity, protected Vault/pg_net/cron and Realtime DELETE UUID-only delivery (SEC-04 N4) unverified. #69 requested TTL <=60 seconds does not prove <=60 seconds measured from revocation for delayed in-flight signing; actual Storage expiry/cache remains owner validation. #38 device share-sheet redaction and native email callbacks remain unverified.

## Needs from
- backend: address #75 credential policy, record non-secret scope evidence, preserve redaction/D33/catalogue-only invariants; integrate main, retain all suites and refresh CI. Notify security when BE-18 opens. No product fix requested in accepted #64/#69 scope.
- qa: QA-13 workflow for security review before credential exposure; #57 strict concurrent loser = JOIN_REQUEST_EXPIRED, expired row, unchanged attempts in approved isolation. Exercise shared recipient caps/retries; hosted replay only with test data and approved dev identity.
- lead: #69 source sign-off preserved through main `6c465cf`; #75 verdict pending runbook/configuration/workflow gates, current c283 CI failed before job steps. Scoped PATs are supported; no need to assume every PAT is account-wide. SEC-02 still blocked on all P0.
- PO: supply only a dev-scoped credential through the protected environment and record selected resource/permissions/expiry without token values. No production test needed.
- mobile/release: MOB-35 must keep tokens/signed URLs out of persistence/logs and retain fallback; device PRIV-04/native email checks still required.

## Contract changes in flight
- #75 no API/schema change; credential/deployment instructions pending. QA workflow is a separate owner task.
- #69 anonymous capability preview and #64 service-only reminders are merged/source accepted. TTL and at-most-once dropped-reminder tradeoffs remain as previously documented.

## Questions for the product owner
- none
