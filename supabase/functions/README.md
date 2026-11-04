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

## BE-18 RevenueCat webhook

The function verifies `Bearer REVENUECAT_WEBHOOK_SECRET` before reading the body or creating a
service client. Configure that exact Authorization value in RevenueCat, and target
`https://nyqbrsqqalygydtwvybb.supabase.co/functions/v1/revenuecat` for sandbox tests only. Keep
production disconnected until BE-22/lead approval. Apply the reviewed migration through main before
deploying `revenuecat`; migration order is #64 (170000), #69 (180000), then BE-18 (190000).

Set `REVENUECAT_REST_API_KEY` as a function secret too. Every supported event refreshes the
canonical v1 subscriber `premium` entitlement from RevenueCat's fixed host. This keeps cancellation,
grace, deferred product changes and overlapping subscriptions accurate: an old product's expiration
must not revoke another active premium product. TRANSFER refreshes every UUID alias in both lists,
including sources that might retain another subscription. Missing key, lookup failure or malformed
subscriber response returns a fixed 500 before any database write, allowing a retry. Anonymous IDs
are ignored; ordinary events use only the Supabase UUID `app_user_id`, never an alias to associate
an anonymous purchase with another account.

Supported ordinary events are INITIAL_PURCHASE, RENEWAL, PRODUCT_CHANGE, UNCANCELLATION,
NON_RENEWING_PURCHASE, CANCELLATION, BILLING_ISSUE and EXPIRATION, for entitlement `premium` only.
An absent entitlement becomes inactive. Effective expiry is the later of paid `expires_date` and
canonical `grace_period_expires_date` (entitlement, or matching subscription fallback); it is written
to `expires_at` so SQL access stays active during grace and stops exactly at its end. Clearing grace
on renewal uses the new paid expiry; lifetime expiry stays null. Malformed grace retries with 500.
Unknown
event types/unrelated entitlements return 200 without writes. Never log request bodies, headers,
REST responses or receipts. The current projection is the `premium` entitlement only.

`apply_revenuecat_event` is service-only. It serializes entitlement mutations, records an event ID
once, ignores equal/older per-user timestamps, updates all transfer users in one transaction, and
dispatches at most one `partner_premium` event when an active couple becomes premium. Failures roll
back the event claim and all writes. Missing/deleted profiles are skipped (never recreated). A
same-couple transfer/renewal does not manufacture another activation. The private event ledger keeps
only IDs/timestamps, never subscriber data. Existing `notify` claims enforce quiet hours, four/day
and one premium push/day; delivery uses the content template and opens `bonded://packs`. Missing
Vault/notify setup means no push; event state still commits. Unknown push outcomes are not replayed
by resending the purchase event.

Use `qa/fixtures/revenuecat-events.json` locally with an injected admin client and fake REST service;
these tests never call RevenueCat or Expo. For hosted acceptance after secrets/deployment, use only
fixture users and sandbox purchases. Replay the same event with RevenueCat dashboard **Retry** and
verify one entitlement row, unchanged timestamp on duplicates, one premium dispatch/push at most,
then replay an older EXPIRATION after a newer RENEWAL and verify it cannot revoke access. Validate
source/target state for a transfer and deletion before delivery. Do not print the bearer secret or
full webhook to a terminal; enter it through the dashboard/secret manager. Mobile MOB-19 must refetch
entitlements on foreground/purchase/restore and after the premium push; realtime publication is
unchanged until a subscriber is implemented.

Source reference: [RevenueCat event fields](https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields)
and [webhook retries/subscriber refresh](https://www.revenuecat.com/docs/integrations/webhooks),
[grace periods](https://www.revenuecat.com/docs/subscription-guidance/how-grace-periods-work), and
[subscriber schema](https://www.revenuecat.com/docs/api-v1/customer-info-model).
