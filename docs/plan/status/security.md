# Security reviewer status
Updated: 2026-11-04 · Branch: security/SEC-08-revenuecat-review · Milestone: M4

## Resume here
- Work only in `/Users/saeedarafa/dev/bonded-security`. Fetched first, verified clean SEC-07 checkpoint adc8d92, #77 merged. Advanced through main without rebase and created this dedicated SEC-08 branch. Latest main integrated: `60564eb`. Status-only PR #82: https://github.com/saeedarafa/bonded/pull/82 . Current checkpoint = commit containing this handoff (`git log -1`); no product source changed.
- #80 source sign-off at `16f08ca3d579c71d31935042b6c22ea41abd10d1`, backend identical to reviewed 8e4874e. Verdict: https://github.com/saeedarafa/bonded/pull/80#issuecomment-6631417763 . Auth before body/admin, canonical provider state/grace, denied client writes, ledger dedupe/equal-or-older ordering, atomic transfer and capped partner-premium dispatch reviewed. No new confirmed exploit; guidance only.
- #81 accepted at `12e742326283b5a5d532582d48fa2258ca72520a`, identical backend plus QA assertions/status only. Verdict: https://github.com/saeedarafa/bonded/pull/81#issuecomment-6631418301 . CI 41834008885 all seven required jobs green. #80 at 16f08ca/run 41834738381 retains known stale QA functions assertion failure; lead combines #81 per companion pattern, then fresh combined CI/review relevant deltas. Do not waive the failure.
- #75 revised dev DB URL/psql source sign-off at `c5cacad627e0c1dd2d3e2f510ea78d94aff319da`: https://github.com/saeedarafa/bonded/pull/75#issuecomment-6631443420 . Supersedes PAT-design hold. Exact dev host/user/port/database restrictions, minimal child environment, verify-full/system or public CA trust, no shell/credential argv/output, D33/transaction and CSV-derived replay tests reviewed. CI 41830450898 seven green. QA-13 workflow, distinct dev credential and hosted acceptance still pending.
- #79 sign-off withheld at `875f2753bf052130968d8033bb8f73bac9c6dd12`: https://github.com/saeedarafa/bonded/pull/79#issuecomment-6631517796 . Retained J3 useInvitePreview accepts token variables, default online network mode can pause offline, default dehydration includes paused mutations, DataProvider/persister serializes them. gcTime:0 does not prevent this. Existing J2 TOKEN_MUTATION is correct. Requested TOKEN_MUTATION on preview or explicit sensitive-mutation exclusion, real QueryClient/offline/persister regression, and consideration of previously stored entries. Source-grounded privacy/contract issue needing validation, no demonstrated cross-app disclosure/confirmed exploit/severity. CI 41831928712 seven green lacks this case.
- Exact next step: check #79 mobile fix/owner evidence and re-review offline token dehydration/persistence with dummy fixtures. Check #80/#81 companion integration and fresh required CI, carrying sign-off only for unchanged backend. Review QA-13 actual workflow before credential exposure. BE-34/D39 expired-name capability review when open; no open BE-34/QA-13 at latest inventory. #78 has no outstanding security request in inspected lead discussion.
- Commands: `git status`; `git log -5 --oneline`; `gh pr list --state open --json number,title,headRefName,headRefOid`; `gh pr view 79 --comments`; `gh pr view 80 --json headRefOid,mergeable,statusCheckRollup`; same for 81/75/82; source-only `git diff --check origin/main...origin/be/BE-18-revenuecat`. Fetch/push via `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' ...`.
- Watch out: no compliant OS sandbox (network isolation, empty allowlisted environment, read-only target/toolchain, scratch-only writes and resource limits). No target tests/native/hosted/prod access performed; source plus existing CI only. Hooks disabled per commit; no AI attribution. Guidance mode, not SEC-02/release acceptance. Historical Actions billing blocker resolved; jobs now start again.

## Doing
- All available requested source reviews/verdicts posted; #79 fix verification pending.
- #80/#81 integration CI and QA-13 configuration/workflow review remain owner tasks.

## Done (since last update)
- Fetched, read charter/role/handoff, checked unchanged loaded team/database/security/edge skills against main and team requests/contracts. #77 merged; #69/#64 prior source acceptances remain recorded.
- #80/#81: traced auth and fixed digest comparison, body bounds, fixed UUID subscriber lookup, canonical paid/grace/lifetime expiry, service-only wrapper/private ledger, transaction lock/rollback/dedupe/order, transfer and current-partner dispatch. Reviewed SQL/Deno fixture source and existing combined CI; no target execution. Provider settings/upstream consistency remain external evidence.
- #75: reviewed the replacement credential design, removing obsolete PAT requirements. Distinct dev DB credential is required; parser cannot prove password separation. PATH/psql/CA remain trusted deployment inputs. Existing CI seven green; future workflow separately reviewed.
- #79: reviewed POST-only capability transport, five-second timeout/SQL fallback/error behavior, typed null avatar, no explicit signed-URL query/store/log write and in-memory mutations. Found retained offline token-preview persistence concern and posted smallest fix/regression plan. Native image cache/logs are unverified; mocked tests do not establish their absence.
- Source whitespace checks passed for backend, loader, avatar and QA companion diffs. CI checked independently: #75 41830450898, #79 41831928712, #81 41834008885 seven green. #80 41834738381 known QA functions failure. Historical billing failure is no longer current.
- Previous accepted traces/limitations retained in history at adc8d92 and 01c7a01, including pairing/approval/nudge/reminder/private-avatar server reviews. Focused sign-offs never imply SEC-02/SEC-03 completion.

## Next
- #79 mobile fixes/evidence and main conflict integration; require green combined CI on resulting head.
- Lead/QA #80 + #81 integration with unchanged signed-off backend and green combined CI; then dev-only rollout evidence.
- QA-13 workflow, BE-34/D39 when open. Full SEC-02 after all P0 prerequisites, then SEC-03.

## Blocked
- #79 token-persistence contract concern: no compliant execution sandbox to independently run the offline regression. Source plus documented TanStack defaults establish the path to check; no cross-app reader/observed disclosure claimed. Owner/QA uses real QueryClient/persister + dummy capability, forces offline, flushes storage while mounted/after navigation/restart and verifies no token in dehydration/stored cache; restore connectivity in cleanup.
- #80 provider account/webhook secret/project/store environment/identity-transfer configuration, deployed grants, upstream concurrent snapshot consistency, sandbox purchase/restore/transfer and actual push delivery require owner evidence on bonded-dev. Missing Vault/notify or uncertain push can lose delivery without losing entitlement; do not replay uncertain pushes.
- QA-13 workflow unreviewed: main-only trusted checkout, bonded-dev environment restricted to main, successful matching dev migration prerequisite, serial/stale-run controls, trusted psql/CA, credential exposure only to loader. Owner must verify distinct dev password and catalogue-only replay/rollback; no production probe.
- SEC-02 all-P0 prerequisites incomplete (BE-11/MOB-19/MOB-24 among them), SEC-03 depends on it. No compliant runtime sandbox; no release acceptance.
- Prior runtime/hosted gaps remain: real PostgreSQL concurrency/PostgREST HTTP-400 persistence (#57), shared push caps/retries, gateway header provenance, API/Storage parity, protected Vault/pg_net/cron, Realtime DELETE UUID-only delivery, actual signed-URL/cache expiry, device share-sheet redaction/native email callback. Requested signing TTL <=60 seconds does not prove a bound measured from revocation for delayed in-flight signing.

## Needs from
- mobile: fix/validate #79 J3 token-bearing preview offline pause/dehydration path; apply existing TOKEN_MUTATION or exclude sensitive mutations, add meaningful offline persistence regression and consider stale token entries. Keep URLs/tokens out of logs/persistence; native Image cache still needs device evidence.
- backend: #80 source gate cleared at 16f08ca; #75 revised credential source gate cleared at c5cacad. Preserve invariants and notify security of relevant changes/BE-34. No new product-source fix requested in these backend scopes.
- qa/lead: combine #81 with #80 using agreed pattern, preserve backend source and obtain green combined CI. #79 needs mobile fix before security sign-off. QA-13 workflow review before dev DB secret exposure. Current billing runs again.
- PO: configure only bonded-dev credentials/RevenueCat webhook and REST secrets; distinct dev DB password through protected environment. Supply non-secret configuration/fixture evidence only, no production tests.
- release/qa: real device/native cache/log/share-sheet and store sandbox/restore/partner-premium checks with dummy accounts, approved dev only. Do not equate CI source/mocks with device/hosted evidence.

## Contract changes in flight
- #80 additive service-only apply_revenuecat_event and canonical/grace/transfer/premium-push semantics. #81 QA companion only.
- #75 deployment credential instructions revised, no app API/schema change. QA-13 workflow separate.
- #79 client signed-avatar consumer; privacy persistence concern pending.

## Questions for the product owner
- none
