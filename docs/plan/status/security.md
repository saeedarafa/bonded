# Security reviewer status
Updated: 2026-11-04 · Branch: security/SEC-07-dev-content-review · Milestone: M3

## Resume here
- Work only in `/Users/saeedarafa/dev/bonded-security`. Fetched first; folder initially had old SEC-05 checked out. Recovered requested SEC-06 from origin, advanced through main without rebase, pushed SEC-06 checkpoint `1e0e48e`. #70 is merged. SEC-07 is the separate #75 review task; merged origin/main through `4e7885f` without rebase. Status PR #77: https://github.com/saeedarafa/bonded/pull/77 . Current checkpoint = commit containing this handoff (`git log -1`). Only security status differs from main.
- Completed #69 integration review at `4f4d4c39e0a862f6bb1231ff7bc0c93408e95a25`: source sign-off preserved, CI 41713248011 all seven required jobs green; Supabase Preview skipped. #69 subsequently merged at `6c465cf`; avatar migration/handler unchanged on main. Refreshed verdict: https://github.com/saeedarafa/bonded/pull/69#issuecomment-6630507101 . #64 also merged; reminder migration/handler unchanged from accepted `9e9cabc`, CI 41711377428 seven green.
- Completed focused #75 review at `c03ad8df80d0d3a1baeb0e36bd868f3ab4bb88ad`; loader/runbook/regression source unchanged at newer `c283babbd78a8a14713a852848e65e3f83bfdf0b`. No confirmed exploitable vulnerability. Credential/deployment sign-off withheld: make dev-only credential scope mandatory, verify scope metadata without exposing secrets, review eventual QA-13 workflow. Verdict: https://github.com/saeedarafa/bonded/pull/75#issuecomment-6630535203 . Old c03 CI 41711117008 seven green; current c283 CI 41828917333 failed all seven jobs with no steps, PR conflicts with main. GitHub annotation confirms account payments/spending limit prevented job startup; PO must resolve Billing & plans. Do not carry old green CI to current head.
- Exact next step: check #75 owner response/new head; re-review credential/runbook delta and fresh combined CI after main integration. Current Supabase official docs support project-scoped PATs: accept bonded-dev only + Database read-write + explicit expiry, no organization/all-project/Legacy/browser-login fallback. A token prefix or fixed script ref does not prove actual scope. If this cannot be configured, select a dev-only DB credential. QA-13 workflow review and owner scope/hosted replay evidence remain pending. Re-check open PRs for BE-18; none at final inventory (open product PRs #75/#76). Lead also queues BE-34/D39 expired-invite first-name disclosure for security review when open. When it opens review webhook auth, replay/out-of-order/concurrent/transfer handling, expiry, partner premium pushes, and denial of client entitlement writes/forgery; post a head-pinned verdict.
- Commands: `git status`; `git log -5 --oneline`; `gh pr list --state open --json number,title,headRefName,headRefOid`; `gh pr view 75 --comments`; `gh pr view 75 --json headRefOid,mergeable,statusCheckRollup`; source-only `git diff --check origin/main...origin/be/BE-32-dev-content`. Fetch/push: `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' ...`.
- Watch out: guidance mode, no full audit artifacts/SEC-02 completion. Required OS sandbox is unavailable (network isolation, empty allowlisted environment, read-only target/toolchain, scratch-only writes, resource limits). No target tests, shared-stack/hosted probes, device pushes or production access. Disable repository hooks per command for commits; no AI attribution. Latest dev/prod clarification is in PO_ANSWERS/ACCOUNTS; never use production.

## Doing
- #75 source pass complete; waiting for backend changes, CI/integration and QA-13 workflow/configuration evidence.
- BE-18 review queued when its PR opens; no current implementation sign-off. Lead also requests BE-34/D39 review when open.

## Done (since last update)
- #70/#64 integration and #69 main-merge/source equality independently checked. Posted refreshed #69 sign-off with CI evidence. SEC-06 checkpoint pushed, then switched to this dedicated SEC-07 task branch in the same folder.
- #75: traced ref/argument validation, fixed HTTPS destination, rejected redirects, fixed CLI errors, forced D33 exclusion, transactional timeouts/advisory lock and catalogue-only shared SQL generator. Inspected regression source for destination-before-HTTP, missing credentials, redaction, no users, D33 and replay equality. Whitespace checks passed. Current-head CI failure was inspected, not rerun; no target-controlled code executed.
- Corrected the credential assumption using current primary docs: https://supabase.com/docs/guides/platform/personal-access-tokens and https://supabase.com/changelog/scoped-personal-access-tokens-ga . Project-scoped PATs exist; Legacy PATs retain account authority. Requested mandatory exact dev project/Database read-write/expiry, no broad fallback, and owner-recorded scope metadata. No actual secret/configuration inspected and no production breach asserted.
- Prior accepted review records: #64 reminders https://github.com/saeedarafa/bonded/pull/64#issuecomment-6612720590 ; #69 avatar https://github.com/saeedarafa/bonded/pull/69#issuecomment-6612756120 ; #60 approval https://github.com/saeedarafa/bonded/pull/60#issuecomment-6609323220 ; #53 nudge https://github.com/saeedarafa/bonded/pull/53#issuecomment-6608386387 ; #41 pairing https://github.com/saeedarafa/bonded/pull/41#issuecomment-6607270890 . Earlier detailed traces retained in history at `01c7a01`. These focused checks do not complete SEC-02/SEC-03.

## Next
- Backend #75 mandatory credential policy and data-driven count assertions requested by lead; main integration and fresh CI. Review only the changed source and relevant dependencies.
- QA-13 actual workflow: main-only trusted checkout, bonded-dev environment/secret restrictions, successful matching dev migration prerequisite, serial loading/stale-run suppression. Do not expose Database write credential to PR code/unrelated steps.
- BE-18 when open; full SEC-02 only after all P0 prerequisites, then SEC-03.

## Blocked
- GitHub Actions billing/spending limit prevents job startup. Independently read check-run 126570717439 annotation on #75; #77 run 41829422438 likewise failed before steps. No retries requested. Owner must resolve Billing & plans, then obtain fresh green checks; merge remains lead-only.
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
