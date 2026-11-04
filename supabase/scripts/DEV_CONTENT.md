# BE-32: bonded-dev content loading

`load-dev-content.mjs` loads questions, packs, pack membership and badges from the current checkout's
`supabase/content/*.csv`. It never imports `seed.sql`, personas, Auth users or scenario state. It
always excludes 18+ packs/questions (D33), including when `CONTENT_INCLUDE_AGE_GATED=true` is inherited.
Existing age-gated rows are deactivated by the shared loader. CSV ownership stays with the PO.

The destination is fixed to bonded-dev (`nyqbrsqqalygydtwvybb`); the script rejects every other ref
before making a request. It never reads a linked Supabase project or accepts a URL/SQL argument.
It uses `psql` with a **bonded-dev database password**, never an account-wide Management API token.
`SUPABASE_DEV_DB_URL` must identify either direct `db.nyqbrsqqalygydtwvybb.supabase.co:5432`
with user `postgres`, or a Supabase session pooler on port 5432 with user
`postgres.nyqbrsqqalygydtwvybb`. Database must be `postgres`; URL overrides, other hosts/users/ports,
and weaker TLS modes are rejected before starting psql. Copy the connection from bonded-dev's
Connect panel and percent-encode password characters. A production URL is rejected even when the
explicit project-ref variable says dev. Use a distinct dev database password, never reuse prod's.
See [Supabase connection formats](https://supabase.com/docs/guides/database/connecting-to-postgres). A transaction and advisory lock serialize content loads; all writes upsert
by natural key, preserving row IDs and timestamps on replay. It does not delete history or questions
removed from a CSV. This does not implement the proposed BE-31 `active` CSV field.

## QA workflow handoff (workflow files are QA-owned)

After #64 and #69 merge, wire a job for pushes to `main` and manual replays on `main` only:

- Check out the exact triggering main SHA. Do not run with PR code, `pull_request_target`, or a
  user-supplied ref. Give the job only `contents: read` GitHub permissions.
- Use a GitHub environment named `bonded-dev`. Store `SUPABASE_DEV_DB_URL` only as that environment's
  secret, containing **only bonded-dev's** database credential. Do not supply `SUPABASE_ACCESS_TOKEN`.
  A dev DB password cannot authenticate to the production DB. Restrict environment access to main.
  Never put credentials in arguments, repository variables, YAML literals or logs.
- Wait for the main migration deployment to **bonded-dev** to succeed before loading. A failed
  migration deployment must fail/skip loading, not fall back to production or an old deployment.
- Serialize runs with a dev-specific concurrency group and `cancel-in-progress: false`; load the
  newest main checkout when replaying. Immediately before loading, skip any triggering SHA that no
  longer equals main, so an older queued run cannot restore stale copy.
- Set `SUPABASE_PROJECT_REF=nyqbrsqqalygydtwvybb` explicitly. With Node 24 and `psql` (libpq 16+), run:

  ```sh
  node supabase/scripts/load-dev-content.mjs
  ```

No npm install or service-role key is needed. The credential is parsed from the environment and
passed only through the child environment, never process arguments. SQL goes through stdin;
psql stdout/stderr are discarded, and CLI errors are fixed codes. `-X` ignores local psqlrc;
`ON_ERROR_STOP` prevents committing a failed transaction. The child receives a minimal environment,
so inherited `PGSERVICE`, `PGOPTIONS` and `PGHOSTADDR` cannot redirect it. TLS is always
`verify-full`, using libpq's system trust store by default. If the dev certificate needs an explicit
CA, install its public root certificate and set `SUPABASE_DEV_DB_CA_FILE` to its absolute file path.
Never disable certificate or hostname verification. URL query options other than
`sslmode=verify-full` are rejected.

Connection timeout is 10 seconds, process timeout 60 seconds, SQL statement timeout 45 seconds and
lock timeout 10 seconds. A timeout may have committed: replay normally rather than clearing data.
A missing credential/psql or rejected connection fails closed. No hosted writes occur in unit tests.

## Acceptance still required

Local tests use PGlite and a stubbed process runner only. QA owns the workflow and the PO supplies its environment
secret. After a main merge, derive expected non-gated question/pack/membership/badge counts from the current
CSVs (`readContent({ includeAgeGated: false })`), verify them on bonded-dev, then replay and compare
all IDs/values. Confirm no new Auth users/profiles and no active
18+ content. Expected counts track PO copy changes; no fixed catalogue totals are assumed.
Never use production (`nciyrepyphvksusoigzx`). This script does not deploy migrations or functions.

Run `node supabase/tests/dev-content.test.mjs` for destination, redaction, D33 and replay coverage;
the standard DB suite includes it and retains the reveal-rule release blocker.
