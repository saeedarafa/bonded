# BE-27 hosted Auth verification

Checked 2026-11-04 against **bonded-dev**, project `nyqbrsqqalygydtwvybb`.
This is a partial read-only check; BE-27 hosted acceptance remains open.
The lead accepted this report as a documentation handoff on 2026-11-05;
that acceptance does not establish hosted HTML parity or device email delivery.

| Setting | Hosted result | Assessment |
|---|---|---|
| Site URL | `http://localhost:3000` | Differs from local `bonded://`; lead/PO must confirm the intended hosted default redirect. |
| Additional redirect URLs | `bonded://auth/callback`, `bonded://**`, `exp://127.0.0.1:8081/--/**`, `exp://localhost:8081/--/**` | Explicit app callback is allow-listed. |
| Email OTP length | `6` | Matches local configuration and D35. |
| Email confirmations | enabled | Differs from local development (`false`); recorded, not changed. |
| Magic-link subject | `Your sign-in link` | Differs from local `Sign in to Bonded`. A subject difference does not establish a body difference. |
| Confirmation subject | `Confirm your email address` | Differs from local `Confirm your email for Bonded`. |
| Magic-link and confirmation bodies | Not verified | CLI config pull exposes subjects but did not retrieve the HTML template files. It cannot establish token/link presence or body parity. |

## Evidence and repeatable procedure

Used the repository-pinned Supabase CLI 3.0.0 with Node 24. The CLI can authenticate
in this environment without `SUPABASE_ACCESS_TOKEN` being exported. Do not infer
that hosted access is unavailable solely from an absent environment variable.

Read the target explicitly, never the linked/default project:

```sh
export SUPABASE_HOME=/private/tmp/bonded-cli-resume
export SUPABASE_TELEMETRY_DISABLED=1
umask 077
supabase/tests/node_modules/.bin/supabase config pull \
  --remote=nyqbrsqqalygydtwvybb --dry-run \
  > /private/tmp/bonded-be27-hosted-config.log 2>&1
```

The structured result confirmed `dry_run: true`, `wrote: false`, all six comparison
scopes present, and the setting differences above. Redirect URLs and email OTP
length were compared without differences. A subsequent pull into a scratch-only
copy of `supabase/config.toml` confirmed the resulting values. A second scratch
copy with no template files confirmed that config pull does not download them.
No repository configuration or hosted settings were changed. No production
endpoint, Auth user, email delivery, database write or test account was used.
Raw CLI output stays outside the repository; this report contains only selected
non-secret configuration facts.

## Remaining acceptance

Read only the dev Auth configuration through an authorized Management API GET or
an approved dashboard session. Compare both HTML bodies with
`supabase/templates/{magic_link,confirmation}.html`; verify both the visible
six-digit `{{ .Token }}` and tappable `{{ .ConfirmationURL }}` link. Do not infer
body parity from the subjects or the retained local `content_path` values.
Dashboard access was attempted, but the browser host was unavailable and Safari
access was rejected by automatic approval review. No login or credential change
was attempted. A direct credential lookup timed out; do not wait for an unattended
keychain prompt or print credentials.

Lead/PO must decide whether to replace the hosted localhost Site URL. This task
specifies GET-only verification, so any hosted correction needs its own explicit
authorization. SMTP, dummy-account email/PKCE acceptance on iOS/Android and actual
device delivery remain separate checks. Never probe production.

## Lead disposition (2026-11-05)

The lead reviewed PR #102 at `531c61e` and requested that this documentation-only
report be marked ready when finished; no security review is required for it.
Hosted settings remain dashboard work for the PO. The Site URL still needs the
PO's intended app redirect. Both subject differences remain recorded; leave the
dev templates as they are while custom SMTP (ACCOUNTS 16) is unavailable.
Neither instruction verifies either HTML body. Callback allow-list and OTP6 are
confirmed; template bodies and real email/PKCE delivery remain open acceptance
items for the PO/QA/release handoff above.
