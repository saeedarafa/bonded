# Backend / data developer status

Updated: 2026-11-11 · Branch: `be/BE-47b-offer-tips` · Task: BE-47b (+ BE-48b)

## Resume here

- Last AI / date: Claude Code · 2026-11-11.
- Worktree `~/dev/bonded-be` (re-created from origin/main `470a3bc`). Branch `be/BE-48c-rc-id-case`; one `[BE-48c]` commit (code + status); pushed; **PR #173** ("Fixes #167"). Uncommitted work: none.
- BE-48c (#167, SEC-10 Medium): `_shared/revenuecat.ts` `uuid()` accepts only canonical lower-case UUIDs (new `uuidShaped()` keeps an upper-case `app_user_id` well-formed, so such an event is 200 + `revenuecat.anonymous_ignored`, no lookup, no write). Migration `20261111160000_revenuecat_canonical_ids.sql`: `private.assert_canonical_revenuecat_ids(jsonb)` raises `INVALID_WEBHOOK` for non-string / non-canonical `user_id` text; `public.apply_revenuecat_event` (same signature/grants, still `language sql`) calls it before the private apply, so the event id is not consumed. Webhook clamps `p_occurred_at` to `max(min(event, lookup + 5 min), lookup)`. CONTRACTS §6 + change-log line; functions README.
- Tests: `supabase/tests/revenuecat-canonical-ids.test.mjs` 14/14 (added to `npm test`); Deno `alias_test.ts` (upper/mixed case in aliases, original_app_user_id, app_user_id, SUBSCRIBER_ALIAS, TRANSFER from/to: ignored; canonical next to upper: only canonical) and `index_test.ts` (future clamp; fixture expectation now clamped).
- Results: full DB suite exit 0 (1804 PASS, reveal rule incl.); Deno 79/79; `qa/ci/functions.sh` exit 0; `gen-types --check` up to date; `seed:check`, `sync.mjs --check` green. Real Postgres: isolated stack `bonded_be48c` (ports 596xx) applied all migrations + seed; smoke in rolled-back txn (upper-case id raises INVALID_WEBHOOK, row stays active); stopped `--no-backup` and deleted.
- Exact next step: wait for review (lead; SEC-10 re-check). After merge deploy to dev: migration, then `revenuecat` (and `revenuecat-sync`, shared module changed). Then BE-41.
- Commands: `export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH`; `node supabase/tests/revenuecat-canonical-ids.test.mjs`; `npm --prefix supabase/tests test`; `deno test -A --config supabase/functions/deno.json supabase/functions`; `node supabase/tests/gen-types.mjs --check`; `bash qa/ci/functions.sh`.
- Gotchas: public functions may not contain `raise exception '...'` (error-codes test), hence the private helper. QA's #167 `it.fails` test still "fails" after the fix (it expects a lookup of the upper-case id and the event now gets no lookup), so `.fails` keeps passing: QA must rewrite it, not just drop `.fails`. Another stack `bonded_backend_be11` was running; not mine, left alone. Dev only `nyqbrsqqalygydtwvybb`; never prod. Hooks `.githooks`; no AI attribution.

## Doing

- BE-48c (#167): **PR #173** open (not breaking; the app's uid is always canonical).

## Done

- BE-47b + BE-48b merged (#162). BE-47 merged (#160). BE-48 merged (#156). BE-46 merged (#154). BE-40 merged (#149). BE-39 merged (#140). BE-38 merged (#135).
- BE-37 merged (#130). BE-36 merged (#129), superseded by BE-46. BE-11 #123 and BE-17 #125 merged.

## Next

- Deploy BE-48, BE-47, BE-47b/48b and BE-48c to dev once merged (migrations first, then `revenuecat`, `revenuecat-sync`, `daily-reminder`).
- BE-41 (D46 answer length by Premium), then BE-42/43 (voice), BE-44/45 (little things).
- Otherwise: BE-31 needs the PO's go; BE-22 needs milestone approval; BE-13 waits until after launch.

## Blocked

- BE-48 email half of the day-5 reminder waits on the PO's email provider (lead.md question).
- BE-31 needs the PO's go; BE-22 needs milestone approval; BE-13 waits until after launch. The partner ritual-time and J5 privacy decisions need the lead.

## Needs from

- Lead: add the BE-48c row to BACKLOG and review its PR (Fixes #167). Mark BE-47b and BE-48b done (#162 merged). The 120/minute global cap is my pick; say if you want another number.
- Mobile: (1) **`settings.tipsBody` consent copy must cover offers** (e.g. "New packs, offers and occasional updates"): PO copy, your change; `offer_ending` now goes only to users with `tips` on. (2) MOB-64 adds the Android `offer_ending` channel (`PUSH_TYPES`, `push.channels.offer_ending`, url `bonded://today`). Still open from BE-47/48: `trial_ending` channel, v2 answers, `revenuecat-sync` call order (CONTRACTS §2/§3); `get_offer`/`open_offer`/`claim_offer_screen` for MOB-64.
- QA: **#167 test in `qa/contract/purchases-be48.test.ts`**: after BE-48c the upper-case event gets 200 with **no lookup and no write**; drop `.fails` and replace `toContain(upper)` with `lookups() == []` (Maya stays active). Add upper-case TRANSFER and a future `event_timestamp_ms` (clamped to lookup + 5 min) case.
- QA (QA-33 part 3): add `offer_ending` tips cases (off → none, on → sent, partial opt-in) and the 120/minute `revenuecat-sync` cap (429) to your contract tests; earlier BE-47/BE-48/BE-46 items still stand (PR #160/#156/#154 notes).
- Security (SEC-10): re-check BE-48c (#167: canonical lower-case ids only in the webhook, `INVALID_WEBHOOK` in `apply_revenuecat_event`, future timestamp clamp). Re-check BE-48b (global cap in `claim_revenuecat_sync`, webhook `max(event, lookup)` stamp) and the BE-47b tips gate.
- PO: copy for `supabase/content/notifications.json` `types.offer_ending` and `types.trial_ending` (placeholders ship until then); the `tipsBody` wording above. Email provider for the day-5 email. `supabase/content/README.md` l.17 "Position 1 is the free preview" is no longer true under D51 (your file).
