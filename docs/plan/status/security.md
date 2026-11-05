# Security reviewer status
Updated: 2026-11-04 · Branch: security/SEC-01-token-persistence · Milestone: M2/M4

## Resume here
- Recovery 2026-11-04: loaded required skills; initial DNS/TLS failures recovered. Resolved lead feedback on #89 by merging origin/main `6f8b851`, retaining #87 acceptance and prior #75/#80/#81 review records below. No product edits. Re-run git status/log and PR feedback after fetch. Current checkpoint is this merge commit.
- Authorized clone: `/Users/saeedarafa/dev/codex-security/bonded`. Clean session recovery: fetched/status/log, pulled old SEC-06, switched/pulled SEC-08, checked authored PR feedback (including inline), read role/team/database/security skills and mobile companion. No interrupted edits. SEC-08 checkpoint pushed `f45fe0c` on PR #82. This dedicated SEC-01 branch starts from main `c2f15c2`; status-only PR #89: https://github.com/saeedarafa/bonded/pull/89 . Latest fetched main `aaef349`; reviewed fix paths still identical. Checkpoint = commit containing this handoff (`git log -1`). Only own status edited; no product changes or target execution.
- Completed SEC-01 fix verification: #87 at `4d760c219582f8ed7117f66c3d549000a025cd23`, already merged, exact relevant product/test paths unchanged on main `c2f15c21f54400686bd47754b9f7e4f623c79ff3`. Source sign-off supersedes #79 J3 offline-persistence hold. Verdict: https://github.com/saeedarafa/bonded/pull/87#issuecomment-6633337370 . TOKEN_MUTATION on J3/J2, provider-wired all-mutation persistence exclusion, v2 buster, real QueryClient/persister offline regression source checked; seven required #87 CI jobs green. No new confirmed vulnerability; guidance only.
- Exact next step: review newly opened BE-34 #90 at `b927f70630c4c9718341f8727e8759296a1d7eae` on a new SEC-01 branch from origin/main `aaef349`; anonymous token-gated expired first-name disclosure (D39). #89/#82 comments, reviews and inline feedback empty. Main CI 41848724817 at aaef349 succeeded. #80 now `46ba1a4`, status-only delta from previous accepted head; functions/ci-ok still fail, QA companion integration/fresh CI required. #81/#75 unchanged, green. QA-13 absent. SEC-02/03 still blocked.
- Re-run: `git fetch origin`; `git status`; `git log -5 --oneline`; `gh pr list --author @me`; `gh pr view 87 --comments`; `gh pr view 89 --comments`; `gh pr view 82 --comments`; `gh pr list --state open --json number,title,headRefName,headRefOid`; `gh pr view 80 --json headRefOid,mergeable,statusCheckRollup`; same for 81/75; `gh issue view 57`; `gh run list --branch main --limit 5`; `git diff --check origin/main...origin/be/BE-18-revenuecat`.
- Git transport: `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' <command>`. Never rebase reviewed branches or merge to main. Disable repository hooks per commit; manually omit AI attribution.
- Validation boundary: no compliant OS sandbox (network isolation, empty allowlisted environment, read-only target/toolchain, scratch-only writes, CPU/memory/process/file/disk/wall limits). Source/CI/whitespace checks only, no reviewer target tests/native/hosted calls. Runtime evidence must use isolated dummy fixtures; do not touch shared stack. No SEC-02 or release acceptance claimed.

## Doing
- Available requested source reviews complete; integration/runtime gates remain with owners.

## Done (since last update)
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
- Post-merge #87 CI, #80/#81 combined integration, QA-13 actual workflow and BE-34 when open.
- Full SEC-02 after all P0 prerequisites, then dependent SEC-03.

## Blocked
- SEC-02: all P0 incomplete, including BE-11/MOB-19/MOB-24; SEC-03 depends on SEC-02.
- Required audit sandbox unavailable; no independent runtime/native/hosted validation.
- #80: provider secret/project/store environment/identity-transfer settings, deployed grants, concurrent upstream snapshots, purchase/restore/transfer and real push delivery require owner/QA evidence. Missing Vault/notify or uncertain push may lose delivery; never replay uncertain delivery.
- QA-13: actual workflow not available. Before credential exposure require main-only trusted checkout, protected bonded-dev environment restricted to main, successful matching dev migration, serialization/stale-SHA rejection, trusted psql/CA, secret only in loader step. Owner verifies distinct dev password and catalogue replay/rollback, no production probe.
- Runtime gaps remain: #57 real overlapping PostgreSQL approvals/PostgREST HTTP-400 persistence, shared push caps/retries, gateway provenance, API/Storage parity, Vault/pg_net/cron ACLs, Realtime DELETE UUID-only, actual signed URL/cache expiry, physical-device share-sheet redaction/native email callbacks/cache/backup/logs. Requested <=60-second signing TTL does not prove a bound measured from revocation for delayed in-flight signing.

## Needs from
- lead: merge this status-only handoff; retain #87 source acceptance with green post-merge CI. Combine #80/#81 per companion plan, fresh CI and migration 190000 before #83/200000. #75 source gate cleared; workflow review still separate.
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
