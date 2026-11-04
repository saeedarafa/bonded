# Security reviewer status
Updated: 2026-11-04 · Branch: security/SEC-01-offer-clocks-review · Milestone: M2/M4

## Resume here
- Recovery 2026-11-04: clean tree on security/SEC-01-offer-clocks-review; fetch/status/log/pull completed. Read all open authored PR comments including reviews/inline for security handoffs; no new actionable feedback. #89 main-integration request already addressed by6446b4e. Main remains6f8b851.
- Branch: security/SEC-01-offer-clocks-review; checkpoint is commit containing this file. Status only; uncommitted none after commit/push. Prior verdicts retained below.
- Rechecked #91 e7c98cb→8237117: backend status plus removal of cosmetic SQL EOF blank line only. Seven checks green41897645849. #97 17b6c47→2dee13c: backend status only; seven green41897432169. Prior source verdicts stand. #90 b927f706 unchanged; #83 eede10f green, waiting on lead.
- Exact next step: focused guidance source review of new #100 BE-14/D21 at ad8845d67658e3d2d006ba1a6a9c48925703c932 (seven green41900229881): weekly recap premium/reveal aggregation and Sunday push claims. Create one security SEC-01 branch from latest origin/main, preserve prior handoff. #100 is based on main; migrations through230000 are unmerged ordering dependencies, not branch ancestors. Inspect current source before acceptance. No target execution.
- Re-run: `git fetch origin`; `git status`; `git log -5 --oneline`; `git pull --ff-only`; `gh pr list --author @me`; `gh pr view 99 --comments`; `gh pr view 98 --comments`; `gh pr view 96 --comments`; `gh pr view 89 --comments`; `gh pr view 100 --comments`; `gh pr view 100 --json headRefOid,statusCheckRollup`; `git diff --check origin/main...origin/be/BE-14-weekly-recap`; `gh run list --branch main --limit 5`.
- Transport fallback: `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' <command>`. Disable repository hooks per commit; never run target code without all security-audit controls. No AI attribution, main merges or reviewed-branch rebases.
- Validation boundary unchanged: cannot enforce network isolation, empty allowlisted env, read-only source/toolchain, scratch-only writes and resource limits together. Source review and reported CI only; runtime races/devices/provider configuration remain owner/QA evidence. SEC-02 blocked on all P0; SEC-03 depends on SEC-02. Migration order #83/200000 → #90/210000 → #91/220000 → #97/230000 → #100/240000. Lead decides D28 local-day3 timing and integrates status PRs #99/#98/#96/#89.

## Doing
- New #100 BE-14 source review next; existing focused verdicts await lead integration and D28 timing confirmation.

## Done (since last update)
- #97 verdict: https://github.com/saeedarafa/bonded/pull/97#issuecomment-6639977724 ; status-only PR #99. #91 verdict: https://github.com/saeedarafa/bonded/pull/91#issuecomment-6639944674 ; handoff #98.
- #97 BE-17/D28 focused source review at 17b6c47d137506df7c7bb1bfe136f1065d95301b (89930dc→17b6c47 status-only). No new confirmed vulnerability established. Auth-only wrapper supplies server time; active couple derived from identity, parent locked and membership rechecked. Two current members and no active/unexpired current-member entitlement required. The couple/kind primary key and existing-row return preserve the original expiry; no client insert/update/delete, and select RLS uses active membership. Private clock seam denied to anon/auth/service. No price/entitlement/answer/logging mutation. Unsupported/null kind starts no clock; ended/former/other-couple reads denied; cascade retained.
- #97 regression source inspected: shared partner expiry, exact expiry/no restart, DST real 86400-second lifetime, local day3 and midnight continuation, premium activation/expiration suppression, invalid kinds, outsider/anon/unpaired/former/ended denial, private helper/client writes and cascade. Static permission/flow checks passed; whitespace passed. Owner reports 46 focused fixtures and isolated HTTP partner races; no reviewer execution. Lead still needs to confirm day3 interpretation; RevenueCat owns prices/purchase/trial eligibility. CI41896464658 was running at last check.
- #91 BE-11/D18 focused source review at e7c98cbe; acceptance limited to inspected source and CI evidence. See Resume here for controls and validation limits.
- BE-34/D39 focused source sign-off posted at b927f706; current-head seven CI jobs green. See Resume here for verdict and limits.
- Preserved main SEC-08 review evidence: #80 auth/body bounds/UUID canonical subscriber/grace/lifetime rules, service-only ledger/dedupe/order/transfer and current-partner dispatch; #75 distinct dev DB credential, trusted psql/CA and deployment scope remain external gates. Prior #79 hold is superseded by #87 as recorded below.
- #87 fixes the #79 hold: reviewed TOKEN_MUTATION and all-mutation dehydration exclusion at the actual provider, buster v1→v2, memory-only pending invite/name and screen-only signed avatar; no query-cache write of preview data. Reviewed J2 routing/error handoff, existing D37 confirmation and focused real-client persistence fixtures. Paused dummy mutation appears under default dehydration and disappears with app options; focused fixture persists while offline. Seven required PR CI jobs green, product/test paths identical on merged main. Whitespace passed. Logical cache discard does not establish physical erasure/backups. Optional improvement: seed v1 paused fixture and verify restore discards it.
- #79 was merged before the source hold was seen; lead acknowledged on #87 and requested this verification. #87 resolves the source hold; device checks remain. No issue severity or demonstrated cross-app disclosure claimed.
- Final checkpoint: #89/#82 feedback empty (including reviews/inline). Main aaef349 CI 41848724817 succeeded. BE-34 #90 now open for focused SEC-01 review; QA-13 absent. #80 status-only delta, existing functions failure remains; #81/#75 unchanged green. All work committed/pushed.
- #82 had no comments/reviews/inline feedback. #75/#80/#81 had no new review requests or inline comments; previously posted verdicts stand. #57 remains open. Rechecked latest backlog/contracts/team requests.
- #80 BE-18 source acceptance preserved from 16f08ca to `9cec996d07a61f46c7a3bcf041c17127d5bd43c6`: entire delta is backend status only. Current run still fails old QA functions assertion; other jobs running. #81 unchanged `12e7423`, seven green; lead's QA companion merge plan remains necessary. Do not waive failing #80 CI.
- #75 unchanged `c5cacad627e0c1dd2d3e2f510ea78d94aff319da`, seven green. Revised dev DB/psql source acceptance supersedes old PAT hold: exact dev host/user/port/database, allowlisted child env, verify-full/system or public CA trust, credentials off argv/output, no shell, catalogue-only D33/transaction/replay rules. Verdict: https://github.com/saeedarafa/bonded/pull/75#issuecomment-6631443420 . Workflow/deployed credential gate separate.
- Prior accepted reviews retained: #80 https://github.com/saeedarafa/bonded/pull/80#issuecomment-6631417763 and #81 https://github.com/saeedarafa/bonded/pull/81#issuecomment-6631418301 . Secret before body/admin, canonical paid/grace state, denied clients, ledger dedupe/order, atomic transfer and capped current-partner premium push. Provider configuration/concurrent upstream snapshots remain external evidence.
- Earlier pairing/approval/nudge/reminder/avatar acceptance remains recorded in history (`adc8d92`, `01c7a01`); #64/#69 merged with unchanged reviewed implementation. These focused reviews never complete SEC-02.

## Next
- Monitor #97/#91/#90 relevant deltas/CI/integration and status handoffs #98/#96/#89; QA-13 workflow when available.
- Full SEC-02 after all P0 prerequisites, then dependent SEC-03.

## Blocked
- #99/#98/#96/#89 await lead integration; no new feedback. #91/#97 latest CI green, implementation unchanged apart from cosmetic EOF cleanup. #100 source review available.
- SEC-02: all P0 incomplete, including BE-11/MOB-19/MOB-24; SEC-03 depends on SEC-02.
- Required audit sandbox unavailable; no independent runtime/native/hosted validation.
- #80: provider secret/project/store environment/identity-transfer settings, deployed grants, concurrent upstream snapshots, purchase/restore/transfer and real push delivery require owner/QA evidence. Missing Vault/notify or uncertain push may lose delivery; never replay uncertain delivery.
- QA-13: actual workflow not available. Before credential exposure require main-only trusted checkout, protected bonded-dev environment restricted to main, successful matching dev migration, serialization/stale-SHA rejection, trusted psql/CA, secret only in loader step. Owner verifies distinct dev password and catalogue replay/rollback, no production probe.
- Runtime gaps remain: #57 real overlapping PostgreSQL approvals/PostgREST HTTP-400 persistence, shared push caps/retries, gateway provenance, API/Storage parity, Vault/pg_net/cron ACLs, Realtime DELETE UUID-only, actual signed URL/cache expiry, physical-device share-sheet redaction/native email callbacks/cache/backup/logs. Requested <=60-second signing TTL does not prove a bound measured from revocation for delayed in-flight signing.

## Needs from
- lead: #97 offer boundary source gate cleared at 17b6c47; confirm D28 local-day3 timing and require green integration CI. #91 focused source gate cleared at e7c98cbe; seven CI jobs green; owner handles cosmetic trailing blank line. Merge status-only handoffs; #90 source gate cleared at b927f706 with seven green jobs. Preserve migration order 190000 → 200000 → 210000 and green integration. #87/#75 source gates remain cleared; workflow/device gates separate.
- mobile/release/qa: #79 source hold resolved by #87. Dummy-account dev-build scheme/HTTPS cold/warm and device storage/log/backup/share-sheet checks remain. Do not equate mocked native services with device evidence.
- backend/qa: send actual QA-13/BE-34 diffs for focused review; preserve accepted backend invariants. Tighten #57 concurrent loser assertion and provide approved isolated runtime evidence.
- PO: dev-only credential/provider configuration evidence without secrets. No production probe.

## Contract changes in flight
- #80 additive service-only apply_revenuecat_event; #81 companion assertions only.
- #75 deployment credential instructions, no app API/schema change; QA-13 separate.
- #83 additive own-only onboarding answers; #91 authenticated streak saver and eligibility; #97 shared immutable offer clocks source accepted; local-day3 timing awaits lead confirmation. These are not a full privacy audit.
- #87 no API shape change; mutation persistence excluded, old cache invalidated.

## Questions for the product owner
- none
