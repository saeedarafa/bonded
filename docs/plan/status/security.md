# Security reviewer status
Updated: 2026-11-04 · Branch: security/SEC-01-D39-review · Milestone: M2/M4

## Resume here
- Recovery 2026-11-04: clean tree; fetched (default fetch reset; gh credential-helper fallback succeeded), status/log checked, pulled previous branch fast-forward. Read all six open authored PR comment threads (#96/#89/#90/#91/#97/#83); #96/#89/#91 inline empty. #89 main integration request already addressed by 6446b4e; seven green/MERGEABLE. #96 no feedback. #90 unchanged b927f706/seven green; prior D39 verdict stands. Prior handoff updated/pushed in 8585fff on #96.
- Branch: security/SEC-01-streak-saver-review, from latest origin/main 6f8b851. Status-only SEC-01 focused review; checkpoint is commit containing this file. No product edits or target execution. Uncommitted none after commit/push. Prior acceptance evidence retained below.
- Completed #91 BE-11/D18 source review at e7c98cbe647215dd26e33ba4872063fb5319cb5c: authenticated no-argument wrapper supplies server now(); private core derives active couple, locks parent/streak and rechecks membership; premium requires an active unexpired entitlement of a current member. Ledger is private/RLS/no client grants, unique by couple/local usage month and saved day. Partner retries are idempotent, including expiry after success; they create no claim. Free/expired/former-member and cross-couple paths cannot select another resource. No answer/reveal write added. No new confirmed vulnerability established in this focused pass.
- Regression source inspected, not executed: free/exact-expiry/former-member/ended/outsider/anon denial, helper/ledger/client-clock denial, partner replay, shared monthly quota, month/DST boundaries, adjacent missed days, protected-day offline completion, badge threshold, unchanged locked partner answer/count and cascade. Existing reveal RLS and server answer timestamps/flags inspected. Real overlapping partner claims and answer/saver race remain owner/QA evidence, not independent reproduction.
- #91 all seven CI jobs green at reviewed head (41892516887); source whitespace check reports only a trailing blank line at migration220000:176 (cosmetic owner cleanup). Preserve migration order #83/200000 → #90/210000 → #91/220000; #80/190000 already merged/deployed. #83 now eede10f, all seven green after main merge; #97 newly open BE-17 offers, no lead request/comment yet. QA-13 absent; #57 open; main CI41874739021 succeeded.
- Exact next step: post #91 focused source verdict and open status-only SEC-01 PR; then inspect #97's newly callable offer boundary, checking current head/comments and source only. Monitor #96/#89/#90 and further requests. SEC-02 waits for all P0; SEC-03 depends on SEC-02. Do not start full audit early.
- Re-run: `git fetch origin`; `git status`; `git log -5 --oneline`; `git pull --ff-only`; `gh pr list --author @me`; `gh pr view 96 --comments`; `gh pr view 89 --comments`; `gh pr view 91 --comments`; `gh pr view 97 --comments`; `gh pr view 91 --json headRefOid,statusCheckRollup`; `gh pr list --state open --json number,title,headRefName,headRefOid`; `git diff --check origin/main...origin/be/BE-11-streak-saver`; `gh run list --branch main --limit 5`.
- Transport fallback: `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' <command>`. Disable repository hooks per commit. No AI attribution, no merges to main, no rebase of reviewed branches.
- Validation boundary: required OS sandbox unavailable (network isolation, empty allowlisted env, read-only target/toolchain, scratch-only writes and resource limits). No reviewer target tests/native/hosted calls. Safe validation plan: owners run isolated dummy fixtures with all controls, including simultaneous partner saver claims, free/expired/ended/former-member denials, month/DST rollover, and answer/saver/re-pair races; verify exactly one ledger claim, preserved streak and no answer/reveal changes. No SEC-02 or release acceptance claimed.

## Doing
- #91 focused source review complete; post verdict and handoff PR. Next new boundary: #97 BE-17 offers.

## Done (since last update)
- #91 BE-11/D18 focused source review at e7c98cbe; acceptance limited to inspected source and CI evidence. See Resume here for controls and validation limits.
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
- Review #97 offer source boundary; monitor #91/#90 relevant deltas/integration and status handoffs #96/#89; QA-13 workflow when available.
- Full SEC-02 after all P0 prerequisites, then dependent SEC-03.

## Blocked
- SEC-02: all P0 incomplete, including BE-11/MOB-19/MOB-24; SEC-03 depends on SEC-02.
- Required audit sandbox unavailable; no independent runtime/native/hosted validation.
- #80: provider secret/project/store environment/identity-transfer settings, deployed grants, concurrent upstream snapshots, purchase/restore/transfer and real push delivery require owner/QA evidence. Missing Vault/notify or uncertain push may lose delivery; never replay uncertain delivery.
- QA-13: actual workflow not available. Before credential exposure require main-only trusted checkout, protected bonded-dev environment restricted to main, successful matching dev migration, serialization/stale-SHA rejection, trusted psql/CA, secret only in loader step. Owner verifies distinct dev password and catalogue replay/rollback, no production probe.
- Runtime gaps remain: #57 real overlapping PostgreSQL approvals/PostgREST HTTP-400 persistence, shared push caps/retries, gateway provenance, API/Storage parity, Vault/pg_net/cron ACLs, Realtime DELETE UUID-only, actual signed URL/cache expiry, physical-device share-sheet redaction/native email callbacks/cache/backup/logs. Requested <=60-second signing TTL does not prove a bound measured from revocation for delayed in-flight signing.

## Needs from
- lead: #91 focused source gate cleared at e7c98cbe; seven CI jobs green; owner handles cosmetic trailing blank line. Merge status-only handoffs; #90 source gate cleared at b927f706 with seven green jobs. Preserve migration order 190000 → 200000 → 210000 and green integration. #87/#75 source gates remain cleared; workflow/device gates separate.
- mobile/release/qa: #79 source hold resolved by #87. Dummy-account dev-build scheme/HTTPS cold/warm and device storage/log/backup/share-sheet checks remain. Do not equate mocked native services with device evidence.
- backend/qa: send actual QA-13/BE-34 diffs for focused review; preserve accepted backend invariants. Tighten #57 concurrent loser assertion and provide approved isolated runtime evidence.
- PO: dev-only credential/provider configuration evidence without secrets. No production probe.

## Contract changes in flight
- #80 additive service-only apply_revenuecat_event; #81 companion assertions only.
- #75 deployment credential instructions, no app API/schema change; QA-13 separate.
- #83 additive own-only onboarding answers; #91 authenticated streak saver and eligibility; #97 shared offer clocks under review. These are not a full privacy audit.
- #87 no API shape change; mutation persistence excluded, old cache invalidated.

## Questions for the product owner
- none
