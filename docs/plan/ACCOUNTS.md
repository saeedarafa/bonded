# Accounts and credentials checklist (LEAD-03)

The **product owner** creates these and holds the credentials. Agents never create accounts, enter payment details or store secrets in the repo. Secrets go into EAS secrets, Supabase function secrets or Vault (CONTRACTS §7).

| # | Account / setup | Needed by | Milestone | Done |
|---|---|---|---|---|
| 1 | GitHub repo (private), branch protection on `main` | everyone | M1 | ☐ |
| 2 | Supabase projects `bonded-dev` and `bonded-prod` (region close to users); share project refs with the lead | backend | M1 | ☐ |
| 3 | Expo account + EAS project; `EXPO_TOKEN` for CI | mobile, QA | M1 | ☐ |
| 4 | Apple Developer Program; App ID `app.bonded.mobile` (D30); Sign in with Apple; push key (APNs) uploaded to EAS | mobile | M1 | ☐ |
| 5 | Google Play Console; app created; internal testing track; FCM credentials uploaded to EAS | mobile | M1 | ☐ |
| 6 | Google Cloud OAuth client ids (iOS, Android, web) for Google sign-in; configured in Supabase Auth | mobile, backend | M2 | ☐ |
| 7 | Email OTP sender (Supabase SMTP: Resend or Postmark) with a sending domain | backend | M2 | ☐ |
| 8 | RevenueCat project; App Store + Play apps connected; entitlement `premium`; products `yearly_trial` (7-day trial) and `monthly`; offerings `default`, `intro`, `winback`; webhook to the `revenuecat` function | backend, mobile | M4 | ☐ |
| 9 | App Store Connect subscription group and products; Play subscriptions; sandbox and license testers | release | M4 | ☐ |
| 10 | Sentry org + projects (app, functions); PostHog project (EU or US region) | mobile, backend | M5 | ☐ |
| 11 | Domain `[your-domain]`; static hosting for `/j/{code}`, AASA and `assetlinks.json` (LEAD-04) | lead | M3 | ☐ |
| 12 | Privacy policy, terms, and support email/URL live | release | M5 | ☐ |
| 13 | Two prod test accounts (a paired demo couple) for store review and RC checks | release | M6 | ☐ |
