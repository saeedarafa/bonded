# Backend / data developer status

Updated: 2026-11-11 · Branch: `be/BE-40-emoji-reactions` · Task: BE-40 (D45 emoji reactions)

## Resume here

- Branch `be/BE-40-emoji-reactions` from origin/main `dae33c9`. Work commit `4a88364` plus this status commit. PR `[BE-40] Emoji reactions (D45)` (number in "Doing"). Uncommitted work: none.
- Migration `supabase/migrations/20261110180000_emoji_reactions.sql`: `error_code` += `INVALID_REACTION`; `private.is_emoji_base(int)`, `private.is_single_emoji(text)` (element (ZWJ element){0,4}; element = flag pair | keycap | base [FE0F | skin tone] [tag seq on 🏴]; ≤16 code points / 64 bytes; BMP = Emoji property list, SMP = Extended_Pictographic ranges so future emoji pass), `private.is_love_reaction(text)`; `reactions.kind` enum → text with love→❤️ laugh→😂 wow→😮 spark→🔥, enum dropped; BEFORE trigger (normalises bare ❤ to ❤️, raises `INVALID_REACTION`) + CHECK `reactions_kind_single_emoji` backstop; `hearts-given` personal award trigger (current ❤️ count ≥ catalogue threshold, once) + partial index.
- Gotcha: `authenticated` has no USAGE on schema `private`, so the validation trigger is SECURITY DEFINER (resolves private.* by name); the CHECK calls by OID and only needs EXECUTE (granted to authenticated, service_role). Hardening F12 requires `search_path = pg_catalog, extensions, public, pg_temp` on every SECURITY DEFINER function.
- Tests: new `supabase/tests/emoji-reactions.test.mjs` 111/111 (migration mapping replayed on pre-BE-40 rows, 27 valid / 35 invalid validator cases, app-path upsert/replace/delete, INVALID_REACTION on insert/upsert/update, CHECK with triggers off, RLS/anon/other couple/reveal rule, hearts badge); old-kind literals updated in content, rls, hardening, private-helpers, weekly-recap, seed tests; dev seed (`supabase/scripts/dev-seed.sql` → `seed.sql`) now uses emoji.
- Checks green: `npm --prefix supabase/tests test` exit 0 (reveal rule included), `bash qa/ci/functions.sh` ok, gen-types/seed/plan/sync `--check`. Not run: `supabase db reset` (no Docker stack here).
- App `tsc` after type regen: 9 new errors, all from `Enums['reaction_kind']` disappearing (list in "Needs from"); the app jest `errors.test.ts` will also fail (new code). **The PR cannot merge alone with CI green; merge with MOB-53.** (4 pre-existing local tsc errors = `react-native-purchases` missing from this worktree's node_modules; unrelated.)
- Exact next step: wait for the lead/mobile on merge order (MOB-53 branched from this branch, or a combined merge), QA-26 contract updates, SEC-09 glance at the validator. Then deploy to dev via main.
- Commands: `export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH`; `npm --prefix supabase/tests test`; `node supabase/tests/emoji-reactions.test.mjs`; `bash qa/ci/functions.sh`; `node supabase/tests/gen-types.mjs --check`; `npm --prefix supabase/tests run -s seed:check`; `node scripts/plan/generate.mjs --check`; `node scripts/agents/sync.mjs --check`. Fetch/push with `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' ...`.
- Dev only `nyqbrsqqalygydtwvybb`; never prod. No hosted writes. Hooks `.githooks`; no AI attribution.

## Doing

- BE-40: PR open; breaking contract change, waiting for mobile ack (MOB-53), QA-26, security (SEC-09) and the lead's merge-order call.
- BE-39: PR #140 merged.

## Done

- BE-39 merged (#140). BE-38 merged (#135).
- BE-37 merged (#130). BE-36 merged (#129). BE-11 #123 and BE-17 #125 merged.
- #100 recap and #122 consent vehicle merged/deployed per lead. Premium wording correction implemented; hosted Auth report accepted. Streak-context backend implemented/tested and source-reviewed.

## Next

- BE-41 (D46 answer length by Premium), then BE-42/43 (voice), BE-44/45 (little things).
- Otherwise: no other unblocked BE row (BE-31 needs the PO's go; BE-22 needs milestone approval; BE-13 waits until after launch).

## Blocked

- BE-31 needs the PO's go; BE-22 needs milestone approval; BE-13 waits until after launch. The D28, partner ritual-time and J5 privacy decisions need the lead.

## Needs from

- Mobile (MOB-53): **contract changed (breaking), BE-40**: `reactions.kind` is now one emoji string (no enum); old words are rejected with `INVALID_REACTION` (new error code, needs copy in `src/lib/errors.ts`/`en.json` and in `CONTRACT_CODES` of `src/lib/__tests__/errors.test.ts`); a bare ❤ comes back as ❤️; group counts by stored `kind`; same emoji again = delete own row. Please ack in the PR. `tsc` errors after the type regen: `src/features/daily/api.ts(42)` and `src/ui/components/ReactionPill.tsx(21)` (`Enums['reaction_kind']` gone) cascading into `RevealedScreen.tsx(119,125)`, `ThreadScreen.tsx(118,130)`, `ReactionPill.tsx(66,75,96)`.
- QA (QA-26): `qa/contract/tables.test.ts` (describe "reactions use a kind, not an emoji", lines ~507–630) and `qa/contract/ended-couples.test.ts` insert `love`/`laugh`/`wow`/`spark`, which now fail with `INVALID_REACTION`; switch to emoji and add the D45 cases (valid/invalid emoji, one per user, ❤️ counts as love). Any error-code list in `qa/contract/rpc.test.ts` gains `INVALID_REACTION`.
- Security (SEC-09): look at the validator (`private.is_single_emoji`) and the SECURITY DEFINER validation/award triggers.
- Lead: decide merge order with MOB-53 (types break app `tsc` until MOB-53); mark D45 backend part done; LEAD-12 change-log copy.
- PO: badge copy `hearts-given` says "25 reactions given." but D45 counts ❤️ only. Copy suggestion: "25 hearts given." (your file, `supabase/content/badges.csv`). `notifications.json` `single_reaction` body "{partner} loved your answer." is unused by `notify` (generic text) but would be wrong for non-❤️ reactions.
