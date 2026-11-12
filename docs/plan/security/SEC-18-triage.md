# SEC-18: gitleaks and Semgrep triage

Date: 2026-11-12. Reviewer: security. Mode: focused guidance (source and git history only; no
target code was run). Base: `origin/main` at `f00b5b7`; Semgrep rules from `qa/QA-44-semgrep`
at `0bdabbf` (the rules file is the same as at `b46c461`).

**Result: no real secret in the git history.** Nothing needs rotating. All 4 gitleaks values
are fixtures or a public local-only default key. Both Semgrep findings are intended,
read-only catalogue policies.

## Tools and limits

- The native `gitleaks` and `semgrep` binaries are not installed on this Mac, and Docker is off
  (host load). Installing them was out of scope for this task. So:
  - gitleaks: I checked QA's 4 values myself in the full history (`git log --all -p`, 2068
    commits). I also ran my own pattern sweep over the whole history for Supabase secret keys
    (`sb_secret_`), JWTs, RevenueCat secret keys (`sk_`), PostHog keys, private keys, AWS,
    GitHub, Slack, Google API keys, Sentry DSNs, Expo tokens and Stripe live keys. The only hit
    was the publishable key in finding G1.
  - Semgrep: I re-ran the 4 `qa/semgrep/bonded-sql.yml` regexes over all 67 `.sql` files (the
    same regexes, in Python). The result matches QA: 2 WARNING, 0 ERROR. I could not re-run the
    OSS registry rules (`p/typescript`, `p/javascript`, `p/react`, `p/nodejs`), so for those I
    rely on QA's full local run: 0 findings, plus 3 timeouts in `src/__tests__/routes.test.tsx`.
- **needs_validation (QA):** `.gitleaks.toml` has not been run yet. Please run
  `SCAN_BASE=--all bash qa/ci/gitleaks.sh` once with gitleaks 8.30.1 and confirm 0 findings.
  If a value is still reported, gitleaks extracted a different "secret" string than the
  anchored regex expects. Send the redacted line to security, and I will adjust the entry.

## gitleaks (QA-43, full history: 19 hits, 4 distinct values, all `generic-api-key`)

| # | Path | Value (kind) | Commits | Verdict | Reason |
|---|---|---|---|---|---|
| G1 | `.env.example:3` | Supabase **local** publishable key (`sb_publishable_…`, 46 chars) | 5 (2026-11-03 to 11-11); empty on main since `14972e0` | **Dismiss: public default** | Byte-identical to the Supabase CLI's built-in local default (I found the same string 2 times inside the installed `supabase` CLI binary). Every `supabase start` uses it. It only works against a local stack on 127.0.0.1. It is not a bonded-dev or production key. No `sb_secret_`, service_role JWT or other JWT appears anywhere in the history. |
| G2 | `src/features/auth/__tests__/pendingInvite.test.ts:24` | synthetic invite token (`A1b2C3…`) | 12 | **Dismiss: test fixture** | A made-up alternating pattern used to test `parseInviteToken` format checks. Real invite tokens are random, single-use and stored server-side. |
| G3 | `qa/app/purchases.test.tsx:127` | fake RevenueCat iOS SDK key (`appl_fixture_qa06`) | 1 | **Dismiss: test fixture** | Not a real key ("fixture" is in the value). RevenueCat SDK keys are public by design anyway (`EXPO_PUBLIC_*`). |
| G4 | `supabase/tests/pack-notify.test.mjs:32` | fake `internal_function_secret` (`FIXTURE-BE39-SECRET`) | 1 | **Dismiss: test fixture** | Written into a PGlite stub of `vault.decrypted_secrets` in a DB test. It is never a Vault value of a real project. |

**Allowlist:** `.gitleaks.toml` at the repo root. It extends the default rules, and each of
the 4 entries is limited three ways: the `generic-api-key` rule, the exact path, and the exact
anchored value (`condition = "AND"`). A real key in the same file, or the same value in
another file, is still reported.

## Semgrep CE (QA-44 first full run: 617 files, 78 rules; 2 WARNING, 0 ERROR)

| # | Rule | Location | Table | Verdict | Reason |
|---|---|---|---|---|---|
| S1 | `bonded-sql-policy-using-true` | `supabase/migrations/0001_mvp.sql:392` | `public.pack_questions` (pack id, question id, position) | **Dismiss: intended** | The policy is `for select to authenticated` only. The pack→question map is the pack catalogue, read through `question_packs` (CONTRACTS §2 "Packs"). It holds no user data. The question **text** stays behind the `questions` policy `using (active)`, and pack metadata stays behind `question_packs` `using (active)`. RLS is on, and there is no INSERT, UPDATE or DELETE policy for any role, so clients cannot write (only service_role, which bypasses RLS, through the content loader). anon has no policy, so anon is denied. |
| S2 | `bonded-sql-policy-using-true` | `supabase/migrations/20261102250000_badges.sql:16` | `public.badges` (badge catalogue: slug, kind, threshold, title, description, status) | **Dismiss: intended** | This is the authenticated catalogue in CONTRACTS §2 "Badges" (BE-12 change log, 2026-11-02). It holds no user data; awards live in `badge_awards`, which has per-couple and per-user policies. The policy is `for select to authenticated` only. RLS is on, there is no write policy, and `revoke all ... from anon` is applied. |

Info (no action needed before launch): S1 also lets a signed-in user list the
`(pack_id, question_id, position)` rows of **inactive** packs (ids only, no text). A later
migration could tighten it to
`using (exists (select 1 from public.question_packs p where p.id = pack_id and p.active))`.
This is optional (backend).

Other checks of the custom SQL rules (all 0, confirmed): `bonded-sql-rls-disabled`,
`bonded-sql-grant-write-to-anon` and `bonded-sql-security-definer-without-search-path`. The
search_path rule only checks functions whose `security definer` comes **before** the `$$` body.
So I separately parsed all 185 `security definer` functions in `supabase/**/*.sql`, with the
bodies stripped: every one sets `search_path`.

## Semgrep ignore list (accepted findings)

Do not add `nosemgrep` comments to these lines and do not add `.semgrepignore` entries for them.
They are in **applied migrations**, which must not be edited, and CI scans only changed files,
so these lines are not scanned again unless someone edits the file. When a full run
(`SCAN_BASE=--all`) reports them, compare against this table:

| Rule | Path:line | Reason | Accepted |
|---|---|---|---|
| `bonded-sql-policy-using-true` | `supabase/migrations/0001_mvp.sql:392` | Read-only catalogue map for authenticated users; no write policy (S1) | SEC-18, 2026-11-12 |
| `bonded-sql-policy-using-true` | `supabase/migrations/20261102250000_badges.sql:16` | Read-only badge catalogue for authenticated users; anon revoked; no write policy (S2) | SEC-18, 2026-11-12 |

New `using (true)` or `with check (true)` policies in **new** migrations are a security review
item. A `with check (true)` on an INSERT or UPDATE policy is never accepted without a review.
Note for QA: the custom SQL rules miss functions written body-first (`as $$…$$ … security
definer`). To cover them, the rule could also match `$$ … security definer` without
`search_path` before the closing `;`.
