# Backend / data developer status

Updated: 2026-11-11 · Branch: `be/BE-41-answer-length` · Task: BE-41

## Resume here

- Last AI / date: Claude Code · 2026-11-11.
- Worktree `~/dev/bonded-be`. Branch `be/BE-41-answer-length` from origin/main `e895da5`; `[BE-41]` commit(s); pushed; **PR #175**. Uncommitted work: none.
- BE-41 (D46, D11 amended): migration `20261111170000_answer_length_premium.sql`: enum value `ANSWER_TOO_LONG`; CHECK `answers_body_length` now 1–2000 (validated backstop); BEFORE trigger `answers_length_check` (`private.answers_validate_length`, runs after `answers_before_write` by name) raises `ANSWER_TOO_LONG` P0001 with DETAIL `{"max":500|2000}` from `private.is_couple_premium` of the answer's couple at write time. Unchanged body on UPDATE passes; the INSERT half of an upsert that re-sends the stored text passes (BEFORE INSERT and the CHECK run on the proposed row before the conflict, so the check must happen in the INSERT half). Non-member writers: trigger stays silent so RLS answers (no Premium leak). Applies with no JWT too (seed/service). Pack answers same table.
- Tests: new `supabase/tests/answer-length.test.mjs` 35/35 (added to `npm test`); `content.test.mjs` D11 asserts now expect `ANSWER_TOO_LONG`. Full DB suite exit 0 (1839 PASS, reveal rule incl.); `gen-types --check`, `seed:check`, `sync.mjs --check` green. Types: enum value only. Real Postgres: isolated stack `bonded_be41` (ports 597xx) applied all migrations + seed; PostgREST upsert of 501 chars returned `400 {"code":"P0001","details":"{\"max\":500}","message":"ANSWER_TOO_LONG"}`; stack stopped `--no-backup` and deleted.
- Dev (bonded-dev `nyqbrsqqalygydtwvybb`) checked 2026-11-11: migrations through `20261111160000` are applied (main integration); `revenuecat`, `daily-reminder`, `notify` v168 redeployed after #173. **`revenuecat-sync` and `delete-account` are not deployed** (not in `config.toml`, so the integration skips them), and dev has **no function secrets** besides the Supabase defaults (no `REVENUECAT_WEBHOOK_SECRET`, `REVENUECAT_REST_API_KEY`, Expo). `supabase functions deploy` refuses in agent mode (needs the user's `--yes` consent), so I did not deploy. BE-41's migration reaches dev by the main integration after merge.
- Exact next step: wait for review of the BE-41 PR (lead) and mobile's ack. Then BE-42 (voice storage).
- Commands: `export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH`; `node supabase/tests/answer-length.test.mjs`; `npm --prefix supabase/tests test`; `node supabase/tests/gen-types.mjs --check`.
- Gotchas: `qa/contract/tables.test.ts` l.486 expects `23514` for 501 chars and will fail in CI `db-reset` until QA updates it (see Needs from). Another stack `bonded_backend_be11` was running; not mine, left alone. Dev only; never prod. Hooks `.githooks`; no AI attribution.

## Doing

- BE-41: **PR #175** open (breaking for error handling: 501+ chars now `ANSWER_TOO_LONG`, not `23514`; mobile must ack).

## Done

- BE-48c merged (#173). BE-47b + BE-48b merged (#162). BE-47 merged (#160). BE-48 merged (#156). BE-46 merged (#154). BE-40 merged (#149). BE-39 merged (#140). BE-38 merged (#135).
- BE-37 merged (#130). BE-36 merged (#129), superseded by BE-46. BE-11 #123 and BE-17 #125 merged.

## Next

- After BE-41 merges: dev gets the migration through the main integration (verify with `supabase migration list --remote=nyqbrsqqalygydtwvybb`). Deploy `revenuecat-sync` (and `delete-account`) to dev once the PO runs the deploy or approves `--yes`; secrets need the PO.
- BE-42/43 (voice), BE-44/45 (little things).
- Otherwise: BE-31 needs the PO's go; BE-22 needs milestone approval; BE-13 waits until after launch.

## Blocked

- Dev function deploys (`revenuecat-sync`, `delete-account`) and dev function secrets need the PO: the CLI requires the user's consent for hosted deploys in agent mode.
- BE-48 email half of the day-5 reminder waits on the PO's email provider (lead.md question).
- BE-31 needs the PO's go; BE-22 needs milestone approval; BE-13 waits until after launch. The partner ritual-time and J5 privacy decisions need the lead.

## Needs from

- Lead: review the BE-41 PR; mark D46 length part done (BE-41) once merged; LEAD-12 can copy the §2/§8 wording. BE-48c done (#173).
- Mobile (**contract changed, ack needed in the PR**): answers over the limit now raise `ANSWER_TOO_LONG` (P0001), not `23514`; `error.details` is the JSON string `{"max":500}` or `{"max":2000}` (`JSON.parse`). Cap input at 500 free / 2000 Premium (MOB-54 counter); keep mapping the server error (lapse between typing and sending). Re-sending unchanged long text after a lapse succeeds; any change must bring it to ≤ 500. Add `ANSWER_TOO_LONG` to `src/lib/errors.ts`. Still open: `settings.tipsBody` consent copy covering offers; `trial_ending`/`offer_ending` channels; v2 onboarding answers; `revenuecat-sync` call order.
- QA: **`qa/contract/tables.test.ts` l.483–487** ("answers are 1–500 characters (BE-05, D11)"): the 501 case must expect `error.message === 'ANSWER_TOO_LONG'` (code `P0001`, `details` `'{"max":500}'`) instead of `23514` (empty stays `23514`), provided Maya's couple has no active entitlement in that fixture. CI `db-reset` is red on that one assertion until then. QA-27: add tier/lapse cases (premium 2000/2001 → `{"max":2000}`, lapse: 1800 readable, edit to 501 or 1700 rejected, unchanged re-send ok, edit down to 500 ok; pack answers same; other couple gets RLS error, not `ANSWER_TOO_LONG`). Earlier BE-47/48 items (offer_ending tips cases, 120/minute cap) still stand.
- Security (SEC-10): BE-48c/48b re-check if not done. BE-41 adds a SECURITY DEFINER trigger function (`private.answers_validate_length`, no grants); optional look.
- PO: deploy `revenuecat-sync` and `delete-account` to bonded-dev (`supabase functions deploy revenuecat-sync delete-account --project-ref nyqbrsqqalygydtwvybb`) or allow it, and set dev secrets (`REVENUECAT_WEBHOOK_SECRET`, `REVENUECAT_REST_API_KEY`, Expo). Copy for `notifications.json` `offer_ending`/`trial_ending`; `tipsBody` wording; email provider for the day-5 email; `supabase/content/README.md` l.17 (position 1 free preview) is outdated under D51.
