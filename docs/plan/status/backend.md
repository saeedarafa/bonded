# Backend / data developer status

Updated: 2026-11-11 · Branch: `be/BE-48-onboarding-backend` · Task: BE-48 (D50 onboarding backend)

## Resume here

- Last AI / date: Claude Code · 2026-11-11.
- Worktree `~/dev/bonded-be` (new; `~/dev/codex-backend` is not used). Branch `be/BE-48-onboarding-backend` from origin/main `abdd9b2`; commits `2ea978a`..`b0d636a` plus this status commit; pushed; PR #PRNUM. Uncommitted work: none.
- Migration `supabase/migrations/20261111120000_onboarding_backend.sql`: (c) `onboarding_answers` **v2** validated by trigger (`INVALID_ONBOARDING_ANSWER`, new enum value) + CHECK `onboarding_answers_v2_keys` (NOT VALID, so old dev rows can't block the migration); keys = design-handoff S01 = the mobile v1 constants (`last_learned` this_week/this_month/cant_remember; 4 stages; 6 goals, 0–6 distinct). (b) private `subscription_trials` (written by `apply_revenuecat_event` from new optional change fields `period_type`, `period_started_at`, `will_renew`), private `trial_reminders` ledger, service-only `due_trial_endings(p_now)` (start + 4 days or end − 2 days if earlier; 24 h window; quiet hours; D24 cap via `claim_push`, cap-blocked claims released and retried; once per user + trial start; only if will renew and entitlement active). New `push_type` value `trial_ending`. (a) private `revenuecat_syncs` + service-only `claim_revenuecat_sync` (30 s).
- Functions: `_shared/revenuecat.ts` (snapshot moved out of the webhook, now with trial metadata); `revenuecat` resolves UUIDs from `app_user_id`/`original_app_user_id`/`aliases` (+ legacy `SUBSCRIBER_ALIAS`), anonymous-only still 200/no write; new **`revenuecat-sync`** (user JWT, own entitlement only, 429 after 1 call/30 s); `daily-reminder` sends `trial_ending` (placeholder copy until the PO adds `types.trial_ending`). (d) No `finish_onboarding` RPC: call order in CONTRACTS §2 "Finishing onboarding right after sign-in".
- Tests: `supabase/tests/onboarding-v2.test.mjs` 53/53, `trial-ending.test.mjs` 36/36 (both in the suite); `onboarding-answers.test.mjs` updated to valid v2 keys; `private-helpers` allow-list adds the two service RPCs. Deno: `revenuecat/alias_test.ts` (8), `revenuecat-sync/index_test.ts` (3), daily-reminder +2; 73/73. Full DB suite exit 0 (1711 PASS incl. reveal rule). `gen-types --check`, `seed:check`, sync/plan `--check`, `bash qa/ci/functions.sh` green. Migration compiled + smoke-run on real Postgres in a rolled-back transaction on `supabase_db_bonded` (that stack is at 20261103220000). **`supabase db reset` not run** (shared stacks only); CI `db-reset.sh` covers it.
- Exact next step: wait for review/acks on the PR (lead decision on `revenuecat-sync`, SEC-10); deploy to dev after merge (migration first, then `revenuecat`, `revenuecat-sync`, `daily-reminder`); then BE-41.
- Commands: `export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH`; `node supabase/tests/onboarding-v2.test.mjs`; `node supabase/tests/trial-ending.test.mjs`; `npm --prefix supabase/tests test`; `deno test -A --config supabase/functions/deno.json supabase/functions`; `node supabase/tests/gen-types.mjs --check`; `bash qa/ci/functions.sh`.
- Gotchas: `deno fmt` on `supabase/functions` also rewraps `README.md`. RevenueCat app user ids are case-sensitive (don't lower-case). Dev only `nyqbrsqqalygydtwvybb`; never prod. Hooks `.githooks`; no AI attribution.

## Doing

- BE-48: **PR #PRNUM** open (additive contract; needs lead decision on `revenuecat-sync`, SEC-10 review, mobile/QA notice).

## Done

- BE-46 merged (#154). BE-40 merged (#149). BE-39 merged (#140). BE-38 merged (#135).
- BE-37 merged (#130). BE-36 merged (#129), superseded by BE-46. BE-11 #123 and BE-17 #125 merged.

## Next

- BE-41 (D46 answer length by Premium), then BE-42/43 (voice), BE-44/45 (little things), BE-47.
- Otherwise: BE-31 needs the PO's go; BE-22 needs milestone approval; BE-13 waits until after launch.

## Blocked

- BE-48 email half of the day-5 reminder waits on the PO's email provider (lead.md question).
- BE-31 needs the PO's go; BE-22 needs milestone approval; BE-13 waits until after launch. The D28, partner ritual-time and J5 privacy decisions need the lead.

## Needs from

- Lead: (1) **decision** on `revenuecat-sync` (PR #PRNUM): RevenueCat sends no webhook when `Purchases.logIn` aliases an anonymous P3 purchase, so without it premium would only land at the next renewal (day 7). It trusts RevenueCat's REST API for the caller's own id, exactly like the webhook handler already does; nothing from the client is trusted. (2) Ack the day-5 timing: trial start + 4 days (or end − 2 days if earlier), 24 h window, only for trials that will convert. (3) Mark D50 backend part / BE-48 done when merged; D51 backend (BE-46) is merged.
- Mobile (MOB-61/62): **contract added, BE-48**: (a) questionnaire **version 2** for the D50 flow: same keys as the current `LAST_LEARNED`/`STAGES`/`GOALS` constants, but v2 is validated, so anything else raises `INVALID_ONBOARDING_ANSWER` (don't retry such a row forever; v1 sync keeps working). (b) After sign-in follow CONTRACTS §2 "Finishing onboarding right after sign-in": profile `timezone`/`display_name` **before** `create_couple`; T1 via `get_daily_question` + `answers` upsert **without `client_written_at`**; `ritual_time` upsert. (c) `Purchases.logIn(uid)` → `POST functions/v1/revenuecat-sync` → refetch `entitlements` (429 = wait 30 s, 503 = keep session). (d) New push type `trial_ending` (url `bonded://today`): add it to `PUSH_TYPES` (Android channel) and `push.channels.trial_ending`. Generated types include the new enum values.
- QA (QA-33 part 3): contract tests for BE-48: webhook with `$RCAnonymousID` app_user_id + uid in `aliases`/`original_app_user_id` (lands on uid), two UUIDs in aliases (each gets only its own RevenueCat state), anonymous-only (200, no write; your existing cases still pass), TRANSFER anon → uid, legacy `SUBSCRIBER_ALIAS`; `revenuecat-sync` (401/405/429/own id only); `trial_ending` (`due_trial_endings` timing, quiet hours, cap release/retry, once, cancelled trial skipped); v2 answers (`INVALID_ONBOARDING_ANSWER` cases). Please add fixtures for the alias/transfer events to `qa/fixtures/revenuecat-events.json` (your file; mine are inline in `revenuecat/alias_test.ts`).
- Security (SEC-10): review PR #PRNUM: new user-callable `revenuecat-sync`, alias resolution (no cross-user grant), private trial state, v2 validation.
- PO: copy for `supabase/content/notifications.json` `types.trial_ending` (`title`, `body`, optional `{days}`, `url`); a placeholder ships until then. Email provider for the day-5 email.
- QA (QA-33), **BE-46** (still open): free couples get `PREMIUM_REQUIRED` for every new pack question; see PR #154 notes (`qa/contract/rpc.test.ts` D43 describe, `tables.test.ts` thread/reaction tests using `Q.free`, e2e `pack` scenario).
- Mobile (MOB-63), **BE-46**: ack the `start_pack_question` behaviour change (PR #154).
- PO: `supabase/content/README.md` l.17 "Position 1 is the free preview" is no longer true under D51 (your file).
