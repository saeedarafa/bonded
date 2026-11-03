# Backend / data developer status

Updated: 2026-11-03 · Branch: `be/BE-26-typed-code-approval` · Task: BE-26 (#41, D02 typed-code approval); BE-28 merged (#46)

## Resume here

- Last AI / date: Codex · 2026-11-03.
- Worktree: `/Users/saeedarafa/dev/codex-backend/bonded` only.
- Task / branch: **BE-26, PR #41**, `be/BE-26-typed-code-approval`. Last implementation commit `3a730c1` (SEC-04 fixes); previous checkpoint `e9c6994` merged `origin/main` (`1afafb5`) without rebase/force-push. This verification checkpoint adds a deterministic public-RPC fixture and this handoff; no product-code change after `3a730c1`. Uncommitted work: none after commit/push.
- Done: original lead fixes (token fixtures, pending-answer RLS, breaking contract, invite-id-pinned approval, mandatory BE-28 tests). SEC-04 F1/F2: inviter-only `pending_join_requests()` → `{request_id, requester_name, expires_at}[]` for live pending requests on the current open invite; first name ≤30 chars, no profile policy expansion. Declines stick per invite; maximum 3 live pending requests. Pending retries keep id/deadline; original/new link tokens bypass cap/decline and still join immediately. N1–N3: removed obsolete destructive helper, restored inviter JWT subject after approval (including errors), reduced table grants to SELECT. CONTRACTS and generated types updated. PR body and review reply updated.
- Verification: full `npm --prefix supabase/tests test`: **18 suites, zero failures** (join-requests 54/54, invite-link 45/45, reveal-rule/RLS 23/23). Final fixture-only change rechecked: join-requests 54/54. Generated types/seed/plan/agent-sync fresh; Deno lint/check/test/format passes (16 function + 9 QA tests). App typecheck/lint/format green; Jest 40 suites / 646 tests green.
- CI at `3a730c1`: [run 41635442845](https://github.com/saeedarafa/bonded/actions/runs/41635442845): app, db-tests, functions, plan, agent-sync **pass**. `supabase db reset` successfully applied all migrations and seed on real Postgres. `db-reset` job and `ci-ok` **fail in QA contract tests** that still treat typed pending objects as couple UUIDs (e.g. `helpers.ts` pairing helper; invites code variants; ended-couples/rpc/streak/tables/notifications fixtures). This is the lead's already-recorded QA-10 blocker; do not edit QA-owned files or weaken the approval rule.
- Exact next step: lead coordinates **QA-10** companion fixes (token fixtures or pending → inviter approval), **MOB-32** UI displaying the requester name plus explicit mobile breaking-contract ack, and **SEC-04/D02 re-review** of `3a730c1` plus this fixture-only checkpoint. Merge companions/main into this branch as directed (never rebase/force-push), regenerate types if needed, re-run affected checks. **Never merge PR #41**; lead integrates. BE-10 is the next backend task after BE-26; BE-08/#17 is already merged.
- Commands to re-run: `npm --prefix supabase/tests ci`; `npm --prefix supabase/tests test`; `SUPABASE_TELEMETRY_DISABLED=1 npm --prefix supabase/tests run check:types`; `node supabase/scripts/build-seed.mjs --check`; `bash qa/ci/functions.sh`; `deno fmt --check supabase/functions`; `npm run typecheck`; `npm run lint`; `npm run format:check`; `npm test -- --runInBand`; `gh pr checks 41`.
- Tooling: use Node 24 (`PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH`). System Node 22.11 is below oxfmt's engine range; `npm ci` omitted the native formatter binding. Local repair, no manifest change: `npm --prefix supabase/tests install --no-save --package-lock=false @oxfmt/binding-darwin-arm64@0.75.0`.
- Watch out for: never reset/stop QA's shared `bonded` stack or deploy to an unidentified hosted project. Local DB behaviour tests use isolated PGlite; real reset evidence above is from CI. Main's migrations are immutable; 130000/140000 belong to this unmerged PR. SEC-04 N4 (Realtime DELETE UUID-only events) needs hosted dev validation once BE-27 is unblocked.

### BE-27 hosted parity (QA bug #28): blocked on the PO
- No hosted dev project is identifiable (`supabase projects list`: only `nciyrepyphvksusoigzx` "bonded", labelled production, and the inactive "Core"). Nothing read from or written to any hosted project.
- Next: PO names the dev project ref, then read-only GET `/v1/projects/<ref>/config/auth` and compare with `supabase/templates/magic_link.html`.
- PO operator checklist (dashboard, dev project): Site URL `bonded://`; Redirect URLs `bonded://auth/callback`, `bonded://**` (Expo Go: `exp://127.0.0.1:8081/--/**`); Magic Link and Confirm signup templates use `{{ .ConfirmationURL }}` link + `{{ .Token }}` code (no `{{ .TokenHash }}` links); Email OTP length 6; send a test sign-in email.

## Doing

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

- **Contract changed (breaking), mobile MOB-32:** ack #41 explicitly. Typed `accept_invite` returns `{status:'pending', request_id, expires_at}`; valid token returns the couple-id string. Show the requester first name from new `pending_join_requests()` before approve/decline, and refetch on `join_requests` signals. Name is user-supplied, capped at 30 chars, may be empty; it is a recognition cue, not verified identity. Handle sticky `JOIN_REQUEST_FORBIDDEN` and three-request `RATE_LIMITED`; offer a valid link when capacity is full.
- **QA QA-10:** update typed-code pairing fixtures/helper to use token links or pending → inviter approval; current db-reset contract failures are pending objects used as UUIDs/assumed memberships. Add new RPC privacy and decline/cap coverage against PostgREST. QA-12 invite_link tests remain separate.
- **Lead/security:** re-review SEC-04 F1/F2 fixes and N1–N3 in #41; D02 sign-off still required. Lead integrates #41 with QA-10 and MOB-32; backend never merges.
- **PO:** identify hosted dev project (BE-27, deployments, N4 validation).
