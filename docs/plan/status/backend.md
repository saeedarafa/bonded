# Backend / data developer status

Updated: 2026-11-11 · Branch: `be/BE-47-day3-offer` · Task: BE-47 (D52 day-3 gift backend)

## Resume here

- Last AI / date: Claude Code · 2026-11-11.
- Worktree `~/dev/bonded-be` (re-created for BE-47 from origin/main `e6650ea`; `~/dev/codex-backend` is not used). Branch `be/BE-47-day3-offer`; commits `2aad89b`..`056dcb6` + runbook + this status commit; pushed; **PR #160**. Uncommitted work: none.
- Migration `supabase/migrations/20261111130000_day3_offer.sql`: private `premium_history` (trigger on `entitlements`: ever active or any product id; trigger on `subscription_trials`; backfill), because BE-48's `subscription_trials` is cleared on conversion/expiry. `couple_offers`: kind `day3`, `earned_at`, `first_opened_at`, `expires_at`/`first_shown_at` nullable, new `couple_offers_clock_check`. Trigger on `badge_awards` (`streak-3`, couple) creates the gift: 2 current members, nobody Premium at award time, nobody ever subscribed, the same pair never had one. `private.offer_at` behind `get_offer_at` (read-only; intro/winback never created now) and `open_offer_at`; public `open_offer`, `claim_offer_screen` (private `offer_screens`, one per person per local day), service-only `due_offer_endings` (private `offer_reminders`; due end − 2 h, window to end − 30 min, quiet hours, `claim_push` cap with release/retry). `push_type` `offer_ending`. No new error codes (no i18n commit needed).
- `daily-reminder` sends `offer_ending` (placeholder copy, url `bonded://today`). CONTRACTS §2/§3/§5/§6 + change log (breaking for MOB-22). Types regenerated. **Separate commit `f4795db` touches mobile's `src/features/premium/api.ts`** (null guard in `getOfferClocks` so `tsc` passes with nullable `expires_at`); mobile must ack.
- Tests: `day3-offer.test.mjs` 95/95 (builds pre-BE-47 DB, starts an intro clock, then applies the migration); `offers.test.mjs` pinned to pre-BE-47 migrations (61/61); `private-helpers` allow-list + 3 RPCs. Full DB suite exit 0 (1754 PASS, reveal rule incl.). Deno 75/75; `qa/ci/functions.sh`, `gen-types --check`, `seed:check`, `sync.mjs --check` green. Real Postgres: isolated stack `bonded_be47` (ports 594xx) applied all migrations + seed from scratch, smoke in a rolled-back txn OK, then stopped with `--no-backup` and deleted. App `tsc`: clean except missing modules from the shared stale `node_modules` (not mine); jest not run locally.
- Exact next step: wait for PR #160 review/acks (mobile ack, SEC-10 part 2, lead on the `tips` question); after merge deploy to dev (migration, then `daily-reminder`); then BE-41.
- Commands: `export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH`; `node supabase/tests/day3-offer.test.mjs`; `npm --prefix supabase/tests test`; `deno test -A --config supabase/functions/deno.json supabase/functions`; `node supabase/tests/gen-types.mjs --check`; `bash qa/ci/functions.sh`.
- Gotchas: `deno fmt` on `supabase/functions` also rewraps `README.md`. In tests, pin badge `awarded_at` (the gift is not live before `earned_at`). Isolated stack: copy `supabase/` to /tmp, change `project_id` + ports, `supabase start -x ...`, then `supabase stop --no-backup`. Dev only `nyqbrsqqalygydtwvybb`; never prod. Hooks `.githooks`; no AI attribution.

## Doing

- BE-47: **PR #160** open (breaking for MOB-22 code; needs mobile ack, SEC-10 part 2, QA-33 part 3).

## Done

- BE-48 merged (#156). BE-46 merged (#154). BE-40 merged (#149). BE-39 merged (#140). BE-38 merged (#135).
- BE-37 merged (#130). BE-36 merged (#129), superseded by BE-46. BE-11 #123 and BE-17 #125 merged.

## Next

- Deploy BE-48 and BE-47 to dev once merged (migrations first, then `revenuecat`, `revenuecat-sync`, `daily-reminder`).
- BE-41 (D46 answer length by Premium), then BE-42/43 (voice), BE-44/45 (little things).
- Otherwise: BE-31 needs the PO's go; BE-22 needs milestone approval; BE-13 waits until after launch.

## Blocked

- BE-48 email half of the day-5 reminder waits on the PO's email provider (lead.md question).
- BE-31 needs the PO's go; BE-22 needs milestone approval; BE-13 waits until after launch. The partner ritual-time and J5 privacy decisions need the lead.

## Needs from

- Lead (BE-47, PR #160): (1) **`offer_ending` and opt-in**: built per D52 (cap + quiet hours, no toggle). App Store guideline 4.5.4 asks for opt-in for promotional pushes; say if it should respect `tips` (opt-in, default off) instead (one-line SQL change). (2) Ack the decisions: "once per couple" = once per **pair of people** (re-pairing the same two doesn't earn another; a new partner does); an **unopened** gift has no end (live until opened or until someone subscribes); push window end − 2 h to end − 30 min; "ever subscribed" = any RevenueCat `premium` entitlement ever seen (trial, intro, paid, prepaid). (3) Mark D52 backend part / BE-47 done when merged.
- Mobile (MOB-22 / MOB-64), **breaking, please ack in PR #160**: `get_offer('intro'|'winback')` never starts a clock now; `couple_offers.expires_at` is nullable (I added a null guard in `getOfferClocks`, commit `f4795db`, your file: keep or replace). For MOB-64: `get_offer('day3')` → `{eligible, expires_at, first_opened_at, server_now}` (unopened = eligible with `expires_at` null → show 14); `open_offer('day3')` when 14 opens 15 (starts the 12 h clock once; same shape); `claim_offer_screen('gift'|'paywall')` before an unsolicited full-screen offer, show only on `true`; Today chip/Settings row while `eligible` and `expires_at` set. Add push type `offer_ending` (url `bonded://today`) to `PUSH_TYPES` and `push.channels.offer_ending`. Still open from BE-48: `trial_ending` channel, v2 answers, `revenuecat-sync` call order (CONTRACTS §2/§3).
- QA (QA-33 part 3), BE-47: contract tests: eligibility (Premium, ever subscribed incl. expired, trial used, empty snapshot is not a purchase), created only by the `streak-3` award, once per couple and per pair, 12 h from first open shared by partners, no extension/restart, `open_offer` no-op for Premium; `claim_offer_screen` (same screen retry true, other screen false, next local day); `due_offer_endings` (timing, both partners, quiet hours per recipient, D24 cap release/retry, once, skipped if Premium/unopened). Your `qa/e2e/run-daily.ts` expired-winback row still satisfies the new check. `qa/contract/planned.test.ts` l.27 (intro clock) is now retired behaviour. BE-48 and BE-46 items from earlier still stand (see PR #156/#154 notes).
- Security (SEC-10 part 2): review PR #160: server-only eligibility (no client unlock; clients can't write `couple_offers`), once-per-pair rule, private `premium_history`, new user-callable `open_offer`/`claim_offer_screen`, no premium grant from offers.
- PO: copy for `supabase/content/notifications.json` `types.offer_ending` (`title`, `body`, `url`) and `types.trial_ending`; placeholders ship until then. Email provider for the day-5 email. `supabase/content/README.md` l.17 "Position 1 is the free preview" is no longer true under D51 (your file).
