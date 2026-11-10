# Backend / data developer status

Updated: 2026-11-11 · Branch: `be/BE-46-no-free-packs` · Task: BE-46 (D51 no free pack questions)

## Resume here

- Last AI / date: Claude Code · 2026-11-11.
- Branch `be/BE-46-no-free-packs` from origin/main `87f3e3f`. Work commit `c77114e` plus this status commit. PR: see "Doing". Uncommitted work: none.
- Migration `supabase/migrations/20261111090000_no_free_pack_questions.sql` replaces `start_pack_question`: availability check unchanged (`QUESTION_UNAVAILABLE` first); then **if the couple already has a row for the question, return it** (D43-started rows, rows started while Premium, the partner opening the same row via MOB-49); otherwise `PREMIUM_REQUIRED` unless `private.is_couple_premium`. The pack's `is_premium = false` no longer grants access (D51 "a free couple can start no pack question"; all content packs are premium anyway). No data removed; answer/reveal/thread paths untouched. Signature unchanged, so types unchanged (`gen-types --check` green).
- Tests: new `supabase/tests/no-free-packs.test.mjs` 30/30 (free couple denied on positions 1 and 2, partner, solo, expired, `is_premium=false` pack; no row created; error order; premium allowed on all, idempotent; D43 row replayed: returned to the partner, answered by both, reveal rule, edit, thread; lapsed Premium row; auth/anon/isolation; hygiene). Removed `free-pack-question.test.mjs` (BE-36 D43 assertions, now wrong). `pack-notify.test.mjs` couple is now Premium; D43 comments fixed in `rls`/`error-codes` tests.
- Checks green: `npm --prefix supabase/tests test` exit 0 (1580 PASS, reveal rule included), `bash qa/ci/functions.sh`, gen-types/seed/plan/sync `--check`. New function compiled in a rolled-back transaction on the local Postgres (`supabase_db_bonded`). **`supabase db reset` not run**: the only local stacks are shared (`bonded`, port 54322) or another worktree's (`bonded_backend_be11`); resetting would wipe other agents' local data. The CLI is linked to the PROD ref in that stack's status: never `db push` from here.
- Exact next step: wait for review/merge of the PR; QA-33 updates the contract fixtures (see Needs from); then BE-41.
- Commands: `export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH`; `node supabase/tests/no-free-packs.test.mjs`; `npm --prefix supabase/tests test`; `node supabase/tests/gen-types.mjs --check`; `npm --prefix supabase/tests run -s seed:check`; `bash qa/ci/functions.sh`.
- Dev only `nyqbrsqqalygydtwvybb`; never prod. Hooks `.githooks`; no AI attribution.

## Doing

- BE-46: PR open (behaviour-breaking for free couples; needs QA-33 and MOB-63 acks).

## Done

- BE-40 merged (#149). BE-39 merged (#140). BE-38 merged (#135).
- BE-37 merged (#130). BE-36 merged (#129), now superseded by BE-46. BE-11 #123 and BE-17 #125 merged.

## Next

- BE-41 (D46 answer length by Premium), then BE-42/43 (voice), BE-44/45 (little things), BE-47/48.
- Otherwise: BE-31 needs the PO's go; BE-22 needs milestone approval; BE-13 waits until after launch.

## Blocked

- BE-31 needs the PO's go; BE-22 needs milestone approval; BE-13 waits until after launch. The D28, partner ritual-time and J5 privacy decisions need the lead.

## Needs from

- QA (QA-33): **contract changed (behaviour), BE-46**: a free couple gets `PREMIUM_REQUIRED` for every new pack question. These qa/ tests assume a free pack question and will fail: `qa/contract/rpc.test.ts` "starts a free-pack question; a retry returns the same row" (~l.257, `Q.free` without entitlement) and the whole describe "the first question of each pack is free (D43, BE-36)" (~l.297-395: q1 starts, expired keeps q1 free, "first ACTIVE question" free, other couple starts `Q.premiumFirst`); `qa/contract/tables.test.ts` "thread › stays closed until both answered" (~l.406) and the reveal-rule reaction test (~l.697), which start `Q.free` as a free maya/sam couple; `qa/contract/helpers.ts` l.325-329 comments (`premiumFirst` "free (D43)"). Fix: entitle a member (or insert the `couple_questions` row with admin) where the test needs a pack row, and turn the D43 describe into D51 cases (positions 1 and 2 denied, premium allowed, an existing row is returned and stays answerable). Unaffected: `rpc.test.ts` anon/NOT_AUTHENTICATED/NOT_PAIRED cases with `Q.free` (checked before premium), `ended-couples.test.ts` NOT_PAIRED, `purchases.test.ts` (asserts `PREMIUM_REQUIRED` on `Q.premium`). E2E: `qa/e2e/run-daily.ts` `pack` scenario and `.maestro/daily/pack-answer-first.yaml`/`-second.yaml` start the "free first question" of `gratitude` as `free-couple-packs` and will hit the paywall; use `premium-couple` or pre-start the row. Docs: `qa/fixtures/personas.json` `free-couple-packs.check`, `qa/TEST_PLAN.md` §D43 rows, `qa/e2e/README.md` `pack` row.
- Mobile (MOB-63): **contract changed (behaviour), BE-46**: `start_pack_question` returns `PREMIUM_REQUIRED` for any pack question a free couple has not started; a question the couple already started (D43 rows) is still returned, so `startPackQuestion` keeps opening it. No type or code change. Please ack in the PR.
- Lead: mark D51 backend part done (BE-46) when merged.
- PO: `supabase/content/README.md` l.17 says "Position 1 is the free preview (always `is_premium=false`)", which is no longer true under D51 (your file).

