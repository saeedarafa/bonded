# Accounts and credentials checklist (LEAD-03)

The **product owner** creates these and holds the credentials. Agents never create accounts, enter payment details or store secrets in the repo. Secrets go into EAS secrets, Supabase function secrets or Vault (CONTRACTS §7).

| # | Account / setup | Needed by | Milestone | Done |
|---|---|---|---|---|
| 0 | Dev machine: fix Xcode (`/usr/bin/git` and simulators fail: CoreDevice libs; reinstall Xcode or `sudo xcode-select -s /Library/Developer/CommandLineTools` for git only), Docker Desktop, Supabase CLI (`brew install supabase/tap/supabase`), Android Studio + an emulator, Maestro | everyone | M1 | ☐ |
| 1 | GitHub repo (private). No branch protection (PO 2026-11-02: stays private, no GitHub Pro); the lead merges only with green CI | everyone | M1 | ☑ |
| 2 | Supabase projects: **dev = `bonded-dev`, ref `nyqbrsqqalygydtwvybb`** (PO 2026-11-03; GitHub integration: auto-deploys migrations on every merge to `main`, working dir `.`, branching off; Site URL, redirect URLs, OTP 6 set; email templates: the PO's written answer says both `supabase/templates` were pasted, the earlier chat said skipped (custom SMTP, item 16), so BE-27's GET check records which. **Agents may link, push migrations, deploy functions and run tests against bonded-dev, test accounts only** (PO 2026-11-03)). **prod = `bonded`, ref `nciyrepyphvksusoigzx`**: GitHub disconnected 2026-11-03, but it had already received every migration on main through 20261103150000 (no users, no seed); agents never touch it; BE-22 deploys prod deliberately | backend | M1 | ☑ |
| 3 | Expo account + EAS project; `EXPO_TOKEN` for CI | mobile, QA | M1 | ☐ |
| 4 | Apple Developer Program; App ID from D30 (still open: `app.bonded.mobile` is a placeholder; can't change after the first upload); Sign in with Apple; push key (APNs) uploaded to EAS | mobile | M1 | ☐ |
| 5 | Google Play Console; app created; internal testing track; FCM credentials uploaded to EAS | mobile | M1 | ☐ |
| 6 | Google Cloud OAuth client ids (iOS, Android, web) for Google sign-in; configured in Supabase Auth | mobile, backend | M2 | ☐ |
| 7 | Email sign-in on the dev project (D35): Auth → Email Templates → Magic Link (and Confirm signup) contain both `{{ .Token }}` and a `{{ .ConfirmationURL }}` link (**PO 2026-11-03: template updated**); OTP length 6; Auth → URL Configuration allows `bonded://auth/callback`. Before launch: SMTP sender (Resend or Postmark) with a sending domain | backend | M2 | ☐ (template done; redirect check BE-27; SMTP open) |
| 8 | RevenueCat project; App Store + Play apps connected; entitlement `premium`; products `yearly_trial` (7-day trial) and `monthly`; offerings `default`, `intro`, `winback`; webhook to the `revenuecat` function | backend, mobile | M4 | ☐ |
| 9 | App Store Connect subscription group and products; Play subscriptions; sandbox and license testers | release | M4 | ☐ |
| 10 | Sentry org + projects (app, functions); PostHog project (EU or US region) | mobile, backend | M5 | ☐ |
| 11 | Domain `[your-domain]` (D30); static hosting for `/j/{code}`, AASA and `assetlinks.json` (LEAD-04) | lead | M3 | ☐ |
| 12 | Privacy policy, terms, and support email/URL live | release | M5 | ☐ |
| 13 | Two prod test accounts (a paired demo couple) for store review and RC checks | release | M6 | ☐ |
| 14 | Rive mascot file (D32): one state machine with the 6 moods, in `design-handoff/` | mobile (MOB-31) | M3 | ☐ |
| 15 | `bonded-prod` Auth: email confirmation on, captcha on sign-up (Cloudflare Turnstile or hCaptcha site key + secret) (D02, SEC-01 F1) | backend, mobile | M5 | ☐ |
| 16 | Custom SMTP for Supabase Auth email (provider e.g. Resend, Postmark, Amazon SES or Brevo; sending subdomain on the D30 domain with SPF/DKIM/DMARC). Set in `bonded-prod` → Authentication → Emails → SMTP Settings, then paste `supabase/templates/magic_link.html` + `confirmation.html` with their subjects (Supabase only allows template edits with custom SMTP). Not needed for `bonded-dev` (PO 2026-11-03): dev uses admin-generated codes for test accounts; email sign-in is tested on the local stack. SMTP password stays in Supabase + the PO's password manager | backend (verify), PO | M5 (before RC) | ☐ |
