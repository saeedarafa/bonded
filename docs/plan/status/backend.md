# Backend / data developer status

Updated: 2026-11-11 · Branch: `be/BE-42-voice-storage` · Task: BE-42 (BE-49 in PR #180)

## Resume here

- Last AI / date: Claude Code · 2026-11-11.
- Worktree `~/dev/bonded-be`. Branch `be/BE-42-voice-storage` from origin/main `c02e915`; `[BE-42]` commits; pushed; PR open (see Doing). Uncommitted work: none. Separate branch `be/BE-49-function-config` = **PR #180** (config.toml declares `revenuecat-sync` and `delete-account`, both `verify_jwt = true`; static test `function-config.test.mjs`). If both status edits conflict, keep this version.
- BE-42 (D46): migration `20261111180000_voice_storage.sql`: private bucket `voice` (`{couple_id}/{uid}/{uuid}.{m4a|aac|ogg|opus}`); enum `content_kind`; `answers` and `thread_messages` + `kind`, `voice_path`, `voice_duration_ms` (> 0), `body` nullable, CHECK `*_text_xor_voice` (23514); partial unique index on `voice_path` per table; answer column grants extended. Triggers `answers_voice_check` / `thread_messages_voice_check` → `private.voice_check_new`: a NEW reference needs Premium (`PREMIUM_REQUIRED`) and an uploaded object in the writer's own folder used by no other row (new code `INVALID_VOICE`); unchanged re-sends pass (also after lapse); non-members stay silent (RLS answers); message voice fields frozen on update. Storage policies: upload own folder of active couple while Premium; read = owner (folder[2]) OR through a row the caller can read under `answers`/`thread_messages` RLS (reveal rule, 30-day archive); delete own unreferenced only; no update.
- Tests: new `supabase/tests/voice-storage.test.mjs` 71/71 (in `npm test`). Full DB suite exit 0 (1910 PASS, reveal rule incl.). `seed.test.mjs` l.126 qualified `r.kind` (ambiguous with `answers.kind`). `gen-types --check`, `seed:check`, `sync.mjs --check` green. Real stack (isolated `bonded_be42`, ports 598xx, stopped `--no-backup` and deleted): all migrations + seed applied; 27/27 Storage API + PostgREST checks (partner download and signed URL denied before answering, allowed after; other couple/anon denied; free upload → Storage AccessDenied, free voice row → `PREMIUM_REQUIRED`; missing object → `INVALID_VOICE`; text+voice → 23514; thread voice; delete rules). `supabase test db`: NOTESTS (repo has no pgTAP files; the suite is the PGlite harness).
- **App typecheck breaks until mobile updates** (CI `app` job red on this PR): `answers.body`/`thread_messages.body` are `string | null` (src/features/daily/api.ts:85, history/api.ts:144/237/242, thread/api.ts:28) and `errors.INVALID_VOICE` needs an en.json key (src/lib/errors.ts:155). Intended: the compiler flags every place that must handle voice.
- Exact next step: wait for mobile's ack + type follow-up and SEC-09 review on the BE-42 PR, lead review of #180. Then BE-43 (caps, `VOICE_LIMIT`, purge/delete-account object cleanup, orphan cleanup, notify copy).
- Commands: `export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH`; `node supabase/tests/voice-storage.test.mjs`; `npm --prefix supabase/tests test`; `node supabase/tests/gen-types.mjs --check`. App typecheck without installing: `ln -s ~/dev/bonded-mobile/node_modules node_modules && ./node_modules/.bin/tsc --noEmit; rm node_modules`.
- Gotchas: Storage rejects RLS uploads with HTTP 400 and body `statusCode "403"`; no custom codes from Storage. PL/pgSQL does not short-circuit `NEW.field` of another table, hence one trigger function per table. Dev only, never prod; no hosted deploys from agent mode. Stack `bonded_backend_be11` not mine. Hooks `.githooks`; no AI attribution.

## Doing

- BE-42: voice storage + policies, PR "[BE-42] Voice storage and policies" (breaking for types; mobile ack + SEC-09 review).
- BE-49: **PR #180** (config.toml declares `revenuecat-sync`, `delete-account`).


## Done

- BE-41 merged (#175). BE-48c merged (#173). BE-47b + BE-48b merged (#162). BE-47 merged (#160). BE-48 merged (#156). BE-46 merged (#154). BE-40 merged (#149). BE-39 merged (#140). BE-38 merged (#135).
- BE-37 merged (#130). BE-36 merged (#129), superseded by BE-46. BE-11 #123 and BE-17 #125 merged.

## Next

- After BE-49 merges: confirm `revenuecat-sync` and `delete-account` in bonded-dev (`supabase functions list --project-ref nyqbrsqqalygydtwvybb`). After BE-42 merges: migration reaches dev via the main integration.
- BE-43 (voice caps/lifecycle), BE-44/45 (little things).
- Otherwise: BE-31 needs the PO's go; BE-22 needs milestone approval; BE-13 waits until after launch.

## Blocked

- bonded-dev function secrets need the PO: `REVENUECAT_WEBHOOK_SECRET`, `REVENUECAT_REST_API_KEY`, `EXPO_ACCESS_TOKEN`, `INTERNAL_FUNCTION_SECRET` (must equal Vault `internal_function_secret`), optional `SENTRY_DSN`; set with `supabase secrets set --env-file supabase/functions/.env --project-ref nyqbrsqqalygydtwvybb` (keys in `supabase/functions/.env.example`; values never in the repo). Function deploys follow from BE-49's merge.
- BE-48 email half of the day-5 reminder waits on the PO's email provider (lead.md question).
- BE-31 needs the PO's go; BE-22 needs milestone approval; BE-13 waits until after launch. The partner ritual-time and J5 privacy decisions need the lead.

## Needs from

- Lead: review/merge #180 (BE-49, config only) and the BE-42 PR (merge order backend → mobile type follow-up, or together: the `app` job is red until mobile's change); mark D46 length part done (BE-41, merged) and storage part done (BE-42) once merged; LEAD-12 can copy the BE-42 §2 rows into ARCHITECTURE (voice storage); LEAD-12 can copy the §2/§8 wording. BE-48c done (#173).
- Mobile (**BE-42 contract changed, ack needed in the PR**): `answers.body` and `thread_messages.body` are now `string | null` (null for voice); new columns `kind` (`text`|`voice`), `voice_path`, `voice_duration_ms`; new code `INVALID_VOICE` (add `errors.INVALID_VOICE` to en.json; tsc fails without it). Fix the 5 tsc errors listed in Resume here. Voice flow (MOB-55/56): upload to `voice/{couple_id}/{uid}/{uuid}.m4a` (upsert false), then upsert the row with `kind: 'voice', body: null, voice_path, voice_duration_ms`; switching back to text must send `kind: 'text', voice_path: null, voice_duration_ms: null`; partner playback via `createSignedUrl` (short TTL) only after reveal; Storage AccessDenied on upload = not Premium/not paired; delete discarded takes. BE-41 (merged): answers over the limit now raise `ANSWER_TOO_LONG` (P0001), not `23514`; `error.details` is the JSON string `{"max":500}` or `{"max":2000}` (`JSON.parse`). Cap input at 500 free / 2000 Premium (MOB-54 counter); keep mapping the server error (lapse between typing and sending). Re-sending unchanged long text after a lapse succeeds; any change must bring it to ≤ 500. Add `ANSWER_TOO_LONG` to `src/lib/errors.ts`. Still open: `settings.tipsBody` consent copy covering offers; `trial_ending`/`offer_ending` channels; v2 onboarding answers; `revenuecat-sync` call order.
- QA: QA-27 voice cases now testable (BE-42 part): partner denied before answering then allowed, other couple/anon denied, free upload denied, text+voice 23514, `INVALID_VOICE`, lapse keeps reads. Raw SQL joining `reactions` with `answers`/`thread_messages` must qualify `kind` (now ambiguous). Earlier: **`qa/contract/tables.test.ts` l.483–487** ("answers are 1–500 characters (BE-05, D11)"): the 501 case must expect `error.message === 'ANSWER_TOO_LONG'` (code `P0001`, `details` `'{"max":500}'`) instead of `23514` (empty stays `23514`), provided Maya's couple has no active entitlement in that fixture. CI `db-reset` is red on that one assertion until then. QA-27: add tier/lapse cases (premium 2000/2001 → `{"max":2000}`, lapse: 1800 readable, edit to 501 or 1700 rejected, unchanged re-send ok, edit down to 500 ok; pack answers same; other couple gets RLS error, not `ANSWER_TOO_LONG`). Earlier BE-47/48 items (offer_ending tips cases, 120/minute cap) still stand.
- Security (SEC-09): review BE-42 storage policies (reveal rule on objects via row RLS subquery, path regex/traversal, cross-row reuse → `INVALID_VOICE`, SECURITY DEFINER `private.voice_check_new` / `voice_object_referenced`, signed URL TTL left to the app). SEC-10: BE-48c/48b re-check if not done. BE-41 adds a SECURITY DEFINER trigger function (`private.answers_validate_length`, no grants); optional look.
- PO: set bonded-dev function secrets (list under Blocked). Deploys follow from BE-49's merge. Copy for `notifications.json` `offer_ending`/`trial_ending`; `tipsBody` wording; email provider for the day-5 email; `supabase/content/README.md` l.17 (position 1 free preview) is outdated under D51.
