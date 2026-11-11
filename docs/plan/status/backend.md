# Backend / data developer status

Updated: 2026-11-11 · Branch: `be/BE-42-voice-storage` · Task: BE-42 in review (#183); next BE-43

## Resume here

- Last AI / date: Claude Code · 2026-11-11.
- Worktree `~/dev/bonded-be`. Branch `be/BE-42-voice-storage` = **PR #183**, origin/main (BE-49 #180) merged in; `[BE-42]` commits; pushed. Uncommitted work: none. BE-49 merged (#180).
- BE-42 (D46): migration `20261111180000_voice_storage.sql`: private bucket `voice` (`{couple_id}/{uid}/{uuid}.{m4a|aac|ogg|opus}`), **400 KB per object and audio MIME allow-list** (`audio/mp4`, `audio/x-m4a`, `audio/m4a`, `audio/aac`, `audio/aacp`, `audio/ogg`, `audio/opus`; SEC-09 Low 1); enum `content_kind`; `answers`/`thread_messages` + `kind`, `voice_path`, `voice_duration_ms`, `body` nullable, CHECK `*_text_xor_voice` (23514); unique `voice_path` per table. Triggers → `private.voice_check_new` (`PREMIUM_REQUIRED`, new code `INVALID_VOICE`). Storage policies: upload own folder of active Premium couple; read owner or through a readable row (reveal rule); delete own unreferenced; no update. CONTRACTS §2 *Voice upload*: bucket limits + exact Storage error bodies; signed URLs are a rule (≤ 60 s, never stored, never logged); change-log line.
- SEC-09 on #183: APPROVE (conditions: BE-43 before voice UI ships; CI green). Low 1 fixed. Info 3 (unserialised checks) and 4 (copy of a revealed recording) accepted, not changed. Mobile acked on #183; their `mobile/MOB-55a-voice-types` PR (#185) fixes the `app` job (red on #183 alone: nullable body, `INVALID_VOICE` key). Both mobile questions answered on #183.
- Tests: `voice-storage.test.mjs` 87/87 (new: bucket limits; overwrite/upsert/move denied; copy needs a readable source; UPDATE with partner `user_id` → `INVALID_VOICE` / row stays mine; free couple switches voice → text with mobile's full payload, retry idempotent; body-only upsert on a voice row → 23514). Full DB suite exit 0 (1926 PASS, reveal rule incl.). `gen-types --check`, `seed:check`, `sync.mjs --check` green. Real stack (isolated `bonded_be42`, ports 598xx, stopped `--no-backup`, deleted): bucket row has the limits; audio types ≤ 409600 B → 200; 409601 B → 400 `EntityTooLarge` (413); text/html, text/plain, octet-stream, video/mp4 → 400 `InvalidMimeType` (415); upsert/PUT on an existing name → AccessDenied.
- Exact next step: wait for lead review/merge of #183 (then mobile #185 right after). Then **BE-43** (per-kind caps 400/300 KB and 90/60 s, `VOICE_LIMIT` enum value + daily cap 20/couple/day, purge/delete-account object cleanup, 24 h orphan cleanup, notify copy; consider SEC-09 Info 3 advisory lock).
- Commands: `export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH`; `node supabase/tests/voice-storage.test.mjs`; `npm --prefix supabase/tests test`; `node supabase/tests/gen-types.mjs --check`.
- Gotchas: the PGlite `storage.buckets` stub now has `file_size_limit`/`allowed_mime_types` (stored only; Storage enforces them). Storage rejects with HTTP 400 and the real status in the body's `statusCode`. PL/pgSQL does not short-circuit `NEW.field` of another table, hence one trigger function per table. Dev only, never prod; no hosted deploys from agent mode. Stack `bonded_qa35ci` is QA's. Hooks `.githooks`; no AI attribution.

## Doing

- BE-42: voice storage + policies, **PR #183** in review (mobile acked, SEC-09 approved; Low 1 fixed).


## Done

- BE-49 merged (#180). BE-41 merged (#175). BE-48c merged (#173). BE-47b + BE-48b merged (#162). BE-47 merged (#160). BE-48 merged (#156). BE-46 merged (#154). BE-40 merged (#149). BE-39 merged (#140). BE-38 merged (#135).
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
