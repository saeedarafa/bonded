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
