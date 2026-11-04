# Bonded Edge Functions

BE-23 supplies authenticated stubs and the shared foundation. Feature work adds side effects in its
own task: notifications (BE-08), reminders (BE-19), RevenueCat (BE-18) and account deletion (BE-16).

## Local verification

```sh
deno lint supabase/functions
deno check supabase/functions/**/*.ts
deno test -A supabase/functions
```

## Secrets and deployment

Copy `.env.example` to `.env`, fill it locally, and never commit it. Supabase injects `SUPABASE_URL`
and `SUPABASE_SERVICE_ROLE_KEY`; set the remaining values with:

```sh
supabase secrets set --env-file supabase/functions/.env --project-ref "$DEV_REF"
supabase functions deploy notify daily-reminder revenuecat delete-account --project-ref "$DEV_REF"
```

`notify` and `daily-reminder` verify `INTERNAL_FUNCTION_SECRET` themselves, and `revenuecat`
verifies `REVENUECAT_WEBHOOK_SECRET`; their `verify_jwt` settings therefore remain false. The
app-facing `delete-account` endpoint keeps Supabase JWT verification on and also validates the
Bearer token with Auth. Production deployment requires the lead's milestone approval.

## BE-19 daily reminders

Apply the daily-reminders migration and deploy `daily-reminder` to the named dev project. Vault
`functions_url` is the Supabase project base URL (the dispatcher appends
`/functions/v1/daily-reminder`); `internal_function_secret` must equal the function's
`INTERNAL_FUNCTION_SECRET`. The migration registers `daily-reminders-quarter-hour` (`*/15 * * * *`)
where pg_cron is available; dispatch is a safe no-op without Vault/pg_net. Production still needs
lead milestone approval.

For a dev smoke test, use fixture principals with tokens, an active couple and today's question.
Choose a ritual time in the current 15-minute window outside quiet hours. Invoke `daily-reminder`
with the internal bearer secret; invoke it again and verify `{sent:0}` plus one reminder ledger row
per recipient/date/type. Test last call at 22:30 couple-local with a live streak of 3+, and verify
`channelId`/`data.type` and `bonded://today` on a dev device. Never log headers/tokens or payload
copy. The request body cannot override the clock. Deterministic tests use `due_reminders(p_now)`
locally.

The service-only RPC makes its selection and both ledger claims in one transaction. All reminder and
event pushes share the recipient advisory lock and four/day cap. No token and unknown Expo outcomes
keep the reminder claim: retrying must not duplicate a push; a crash may lose a reminder. Do not
delete ledger claims to retry uncertain delivery. DST fall-back hours dedupe; nonexistent
spring-forward ritual times are skipped. Weekly recaps remain BE-14. Hosted cron/device delivery is
pending deployment to bonded-dev (`nyqbrsqqalygydtwvybb`) and PO configuration of the function
secret and Vault values above; local SQL/Deno checks do not claim deployment.

## BE-20b invite preview avatars

`invite-preview` is public before sign-in, but requires the unguessable invite-link token in a POST
JSON body `{p_code, p_token}`. Its SQL exchange is service-role only, checks the token and active
solo inviter state, and returns only the minimal preview plus the canonical object path. It never
signs arbitrary profile URLs or caller-selected objects. The `avatars` bucket stays private and
existing RLS policies stay unchanged. SQL `invite_preview` continues returning null for the avatar;
mobile opts into this Edge endpoint for links only, with initials as fallback.

Deploy the migration through the reviewed main integration before deploying this function to
`bonded-dev` (`nyqbrsqqalygydtwvybb`):

```sh
supabase functions deploy invite-preview --project-ref nyqbrsqqalygydtwvybb
```

No new secrets: Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the function.
`verify_jwt = false` intentionally allows the pre-sign-in flow; SQL validates the link capability
before any profile data or avatar signing. Invalid states share a 401 response without identity
fields. POST only, body ≤1024 bytes, `Cache-Control: no-store`, no request/response logging.

The signed URL TTL is at most 60 seconds, shortened to remaining full invite seconds at the Edge
check. Later token checks reject revocation/pairing; an in-flight exchange or existing bearer URL
remains bounded by the short signing TTL. Missing avatar, deletion during signing or Storage errors
return the usual null avatar. Do not log, persist or share tokens or signed URLs. Never send them in
query parameters to this function. Real URL-expiry/device validation on dev follows security review
and deployment: use a dummy inviter/avatar and link, read the signed URL immediately, then verify
rejection after its TTL; revoked/used/expired/wrong/missing tokens must never yield a new URL. Do
not use prod.

Focused local checks:

```sh
node supabase/tests/invite-avatar.test.mjs
deno test -A --config supabase/functions/deno.json supabase/functions/invite-preview
```
