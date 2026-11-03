# BE-32: bonded-dev content loading

`load-dev-content.mjs` loads questions, packs, pack membership and badges from the current checkout's
`supabase/content/*.csv`. It never imports `seed.sql`, personas, Auth users or scenario state. It
always excludes 18+ packs/questions (D33), including when `CONTENT_INCLUDE_AGE_GATED=true` is inherited.
Existing age-gated rows are deactivated by the shared loader. CSV ownership stays with the PO.

The destination is fixed to bonded-dev (`nyqbrsqqalygydtwvybb`); the script rejects every other ref
before making a request. It never reads a linked Supabase project or accepts a URL/SQL argument.
It uses the [Management query endpoint](https://supabase.com/docs/reference/api/v1-run-a-query),
with redirects disabled. A transaction and advisory lock serialize content loads; all writes upsert
by natural key, preserving row IDs and timestamps on replay. It does not delete history or questions
removed from a CSV. This does not implement the proposed BE-31 `active` CSV field.

## QA workflow handoff (workflow files are QA-owned)

After #64 and #69 merge, wire a job for pushes to `main` and manual replays on `main` only:

- Check out the exact triggering main SHA. Do not run with PR code, `pull_request_target`, or a
  user-supplied ref. Give the job only `contents: read` GitHub permissions.
- Use a GitHub environment named `bonded-dev`. Store `SUPABASE_ACCESS_TOKEN` only as that environment's
  secret; use a token restricted to the dev project with the database write permission where available.
  Never put credentials in arguments, repository variables, YAML literals or logs.
- Wait for the main migration deployment to **bonded-dev** to succeed before loading. A failed
  migration deployment must fail/skip loading, not fall back to production or an old deployment.
- Serialize runs with a dev-specific concurrency group and `cancel-in-progress: false`; load the
  newest main checkout when replaying. Immediately before loading, skip any triggering SHA that no
  longer equals main, so an older queued run cannot restore stale copy.
- Set `SUPABASE_PROJECT_REF=nyqbrsqqalygydtwvybb` explicitly. With Node 24, run:

  ```sh
  node supabase/scripts/load-dev-content.mjs
  ```

No npm install, database password or service-role key is required by the loader. The token is read
from the environment. Errors are fixed codes; response bodies, request headers and SQL are never
printed. A missing token fails closed. The request has a 60-second timeout; SQL statements have a
45-second timeout and a 10-second lock timeout. A timeout may have committed: replay normally rather
than clearing data. Treat an API success as a completed load, then verify catalogue counts on dev.
The Management query endpoint is experimental; a rejected call fails the job for operator review.

## Acceptance still required

Local tests use PGlite and stubbed HTTP only. QA owns the workflow and the PO supplies its environment
secret. After a main merge, verify 153 non-gated questions, 6 packs, 48 memberships and 15 badges on
bonded-dev, then replay and compare all IDs/values. Confirm no new Auth users/profiles and no active
18+ content. If copy changes, use the current CSV totals rather than the baseline counts above.
Never use production (`nciyrepyphvksusoigzx`). This script does not deploy migrations or functions.

Run `node supabase/tests/dev-content.test.mjs` for destination, redaction, D33 and replay coverage;
the standard DB suite includes it and retains the reveal-rule release blocker.
