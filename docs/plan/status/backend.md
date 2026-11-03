# Backend / data developer status

Updated: 2026-11-03 · Branch: `be/BE-26-typed-code-approval` · Task: BE-26 (#41, D02 typed-code approval); BE-28 merged (#46)

## Resume here

- Last AI / date: Codex · 2026-11-03.
- Worktree: `/Users/saeedarafa/dev/bonded-be` only.
- SEC-04 follow-up (PO request): documented exact name/cap/decline-cooldown limits in CONTRACTS with a new change-log row; added exact 15-minute slot reclamation and remaining-invite-lifetime cooldown regressions. Focused join-request suite **58/58**; Deno checks and type/seed/plan/sync checks pass. Full 18-suite DB run passed (zero failures, join requests 58/58, invite-link 45/45, reveal-rule/RLS 23/23); app typecheck/lint/format and Jest 40 suites / 646 tests pass. Next work is BE-10 on a separate branch from origin/main while #41 waits on consumers/security.
- Session checkpoint: pulled pushed head `a92db3c`, merged `origin/main` (`5410d54`) without rebase in `d88fe9c`. Review fixes already present; re-running the full backend verification before continuing BE-10. Git fetch/pull/push use per-command `-c credential.helper= -c 'credential.helper=!gh auth git-credential'` (default helper fails here).
- Task / branch: **BE-26, PR #41**, `be/BE-26-typed-code-approval`. Last implementation commit `3a730c1` (SEC-04 fixes); previous checkpoint `e9c6994` merged `origin/main` (`1afafb5`) without rebase/force-push. This verification checkpoint adds a deterministic public-RPC fixture and this handoff; no product-code change after `3a730c1`. Uncommitted work: none after commit/push.
- Done: original lead fixes (token fixtures, pending-answer RLS, breaking contract, invite-id-pinned approval, mandatory BE-28 tests). SEC-04 F1/F2: inviter-only `pending_join_requests()` → `{request_id, requester_name, expires_at}[]` for live pending requests on the current open invite; first name ≤30 chars, no profile policy expansion. Declines stick per invite; maximum 3 live pending requests. Pending retries keep id/deadline; original/new link tokens bypass cap/decline and still join immediately. N1–N3: removed obsolete destructive helper, restored inviter JWT subject after approval (including errors), reduced table grants to SELECT. CONTRACTS and generated types updated. PR body and review reply updated.
- Verification: full `npm --prefix supabase/tests test`: **18 suites, zero failures** (join-requests 54/54, invite-link 45/45, reveal-rule/RLS 23/23). Final fixture-only change rechecked: join-requests 54/54. Generated types/seed/plan/agent-sync fresh; Deno lint/check/test/format passes (16 function + 9 QA tests). App typecheck/lint/format green; Jest 40 suites / 646 tests green.
- CI at `3a730c1`: [run 41635442845](https://github.com/saeedarafa/bonded/actions/runs/41635442845): app, db-tests, functions, plan, agent-sync **pass**. `supabase db reset` successfully applied all migrations and seed on real Postgres. `db-reset` job and `ci-ok` **fail in QA contract tests** that still treat typed pending objects as couple UUIDs (e.g. `helpers.ts` pairing helper; invites code variants; ended-couples/rpc/streak/tables/notifications fixtures). This is the lead's already-recorded QA-10 blocker; do not edit QA-owned files or weaken the approval rule.
- Exact next step: wait for QA-10 (the lead will integrate its branch carrying #41) and MOB-32 UI. Backend SEC-04 source sign-off through `5352a83` and mobile breaking-contract ack at `0335e42` are received. This checkpoint only fixes change-log rendering/ack/status. BE-10 is implemented and verified separately in PR #53 (`be/BE-10-nudges`, implementation `9aec30f`, verification `9f20655`); continue lead-assigned issue #50 on its own branch from origin/main. Do not merge main or rebase #41; return for new review comments.
- Commands to re-run: `npm --prefix supabase/tests ci`; `npm --prefix supabase/tests test`; `SUPABASE_TELEMETRY_DISABLED=1 npm --prefix supabase/tests run check:types`; `node supabase/scripts/build-seed.mjs --check`; `bash qa/ci/functions.sh`; `deno fmt --check supabase/functions`; `npm run typecheck`; `npm run lint`; `npm run format:check`; `npm test -- --runInBand`; `gh pr checks 41`.
- Tooling: use Node 24 (`PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH`). System Node 22.11 is below oxfmt's engine range; `npm ci` omitted the native formatter binding. Local repair, no manifest change: `npm --prefix supabase/tests install --no-save --package-lock=false @oxfmt/binding-darwin-arm64@0.75.0`.
- Watch out for: never reset/stop QA's shared `bonded` stack or deploy to an unidentified hosted project. Local DB behaviour tests use isolated PGlite; real reset evidence above is from CI. Main's migrations are immutable; 130000/140000 belong to this unmerged PR. SEC-04 N4 (Realtime DELETE UUID-only events) needs hosted dev validation once BE-27 is unblocked.

### BE-27 hosted parity (QA bug #28): blocked on the PO
- No hosted dev project is identifiable (`supabase projects list`: only `nciyrepyphvksusoigzx` "bonded", labelled production, and the inactive "Core"). Nothing read from or written to any hosted project.
- Next: PO names the dev project ref, then read-only GET `/v1/projects/<ref>/config/auth` and compare with `supabase/templates/magic_link.html`.
- PO operator checklist (dashboard, dev project): Site URL `bonded://`; Redirect URLs `bonded://auth/callback`, `bonded://**` (Expo Go: `exp://127.0.0.1:8081/--/**`); Magic Link and Confirm signup templates use `{{ .ConfirmationURL }}` link + `{{ .Token }}` code (no `{{ .TokenHash }}` links); Email OTP length 6; send a test sign-in email.

## Doing

- Review follow-up: **SEC-04 backend/source sign-off granted through `5352a83`**, and **mobile breaking-contract ack received** at `0335e42`. See #41 reviews. Lead will integrate QA-10 carrying #41, then MOB-32. No further backend feature change requested; this checkpoint fixes change-log table rendering and records the actual ack. CI at `5352a83`: app/db-tests/functions/plan/sync pass; migrations/seed apply, then QA-10 contract fixtures fail in db-reset.
- **BE-10 implemented and verified separately:** PR #53, branch `be/BE-10-nudges`, implementation `9aec30f`; all 18 DB suites pass, nudge 30/30, reveal rule 23/23, types/checks and Deno pass. Lead/mobile handoff in that branch. Next separate fix: issue #50, vacuous hardening own-answer UPDATE assertion.

- BE-26 (#41): implementation verified and pushed; waiting on QA-10, mobile ack/MOB-32 and SEC-04 re-review.

## Done

- BE-16 delete-account: PR #35 merged on main (6878bad); `be/BE-16-delete-account` is finished. delete-account removes `avatars/{uid}/avatar.jpg` before `auth.admin.deleteUser`; failure = `500 DELETE_FAILED`; 404/`USER_NOT_FOUND` = `200`.
- BE-28 / #46 merged (db6e9e7): `invite_link()`, SEC-03 signed off.
- #44 email sign-in (templates, `bonded://auth/callback` allow-list, `auth-email.test.mjs`) merged to main.
- PR #34 / BE-06 fixes `completed_today`.

## Blocked

- BE-27 and any dev deployment: no unambiguous dev project.
- BE-26 merge: QA-10 stale typed-code contract fixtures fail CI; SEC-04/D02 sign-off and mobile ack/MOB-32 UI remain required. BE-08 / #17 is merged; BE-10 is next after BE-26.
- Email delivery and real link/code consumption untested (shared QA stack must stay untouched).

## Needs from

- **PO:** safest recognition default implemented for SEC-04: display-name-derived first name only, trimmed and capped at 30 characters (possibly empty), shown only to the inviter for live pending requests. No email/avatar or general profile access. Please review the MOB-32 presentation; display names are user-supplied, not verified identity. Exact limits in CONTRACTS: 3 live requests; 15-minute request expiry; declined requester blocked on that invite for its remaining lifetime (maximum 48 hours from creation); valid link/new invite remains available.

- **Contract changed (breaking), mobile MOB-32:** ack #41 explicitly. Typed `accept_invite` returns `{status:'pending', request_id, expires_at}`; valid token returns the couple-id string. Show the requester first name from new `pending_join_requests()` before approve/decline, and refetch on `join_requests` signals. Name is user-supplied, capped at 30 chars, may be empty; it is a recognition cue, not verified identity. Handle sticky `JOIN_REQUEST_FORBIDDEN` and three-request `RATE_LIMITED`; offer a valid link when capacity is full.
- **QA QA-10:** update typed-code pairing fixtures/helper to use token links or pending → inviter approval; current db-reset contract failures are pending objects used as UUIDs/assumed memberships. Add new RPC privacy and decline/cap coverage against PostgREST. QA-12 invite_link tests remain separate.
- **Lead/security:** re-review SEC-04 F1/F2 fixes and N1–N3 in #41; D02 sign-off still required. Lead integrates #41 with QA-10 and MOB-32; backend never merges.
- **PO:** identify hosted dev project (BE-27, deployments, N4 validation).
