# Security reviewer status
Updated: 2026-11-04 · Branch: security/SEC-01-D39-review · Milestone: M2/M4

## Resume here
- Recovery 2026-11-04: clean tree; fetched, status/log checked, pulled SEC-01-token-persistence fast-forward (already current). #89 lead request to merge main already addressed by 6446b4e; currently MERGEABLE. #82 comments/reviews/inline empty. GitHub transient EOF/TLS/499 failures recovered for essential reads.
- Branch: security/SEC-01-D39-review, created from latest origin/main 6f8b851. Checkpoint = commit containing this handoff; uncommitted work none after commit/push. Status-only PR; no product edits or target execution. Prior #87 acceptance and #75/#80/#81 review records retained below.
- Completed focused SEC-01 BE-34/D39 review of #90 at b927f70630c4c9718341f8727e8759296a1d7eae. Source sign-off: https://github.com/saeedarafa/bonded/pull/90#issuecomment-6638948789 . Seven required current-head jobs green (41851696577); git diff --check passed. Matching invite-bound hash capability gates expired first-name-only details; typed/wrong accounting and private helper grants preserved; avatar seam unchanged and expiry denied. No new confirmed vulnerability; guidance mode only.
- Regression source inspected, not executed: exact/past expiry, alternate tokens, idempotence, typed/wrong accounting, saturated limiter, anon/auth wrappers/helper denial, bounded names and revoked/accepted/full/ended states. Avatar final assertion uses a full couple as well as expiry, so does not independently isolate expiry; source check is explicit. Backend-reported isolated HTTP evidence is owner evidence.
- Current integration: #80/#81/#75 MERGED; #81 seven green and main 6f8b851 CI41874739021 succeeded. #80's old standalone functions failure is superseded by companion #81 integration. #83 still open (917b560); #91 BE-11 draft (d94acde). QA-13 absent. #57 remains open. Preserve 190000 → 200000 → 210000 deployment order.
- Exact next step: check this handoff PR and #89 feedback/CI; inspect any new #90 changes before merge. Then pick next unblocked SEC task. BACKLOG has only SEC-01 guidance, SEC-02 full audit (all P0 prerequisite) and SEC-03 fix verification (SEC-02 prerequisite); SEC-02/03 remain blocked. Do not start full audit early. Await new focused review requests or prerequisite completion.
- Re-run: `git fetch origin`; `git status`; `git log -5 --oneline`; `git pull --ff-only`; `gh pr list --author @me`; `gh pr view 89 --comments`; `gh pr view 90 --comments`; `gh pr list --state open --json number,title,headRefName,headRefOid`; `gh pr view 90 --json headRefOid,statusCheckRollup`; `gh issue view 57`; `gh run list --branch main --limit 5`; `git diff --check origin/main...origin/be/BE-34-expired-invite`.
- Transport fallback: `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' <command>`. Disable repository hooks per commit. No AI attribution, no merges to main, no rebase of reviewed branches.
- Validation boundary: required OS sandbox unavailable (network isolation, empty allowlisted env, read-only target/toolchain, scratch-only writes and resource limits). No reviewer target tests/native/hosted calls. Safe validation plan: owner runs isolated dummy fixtures with these controls, verifies HTTP400 details and no details for typed/wrong tokens, then QA checks device SQL fallback without logging names/tokens. No SEC-02 or release acceptance claimed.

## Doing
- Available requested source reviews complete; integration/runtime gates remain with owners.

## Done (since last update)
- BE-34/D39 focused source sign-off posted at b927f706; current-head seven CI jobs green. See Resume here for verdict and limits.
- Preserved main SEC-08 review evidence: #80 auth/body bounds/UUID canonical subscriber/grace/lifetime rules, service-only ledger/dedupe/order/transfer and current-partner dispatch; #75 distinct dev DB credential, trusted psql/CA and deployment scope remain external gates. Prior #79 hold is superseded by #87 as recorded below.
- Initial BE-34 #90 source pass at b927f70630c4c9718341f8727e8759296a1d7eae: expiry details gated by matching hashed invite capability, bounded first name only; typed/wrong token attempts unchanged; revoked/accepted/ended/full denied; expired avatar seam unchanged. Whitespace passed. PR feedback/current CI and final verdict still pending; do not treat as sign-off.
- #87 fixes the #79 hold: reviewed TOKEN_MUTATION and all-mutation dehydration exclusion at the actual provider, buster v1→v2, memory-only pending invite/name and screen-only signed avatar; no query-cache write of preview data. Reviewed J2 routing/error handoff, existing D37 confirmation and focused real-client persistence fixtures. Paused dummy mutation appears under default dehydration and disappears with app options; focused fixture persists while offline. Seven required PR CI jobs green, product/test paths identical on merged main. Whitespace passed. Logical cache discard does not establish physical erasure/backups. Optional improvement: seed v1 paused fixture and verify restore discards it.
- #79 was merged before the source hold was seen; lead acknowledged on #87 and requested this verification. #87 resolves the source hold; device checks remain. No issue severity or demonstrated cross-app disclosure claimed.
- Final checkpoint: #89/#82 feedback empty (including reviews/inline). Main aaef349 CI 41848724817 succeeded. BE-34 #90 now open for focused SEC-01 review; QA-13 absent. #80 status-only delta, existing functions failure remains; #81/#75 unchanged green. All work committed/pushed.
- #82 had no comments/reviews/inline feedback. #75/#80/#81 had no new review requests or inline comments; previously posted verdicts stand. #57 remains open. Rechecked latest backlog/contracts/team requests.
- #80 BE-18 source acceptance preserved from 16f08ca to `9cec996d07a61f46c7a3bcf041c17127d5bd43c6`: entire delta is backend status only. Current run still fails old QA functions assertion; other jobs running. #81 unchanged `12e7423`, seven green; lead's QA companion merge plan remains necessary. Do not waive failing #80 CI.
- #75 unchanged `c5cacad627e0c1dd2d3e2f510ea78d94aff319da`, seven green. Revised dev DB/psql source acceptance supersedes old PAT hold: exact dev host/user/port/database, allowlisted child env, verify-full/system or public CA trust, credentials off argv/output, no shell, catalogue-only D33/transaction/replay rules. Verdict: https://github.com/saeedarafa/bonded/pull/75#issuecomment-6631443420 . Workflow/deployed credential gate separate.
- Prior accepted reviews retained: #80 https://github.com/saeedarafa/bonded/pull/80#issuecomment-6631417763 and #81 https://github.com/saeedarafa/bonded/pull/81#issuecomment-6631418301 . Secret before body/admin, canonical paid/grace state, denied clients, ledger dedupe/order, atomic transfer and capped current-partner premium push. Provider configuration/concurrent upstream snapshots remain external evidence.
- Earlier pairing/approval/nudge/reminder/avatar acceptance remains recorded in history (`adc8d92`, `01c7a01`); #64/#69 merged with unchanged reviewed implementation. These focused reviews never complete SEC-02.

## Next
- Monitor #90 relevant deltas/integration, this handoff and #89; QA-13 actual workflow when available.
- Full SEC-02 after all P0 prerequisites, then dependent SEC-03.

## Blocked
- SEC-02: all P0 incomplete, including BE-11/MOB-19/MOB-24; SEC-03 depends on SEC-02.
- Required audit sandbox unavailable; no independent runtime/native/hosted validation.
- #80: provider secret/project/store environment/identity-transfer settings, deployed grants, concurrent upstream snapshots, purchase/restore/transfer and real push delivery require owner/QA evidence. Missing Vault/notify or uncertain push may lose delivery; never replay uncertain delivery.
- QA-13: actual workflow not available. Before credential exposure require main-only trusted checkout, protected bonded-dev environment restricted to main, successful matching dev migration, serialization/stale-SHA rejection, trusted psql/CA, secret only in loader step. Owner verifies distinct dev password and catalogue replay/rollback, no production probe.
- Runtime gaps remain: #57 real overlapping PostgreSQL approvals/PostgREST HTTP-400 persistence, shared push caps/retries, gateway provenance, API/Storage parity, Vault/pg_net/cron ACLs, Realtime DELETE UUID-only, actual signed URL/cache expiry, physical-device share-sheet redaction/native email callbacks/cache/backup/logs. Requested <=60-second signing TTL does not prove a bound measured from revocation for delayed in-flight signing.

## Needs from
- lead: merge status-only handoffs; #90 source gate cleared at b927f706 with seven green jobs. Preserve migration order 190000 → 200000 → 210000 and green integration. #87/#75 source gates remain cleared; workflow/device gates separate.
- mobile/release/qa: #79 source hold resolved by #87. Dummy-account dev-build scheme/HTTPS cold/warm and device storage/log/backup/share-sheet checks remain. Do not equate mocked native services with device evidence.
- backend/qa: send actual QA-13/BE-34 diffs for focused review; preserve accepted backend invariants. Tighten #57 concurrent loser assertion and provide approved isolated runtime evidence.
- PO: dev-only credential/provider configuration evidence without secrets. No production probe.

## Contract changes in flight
- #80 additive service-only apply_revenuecat_event; #81 companion assertions only.
- #75 deployment credential instructions, no app API/schema change; QA-13 separate.
- #83 additive own-only onboarding answers; not a full privacy audit here.
- #87 no API shape change; mutation persistence excluded, old cache invalidated.

## Questions for the product owner
- none
