# Backend / data developer status

Updated: 2026-11-11 · Branch: `be/BE-49-function-config` · Task: BE-49 (then BE-42)

## Resume here

- Last AI / date: Claude Code · 2026-11-11.
- Worktree `~/dev/bonded-be`. Branch `be/BE-49-function-config` from origin/main `c02e915`; `[BE-49]` commit; pushed; PR open (see Doing). Uncommitted work: none.
- BE-49: `supabase/config.toml` now declares `[functions.revenuecat-sync]` and `[functions.delete-account]`, both `verify_jwt = true` (app-facing; each also re-validates the Bearer token with Auth through `requireUser`). The other four stay `verify_jwt = false` (own secret / link capability). New static test `supabase/tests/function-config.test.mjs` (8/8, in `npm test`): every `supabase/functions/<dir>/index.ts` is declared and each `verify_jwt` matches. After merge the main integration deploys both functions to bonded-dev; nothing deployed by me.
- **bonded-dev secrets still missing** (checked 2026-11-11; only Supabase defaults are set). The PO sets them with `supabase secrets set --env-file supabase/functions/.env --project-ref nyqbrsqqalygydtwvybb` (keys listed in `supabase/functions/.env.example`, values never in the repo): `REVENUECAT_WEBHOOK_SECRET` (revenuecat webhook; must match the Authorization header configured in the RevenueCat dashboard), `REVENUECAT_REST_API_KEY` (revenuecat + revenuecat-sync subscriber lookups), `EXPO_ACCESS_TOKEN` (notify push via Expo), `INTERNAL_FUNCTION_SECRET` (notify/daily-reminder; must equal Vault `internal_function_secret`), optional `SENTRY_DSN`. Without them `revenuecat-sync` answers 5xx and push does not send.
- Exact next step: BE-42 (voice storage) on `be/BE-42-voice-storage` from origin/main.
- Commands: `export PATH=/Users/saeedarafa/.nvm/versions/node/v24.22.2/bin:$PATH`; `node supabase/tests/function-config.test.mjs`; `npm --prefix supabase/tests test`.
- Gotchas: dev only, never prod. `supabase functions deploy` needs the user's consent in agent mode; the integration deploys on merge instead. Hooks `.githooks`; no AI attribution.

## Doing

- BE-49: config.toml declares `revenuecat-sync` and `delete-account` (PR "[BE-49] Declare revenuecat-sync and delete-account in config.toml").


## Done

- BE-41 merged (#175). BE-48c merged (#173). BE-47b + BE-48b merged (#162). BE-47 merged (#160). BE-48 merged (#156). BE-46 merged (#154). BE-40 merged (#149). BE-39 merged (#140). BE-38 merged (#135).
- BE-37 merged (#130). BE-36 merged (#129), superseded by BE-46. BE-11 #123 and BE-17 #125 merged.

## Next

- After BE-49 merges: confirm `revenuecat-sync` and `delete-account` appear in bonded-dev (`supabase functions list --project-ref nyqbrsqqalygydtwvybb`).
- BE-42/43 (voice), BE-44/45 (little things).
- Otherwise: BE-31 needs the PO's go; BE-22 needs milestone approval; BE-13 waits until after launch.

## Blocked

- Dev function secrets need the PO (list in Resume here). Function deploys come from the main integration once BE-49 merges.
- BE-48 email half of the day-5 reminder waits on the PO's email provider (lead.md question).
- BE-31 needs the PO's go; BE-22 needs milestone approval; BE-13 waits until after launch. The partner ritual-time and J5 privacy decisions need the lead.

## Needs from

- Lead: review and merge BE-49 (config only, no contract change); mark D46 length part done (BE-41, merged); LEAD-12 can copy the §2/§8 wording. BE-48c done (#173).
- Mobile (**contract changed, ack needed in the PR**): answers over the limit now raise `ANSWER_TOO_LONG` (P0001), not `23514`; `error.details` is the JSON string `{"max":500}` or `{"max":2000}` (`JSON.parse`). Cap input at 500 free / 2000 Premium (MOB-54 counter); keep mapping the server error (lapse between typing and sending). Re-sending unchanged long text after a lapse succeeds; any change must bring it to ≤ 500. Add `ANSWER_TOO_LONG` to `src/lib/errors.ts`. Still open: `settings.tipsBody` consent copy covering offers; `trial_ending`/`offer_ending` channels; v2 onboarding answers; `revenuecat-sync` call order.
- QA: **`qa/contract/tables.test.ts` l.483–487** ("answers are 1–500 characters (BE-05, D11)"): the 501 case must expect `error.message === 'ANSWER_TOO_LONG'` (code `P0001`, `details` `'{"max":500}'`) instead of `23514` (empty stays `23514`), provided Maya's couple has no active entitlement in that fixture. CI `db-reset` is red on that one assertion until then. QA-27: add tier/lapse cases (premium 2000/2001 → `{"max":2000}`, lapse: 1800 readable, edit to 501 or 1700 rejected, unchanged re-send ok, edit down to 500 ok; pack answers same; other couple gets RLS error, not `ANSWER_TOO_LONG`). Earlier BE-47/48 items (offer_ending tips cases, 120/minute cap) still stand.
- Security (SEC-10): BE-48c/48b re-check if not done. BE-41 adds a SECURITY DEFINER trigger function (`private.answers_validate_length`, no grants); optional look.
- PO: set bonded-dev function secrets (`REVENUECAT_WEBHOOK_SECRET`, `REVENUECAT_REST_API_KEY`, `EXPO_ACCESS_TOKEN`, `INTERNAL_FUNCTION_SECRET`, optional `SENTRY_DSN`; see Resume here). Deploys follow from BE-49's merge. Copy for `notifications.json` `offer_ending`/`trial_ending`; `tipsBody` wording; email provider for the day-5 email; `supabase/content/README.md` l.17 (position 1 free preview) is outdated under D51.
