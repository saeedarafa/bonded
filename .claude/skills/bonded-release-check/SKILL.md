---
name: bonded-release-check
description: Validate a Bonded release-candidate build on iOS and Android and write a GO/NO-GO report. Covers build identity, the RC checklist areas (functional, UI, business, iOS, Android, accessibility, privacy, store, hygiene), evidence rules, and store-submission requirements. Use for any RC, TestFlight/Play promotion, or store submission check.
---

# Bonded release check

## 1. Inputs
- Build: version, build number, commit SHA, EAS profile and channel, backend (`dev` or `prod`), RevenueCat environment.
- `qa/release/RC_CHECKLIST.md` (hand-written checks), `qa/release/screen-requirements.csv` (one row per P0/P1 screen requirement), `docs/plan/SCOPE.md` (what's in this release), and the latest `docs/plan/status/qa.md` (automated results, open bugs).
- Test accounts: personas from `qa/fixtures/personas.json` on `dev`/staging; PO-provided test accounts on prod. Sandbox purchasers: Apple sandbox testers, Google license testers.

## 2. Procedure
1. Copy `qa/release/reports/TEMPLATE.md` to `qa/release/reports/<version>-<build>.md` and fill in the build identity.
2. Scope: include every P0 row (and P1 rows that shipped) for the screens in SCOPE.md. Rows for features not in the build are `n/a`, and the paywall must not advertise them (BIZ-03).
3. For each check, on **iOS and Android separately**:
   - result: `pass`, `fail`, `blocked` or `n/a`;
   - evidence: a screenshot path under `qa/release/evidence/<build>/`, a test-run id, or a log excerpt (never answer or message text);
   - device and OS version.
4. Reuse QA's automated evidence when it ran on this commit, and cite the run. Always check by hand what depends on real devices, OS dialogs, stores and push delivery.
5. File each failure as a GitHub issue (QA format) and link it.
6. Decide:
   - **NO-GO** if any P0 check fails, any sev-1/2 bug is open, the reveal rule fails, a store-policy check fails, or a P0 check has no evidence.
   - **GO** otherwise; list residual risks.

## 3. Platform specifics to never skip
**iOS**
- Sign in with Apple is offered wherever Google sign-in is.
- The push permission is asked only after the soft ask (09/J6).
- Universal links open J3 with the code, on cold and warm starts.
- `PrivacyInfo.xcprivacy` is present; required-reason APIs are declared.
- Background, kill and relaunch keep the session and drafts.
- Restore purchases is visible on the paywall; manage subscription links to App Store settings.
- No private APIs; ATT prompt only if tracking (it shouldn't be).

**Android**
- System back and predictive back on every screen and sheet; back from Today doesn't loop.
- `POST_NOTIFICATIONS` runtime permission (Android 13+); notification channels per push type.
- App links are verified (`assetlinks.json`); edge-to-edge layout with no clipped content.
- Process death restores state; target SDK meets the current Play requirement.
- Play Billing through RevenueCat; the subscription centre deep link works.

## 4. Store-submission checks
- **Account deletion** inside the app (43), reachable without contacting support. The App Store and Play both require this, and Play also requires a web deletion URL.
- **Privacy:** App Store privacy labels and the Play Data safety form match actual data flows (Supabase, RevenueCat, Sentry, PostHog, Expo push). Privacy policy and terms URLs are live.
- **Age rating:** the questionnaire answered honestly. The "Spicy · 18+" pack may require a mature rating; confirm with the PO.
- **Subscriptions:**
  - price, period and trial shown before purchase;
  - auto-renew terms and cancellation text;
  - "covers you both" is accurate;
  - restore works.
- **Review notes:** a demo couple (two accounts, already paired, with today's question unanswered by one partner) and how to see the reveal.
- **Screenshots and listing** match the build (60, 61, 62); no fake ratings, reviews or awards (D31).

## 5. Report template (keep it in `qa/release/reports/TEMPLATE.md`)
Sections:
1. Build identity
2. Scope
3. Summary table (area × platform: pass/fail/blocked counts)
4. Failed checks (with issue links)
5. Blocked checks (with reason)
6. Evidence index
7. Residual risks
8. Decision: GO / NO-GO, with the rule that decided it

Signed by the release validator and timestamped.
