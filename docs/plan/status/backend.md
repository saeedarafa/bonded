# Backend / data developer status

Updated: 2026-11-04 · Branch: `be/BE-34-expired-invite` · Task: BE-34 / D39

## Resume here

- Worktree `/private/tmp/bonded-be34`, branch `be/BE-34-expired-invite` from latest origin/main `90264eb`. Main backend checkout `/Users/saeedarafa/dev/codex-backend/bonded` stays on #80 while startup test re-runs finish. Never switch a checkout with active tests. No secrets/hosted calls.
- Exact next step: finish BE-34 regression verification and isolated real reset/HTTP error smoke, push/open one PR, route token-name disclosure for security review. Migration 210000 is after pending #80/190000 and #83/200000; lead must preserve migration order or explicitly renumber before merge. Only lead merges main.
- BE-34 implementation: expired SQL `invite_preview` keeps HTTP400/P0001/INVITE_EXPIRED and adds only `details.inviter_name` (first name ≤30) for matching link tokens. Typed expiry counts, wrong/revoked/accepted tokens get no name, existing D02 actor lock and limit preserved. No avatar/answer/expiry in expired response. Avatar Edge endpoint still rejects expiry; mobile already falls back to SQL.
- Focused tests 26 pass; reveal/hardening/link/avatar/race/type checks running, logs `/private/tmp/bonded-be34-*.log`. Full startup DB suite at #80 completed successfully; QA functions expected 8 pass/1 stale fixture failure (fixed by #81); remaining app/static commands running. Never call interrupted checks green.
- Re-run: `node supabase/tests/expired-invite.test.mjs`; `npm --prefix supabase/tests test`; `npm --prefix supabase/tests run check:types`; `bash qa/ci/functions.sh`; `node supabase/scripts/build-seed.mjs --check`; plan/sync/diff checks. Node24 PATH `/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin`; hooks `.githooks`; per-command gh git credential helper. Temporary ignored dependency symlinks point at main checkout (remove before final clean status).
- Reviews checked first: #75 SEC-07 signed off c5cacad, CI41830450898 green, **marked ready** this session. #80 SEC-08 source sign-off at16f08ca; **#81 is lead-designated merge vehicle**, not a request to copy QA files into #80. #81 source signed off/CI41834008885 green; fresh combined CI needed after integration. #83 ready/current CI41837637886 green. No outstanding backend code requests. All PRs stay separate.
- Dev only `nyqbrsqqalygydtwvybb`, never prod `nciyrepyphvksusoigzx`. Never plain Supabase reset/stop (shared QA stack `bonded`); isolated project/ports only. Hosted functions require dev secrets/Vault; BE-27 GET/SMTP credentials unavailable. BE-31 waits PO go.
- Uncommitted work: none after checkpoint; tests underway.

## Doing

- BE-34 implementation complete; regression/reset validation and PR next.

## Done

- Startup fetch/status/log/pull, backend skills, task/contract/status reads; open backend PR reviews checked.
- #75 marked ready after named-head security sign-off and green CI.
- BE-34 focused26 pass; contracts and migration added, no new public API/type shape.

## Next

- BE-34 source/security/lead review, MOB-38/QA consume additive error details.
- BE-11 may branch from #80 while unmerged, or proceed after lead merges #81; one branch/PR per task.

## Blocked

- BE-34 needs security review and ordered dev migration deployment.
- #75 waits lead merge/QA-13 workflow/configuration; #80/#81 waits lead integration; #83 waits migration order.
- Hosted secrets/Vault, Auth GET/SMTP acceptance; BE-31 PO go.

## Needs from

- Lead/security: review BE-34 token-gated name disclosure; preserve migration order190000 →200000 →210000.
- Mobile/QA: contract changed BE-34/D39, optional object `error.details.inviter_name`; generic fallback when absent/empty. No expired avatar/answer/expiry. MOB-38 consumes.
- Lead: #75 source security + CI gates met, now ready. #81 is BE-18 merge vehicle; #83 current CI green.
- PO: dev-only credentials/secrets/Vault/SMTP; never production for testing.
