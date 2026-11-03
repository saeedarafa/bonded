# Product owner answers

Write answers to the agents' questions here, one bullet each: what was asked, then your decision. The lead reads this file at the start of every run, applies each new answer (DESIGN_DELTA, BACKLOG, tells the roles), then moves it under "Applied" with the date.

To see what's being asked: `~/dev/bonded-tools/needs-you.sh`

## New
- 

## Applied
- 2026-11-03 · Email sign-in (MOB-08, QA bug #28): I updated the sign-in email on the Supabase dev project so it now contains **both** the 6-digit code and a sign-in link. Decision: the code stays the primary way in (the app already verifies it); the link is a convenience. Please:
  1. Backend: copy that email template into the repo (`supabase/templates/` plus `[auth.email.template.magic_link]` and `confirmation` in `supabase/config.toml`) so the local stack sends the same email, and close #28. Check that the dev project's Site URL and redirect URLs allow the app scheme (`bonded://`).
  2. Mobile: make tapping the link sign the user in (deep link → `verifyOtp` with the token hash, or exchange the code), or tell me if the link should be removed instead.
  3. QA: drop the `fetch-otp` fallback once #28 is closed; add a check that the email contains a 6-digit code.
  4. Lead: record it in DESIGN_DELTA and CONTRACTS (auth), update ACCOUNTS item 7, and tell every role.
  → Applied by lead 2026-11-03: DESIGN_DELTA D35, CONTRACTS §10, ACCOUNTS 7, BACKLOG BE-27 / MOB-08 / QA-11; PR #44 (closes #28).
