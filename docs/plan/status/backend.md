# Backend / data developer status

Updated: 2026-11-11 · Branch: `be/BE-47b-offer-tips` · Task: BE-47b (+ BE-48b)

## Resume here

- Last AI / date: Claude Code · 2026-11-11.
- Worktree `~/dev/bonded-be` (re-created again from origin/main `110c63c`; `~/dev/codex-backend` is not used). Branch `be/BE-47b-offer-tips`; commits `b5bccf1` (BE-47b), `89b0908` (BE-48b) + this status commit; pushed; **PR #162**. Uncommitted work: none.
- BE-47b (lead decisions on #160): migration `20261111140000_offer_ending_tips.sql` re-creates `due_offer_endings` with `and np.tips` (promotional push needs the in-app opt-in; a tips-off partner gets no ledger row, so opting in inside the window still sends at the next tick). `trial_ending` unchanged (transactional). CONTRACTS §2 (`get_offer` row pointer) + §3 document the accepted "once per pair" gap after `purge_ended_couples` (lead option c) + change-log line. Test `supabase/tests/offer-tips.test.mjs` 19/19 (tips off/on, partial opt-in, trial_ending ignores tips; unpair → re-pair before purge = no gift; purge at +31 days → same pair earns a second gift; a pair where someone redeemed stays excluded after the purge via `premium_history`).
- BE-48b (SEC-10 optional, small so done): migration `20261111150000_revenuecat_sync_cap.sql`: private `revenuecat_sync_minutes(minute, calls ≤ 120)`, `claim_revenuecat_sync` checks the per-user 30 s limit first (no global slot used), then the global 120/UTC-minute cap (refusal leaves the user's 30 s slot unused), prunes counters > 1 h. Webhook `revenuecat/index.ts` stamps `p_occurred_at = max(event time, lookup time)`. Tests: `supabase/tests/revenuecat-hardening.test.mjs` 17/17 (cap, slots, pruning, access, late refund after a sync lands only with the lookup stamp); Deno test in `revenuecat/index_test.ts` + fixture assertion updated to max(). CONTRACTS §3 (`revenuecat-sync` 429) + §6 + change-log line.
- Results: full DB suite exit 0 (1790 PASS, reveal rule incl.); Deno 76/76; `qa/ci/functions.sh` exit 0; `gen-types --check` up to date (no public type change); `seed:check`, `sync.mjs --check` green. Real Postgres: isolated stack `bonded_be47b` (ports 595xx) applied all migrations + seed from scratch, smoke in a rolled-back txn OK (tips filter present, cap counter, 30 s limit), then `stop --no-backup` and deleted.
- Exact next step: wait for PR review (lead; SEC-10 re-check of BE-48b). After merge deploy to dev: migrations, then `revenuecat` and `daily-reminder` (unchanged code) / `revenuecat-sync` (comment only). Then BE-41.
- Commands: `export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH`; `node supabase/tests/offer-tips.test.mjs`; `node supabase/tests/revenuecat-hardening.test.mjs`; `npm --prefix supabase/tests test`; `deno test -A --config supabase/functions/deno.json supabase/functions`; `node supabase/tests/gen-types.mjs --check`; `bash qa/ci/functions.sh`.
- Gotchas: `day3-offer.test.mjs` builds the DB only up to BE-47's migration, so its `offer_ending` cases run without the tips gate (intended). `deno fmt` on `supabase/functions` also rewraps `README.md`. Isolated stack: copy `supabase/{config.toml,migrations,seed.sql,templates}` to /tmp, change `project_id` + ports, `supabase start -x ...`, then `supabase stop --no-backup`. Dev only `nyqbrsqqalygydtwvybb`; never prod. Hooks `.githooks`; no AI attribution.

## Doing

- BE-47b + BE-48b: **PR #162** open (not breaking; fewer pushes, same 429).

## Done

- BE-47 merged (#160). BE-48 merged (#156). BE-46 merged (#154). BE-40 merged (#149). BE-39 merged (#140). BE-38 merged (#135).
- BE-37 merged (#130). BE-36 merged (#129), superseded by BE-46. BE-11 #123 and BE-17 #125 merged.

## Next

- Deploy BE-48, BE-47 and BE-47b/48b to dev once merged (migrations first, then `revenuecat`, `revenuecat-sync`, `daily-reminder`).
- BE-41 (D46 answer length by Premium), then BE-42/43 (voice), BE-44/45 (little things).
- Otherwise: BE-31 needs the PO's go; BE-22 needs milestone approval; BE-13 waits until after launch.

## Blocked

- BE-48 email half of the day-5 reminder waits on the PO's email provider (lead.md question).
- BE-31 needs the PO's go; BE-22 needs milestone approval; BE-13 waits until after launch. The partner ritual-time and J5 privacy decisions need the lead.

## Needs from

- Lead: review the BE-47b/BE-48b PR; mark BE-47b and BE-48b done when merged. The 120/minute global cap is my pick (well under RevenueCat's REST limits as I understand them, ample for launch volume); say if you want another number.
- Mobile: (1) **`settings.tipsBody` consent copy must cover offers** (e.g. "New packs, offers and occasional updates"): PO copy, your change; `offer_ending` now goes only to users with `tips` on. (2) MOB-64 adds the Android `offer_ending` channel (`PUSH_TYPES`, `push.channels.offer_ending`, url `bonded://today`). Still open from BE-47/48: `trial_ending` channel, v2 answers, `revenuecat-sync` call order (CONTRACTS §2/§3); `get_offer`/`open_offer`/`claim_offer_screen` for MOB-64.
- QA (QA-33 part 3): add `offer_ending` tips cases (off → none, on → sent, partial opt-in) and the 120/minute `revenuecat-sync` cap (429) to your contract tests; earlier BE-47/BE-48/BE-46 items still stand (PR #160/#156/#154 notes).
- Security (SEC-10): re-check BE-48b (global cap in `claim_revenuecat_sync`, webhook `max(event, lookup)` stamp) and the BE-47b tips gate.
- PO: copy for `supabase/content/notifications.json` `types.offer_ending` and `types.trial_ending` (placeholders ship until then); the `tipsBody` wording above. Email provider for the day-5 email. `supabase/content/README.md` l.17 "Position 1 is the free preview" is no longer true under D51 (your file).
