# Security reviewer status
Updated: 2026-11-04 · Branch: security/SEC-08-revenuecat-review · Milestone: M4

## Resume here
- Work only in `/Users/saeedarafa/dev/bonded-security`, branch `security/SEC-08-revenuecat-review`. Mode: focused guidance (source plus CI only; no compliant OS sandbox, so no target code run). Fetch/push via `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' ...`.
- 2026-11-10 verdicts posted as PR comments:
  - #125 BE-17 server time: sign-off at `fc299bc`. Migration `20261105190000_offer_server_time.sql`, tests, types and CONTRACTS are byte-identical to the reviewed `7e37640` (only the backend status file changed). CI all green. https://github.com/saeedarafa/bonded/pull/125#issuecomment-6766263853
  - #123 BE-11 streak context: sign-off at `c1fdf1d`. `20261110120000_streak_context.sql` is the same blob `dd4fb69` as the one reviewed at `d9cd2e0` (pure rename). QA `1f7ef2b` covers cross-couple reads, anon, NOT_PAIRED and no inheritance after unpair. CI was still running when posted; merge only once green. https://github.com/saeedarafa/bonded/pull/123#issuecomment-6766264399
  - #124 MOB-22 offers: delta `6f62fea..8bc6685` sign-off. Offer clocks are read-only and RLS-scoped (`couple_offers` select policy `my_couple_id()`). A clock only picks the displayed RevenueCat offering and never grants premium. Clocks are excluded from the persisted cache. CI green. https://github.com/saeedarafa/bonded/pull/124#issuecomment-6766324015
- Corrected: the old #79 preview-token persistence item is closed. Fixed by #87 (`6f91f94`): `useInvitePreview` uses `TOKEN_MUTATION` (`src/features/pairing/hooks.ts:186`) and `PERSIST_DEHYDRATE_OPTIONS.shouldDehydrateMutation: () => false` (`src/lib/queryClient.ts:29`), with `tokenPersistence.test.tsx`. Accepted in #89. Still open: #80/#81 sign-off only while the backend is unchanged; review the QA-13 workflow before credential exposure; BE-34/D39 review when it opens.
- Exact next step: `gh pr list --state open`; if the #123, #124 or #125 heads change, diff against `c1fdf1d`/`8bc6685`/`fc299bc` and re-verify the source delta only.

## Doing
- All available requested source reviews/verdicts posted; #79 fix verification pending.
- #80/#81 integration CI and QA-13 configuration/workflow review remain owner tasks.

## Done (since last update)
- 2026-11-04 resumed in the user-specified clone: clean tree, fetched, pulled old SEC-06 branch, discovered and switched/pulled SEC-08; re-ran handoff status/log/PR/whitespace commands. #82 has no discussion, review or inline comments. #75/#80/#81 source heads and CI outcomes unchanged; no inline comments. #57 remains open. #79 merged; #87 contains its pending remediation. No target tests executed.
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
