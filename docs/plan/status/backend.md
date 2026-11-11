# Backend / data developer status

Updated: 2026-11-11 · Branch: `be/BE-41b-length-guess` · Task: BE-41b (SEC-11 Low) PR; next BE-43

## Resume here

- Last AI / date: Claude Code · 2026-11-11.
- Worktree `~/dev/bonded-be`. Branch `be/BE-41b-length-guess` (from origin/main with BE-42 #183, BE-49 #180, MOB-55a #185). Uncommitted work: none. BE-42 merged (#183).
- BE-41b (SEC-11 Low on #175): migration `20261111190000_answer_length_owner_only.sql` redefines `private.answers_validate_length`: the INSERT "unchanged stored text" shortcut also needs `auth.uid() is null or new.user_id = auth.uid()`. Test in `answer-length.test.mjs` (49/49): Maya inserting/upserting with Sam's `user_id` and the right vs wrong 717-char guess → same error (RLS while Premium, `ANSWER_TOO_LONG {"max":500}` after lapse; failed before the fix); own re-send and no-JWT path still pass. CONTRACTS §2 Answer row wording + change-log line.
- BE-42 merged (#183, SEC-09 APPROVE with condition: BE-43 before voice UI ships; Info 3 unserialised checks → consider advisory lock in BE-43).
- Tests on BE-41b: full DB suite exit 0 (1940 PASS); `gen-types --check`, `seed:check`, `sync.mjs --check` green.
- Exact next step: push BE-41b, open PR "[BE-41b] Length check: no exact-guess oracle on partner answers", then branch `be/BE-43-voice-caps` from origin/main for **BE-43** (per-kind caps 400/300 KB and 90/60 s, `VOICE_LIMIT` + daily cap 20/couple/day, purge/delete-account object cleanup, 24 h orphan cleanup, notify copy; SEC-09 Info 3 advisory lock).
- Commands: `export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH`; `node supabase/tests/voice-storage.test.mjs`; `npm --prefix supabase/tests test`; `node supabase/tests/gen-types.mjs --check`.
- Gotchas: the PGlite `storage.buckets` stub now has `file_size_limit`/`allowed_mime_types` (stored only; Storage enforces them). Storage rejects with HTTP 400 and the real status in the body's `statusCode`. PL/pgSQL does not short-circuit `NEW.field` of another table, hence one trigger function per table. Dev only, never prod; no hosted deploys from agent mode. Stack `bonded_qa35ci` is QA's. Hooks `.githooks`; no AI attribution.

## Doing

- BE-41b: SEC-11 Low fix (length-check guess oracle), PR open.
- BE-43: voice caps + lifecycle (next).


## Done

- BE-42 merged (#183). BE-49 merged (#180). BE-41 merged (#175). BE-48c merged (#173). BE-47b + BE-48b merged (#162). BE-47 merged (#160). BE-48 merged (#156). BE-46 merged (#154). BE-40 merged (#149). BE-39 merged (#140). BE-38 merged (#135).
- BE-37 merged (#130). BE-36 merged (#129), superseded by BE-46. BE-11 #123 and BE-17 #125 merged.

## Next

- BE-49 merged: confirm `revenuecat-sync` and `delete-account` in bonded-dev (`supabase functions list --project-ref nyqbrsqqalygydtwvybb`). After BE-42 merges: migration reaches dev via the main integration.
- BE-43 (voice caps/lifecycle) next, BE-44/45 (little things).
- Otherwise: BE-31 needs the PO's go; BE-22 needs milestone approval; BE-13 waits until after launch.

## Blocked

- bonded-dev function secrets need the PO: `REVENUECAT_WEBHOOK_SECRET`, `REVENUECAT_REST_API_KEY`, `EXPO_ACCESS_TOKEN`, `INTERNAL_FUNCTION_SECRET` (must equal Vault `internal_function_secret`), optional `SENTRY_DSN`; set with `supabase secrets set --env-file supabase/functions/.env --project-ref nyqbrsqqalygydtwvybb` (keys in `supabase/functions/.env.example`; values never in the repo). Function deploys follow from BE-49's merge.
- BE-48 email half of the day-5 reminder waits on the PO's email provider (lead.md question).
- BE-31 needs the PO's go; BE-22 needs milestone approval; BE-13 waits until after launch. The partner ritual-time and J5 privacy decisions need the lead.

## Needs from

- Lead: review/merge #183 (BE-42) then mobile #185 right after (the `app` job is red on #183 alone); mark D46 length part done (BE-41, merged) and storage part done (BE-42) once merged; LEAD-12 can copy the BE-42 §2 rows into ARCHITECTURE (voice storage); LEAD-12 can copy the §2/§8 wording. BE-48c done (#173).
- Mobile (**BE-42 contract changed, ack needed in the PR**): `answers.body` and `thread_messages.body` are now `string | null` (null for voice); new columns `kind` (`text`|`voice`), `voice_path`, `voice_duration_ms`; new code `INVALID_VOICE` (add `errors.INVALID_VOICE` to en.json; tsc fails without it). Fix the 5 tsc errors listed in Resume here. Voice flow (MOB-55/56): upload to `voice/{couple_id}/{uid}/{uuid}.m4a` (upsert false), then upsert the row with `kind: 'voice', body: null, voice_path, voice_duration_ms`; switching back to text must send `kind: 'text', voice_path: null, voice_duration_ms: null`; upload `contentType: 'audio/mp4'` for m4a (bucket allow-list, 400 KB max; `InvalidMimeType`/`EntityTooLarge` bodies in CONTRACTS); partner playback via `createSignedUrl` (≤ 60 s, never stored or logged: now a contract rule) only after reveal; Storage AccessDenied on upload = not Premium/not paired; delete discarded takes. BE-41 (merged): answers over the limit now raise `ANSWER_TOO_LONG` (P0001), not `23514`; `error.details` is the JSON string `{"max":500}` or `{"max":2000}` (`JSON.parse`). Cap input at 500 free / 2000 Premium (MOB-54 counter); keep mapping the server error (lapse between typing and sending). Re-sending unchanged long text after a lapse succeeds; any change must bring it to ≤ 500. Add `ANSWER_TOO_LONG` to `src/lib/errors.ts`. Still open: `settings.tipsBody` consent copy covering offers; `trial_ending`/`offer_ending` channels; v2 onboarding answers; `revenuecat-sync` call order.
- QA: QA-27 voice cases now testable (BE-42 part): partner denied before answering then allowed, other couple/anon denied, free upload denied, text+voice 23514, `INVALID_VOICE`, lapse keeps reads. Raw SQL joining `reactions` with `answers`/`thread_messages` must qualify `kind` (now ambiguous). Earlier: **`qa/contract/tables.test.ts` l.483–487** ("answers are 1–500 characters (BE-05, D11)"): the 501 case must expect `error.message === 'ANSWER_TOO_LONG'` (code `P0001`, `details` `'{"max":500}'`) instead of `23514` (empty stays `23514`), provided Maya's couple has no active entitlement in that fixture. CI `db-reset` is red on that one assertion until then. QA-27: add tier/lapse cases (premium 2000/2001 → `{"max":2000}`, lapse: 1800 readable, edit to 501 or 1700 rejected, unchanged re-send ok, edit down to 500 ok; pack answers same; other couple gets RLS error, not `ANSWER_TOO_LONG`). Earlier BE-47/48 items (offer_ending tips cases, 120/minute cap) still stand.
- Security (SEC-09): approved #183; Low 1 (bucket size/MIME) fixed in `5f54abf`, Info 2 (signed-URL rule) in CONTRACTS; Info 3/4 accepted; optional re-check. SEC-10: BE-48c/48b re-check if not done. BE-41 adds a SECURITY DEFINER trigger function (`private.answers_validate_length`, no grants); optional look.
- PO: set bonded-dev function secrets (list under Blocked). Deploys follow from BE-49's merge. Copy for `notifications.json` `offer_ending`/`trial_ending`; `tipsBody` wording; email provider for the day-5 email; `supabase/content/README.md` l.17 (position 1 free preview) is outdated under D51.
