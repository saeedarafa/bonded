# QA automation engineer status
Updated: 2026-11-03 · Branch: qa/QA-04b-answer-reveal-e2e · Milestone: M2

## Resume here
<!-- Keep this current after every step: the next AI (Claude, Codex or Copilot) starts from it. -->
- Last AI / date: Claude Code · 2026-11-03 (night). QA-04b run on two simulators; PR #23 open, body updated with results.
- Branch: `qa/QA-04b-answer-reveal-e2e` (origin/main 3d2899d merged in, aadc0d8). Pushed. Uncommitted: none. `ios/` (prebuild + Pods + `ios/build`) is gitignored.
- **Simulator build (verified, reuse for REL-03):** see `qa/e2e/README.md` "iOS simulator build". Key point: `xcodebuild ... -configuration Release -sdk iphonesimulator -derivedDataPath build CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER=` with `EXPO_PUBLIC_SUPABASE_URL/ANON_KEY` exported. NOT `CODE_SIGNING_ALLOWED=NO`: that app has no keychain entitlement, so expo-secure-store fails and the app hangs on the splash. Re-signing afterwards with `codesign --entitlements` is refused at exec.
- **Results 2026-11-03 (iPhone 16 A + iPhone 16 Pro B, iOS 18.0, local stack):**
  - daily `all`: **4/4 PASS**: reveal rule (A answers, B blind on 18/19/early 21+20 links, both reveal, A reacts love, B sees it), J7 instant reveal, reduced-motion tap+confirm. **Reveal rule release blocker: PASS.**
  - pairing: signed-in (12) PASS; errors J9 / 56 / J10 PASS; inviter flows PASS (when the joiner works); **link FAIL + typed FAIL = app bug #26** (joiner ends on empty J3 after J5 join).
- Flow-side fixes made this session: iOS 18 "Open in Bonded?" prompt (`open-link.yaml`, `dismiss-link-prompt.yaml`); OTP mail has no code (#28), so `fetch-otp.js` falls back to local admin `generate_link`; `hide-keyboard.yaml` (optional + number-pad Done); `tap-away.yaml` for J3/12 (#27); seeder drops app-made persona copies; runners stop the app before seeding; the 21 reaction tap waits for the reveal animation.
- Exact next step: when mobile fixes #26, rebuild (command above, incremental ~2 min) and run `npm --prefix qa/e2e run pairing -- link` and `-- typed` (`--a B46EDC57-ADCE-453F-B9CC-079C40C5D463 --b 91551F29-C81F-4A69-B63E-6A00C85D982A`). Then QA-04 thread (22) once MOB-12 lands.
- Commands to re-run: `npm --prefix qa/e2e run lint`; `npm --prefix qa/e2e run daily -- all --a A --b B`; `npm --prefix qa/e2e run pairing -- all --a A --b B`. PATH: `$HOME/.orbstack/bin:/opt/homebrew/opt/openjdk@17/bin`.
- Watch out for: **one Supabase stack per machine.** Every worktree uses project id `bonded` and the same ports. A Codex backend agent in ~/dev/codex-backend ran `supabase db reset` during my run (killed one run with 57P01) and the stack now carries its migration 20261103010000 (history_realtime). Coordinate before running E2E. Maestro's iOS driver sometimes drops (Connection refused): re-run the suite. Never set DEVELOPER_DIR. Push with `-c credential.helper= -c 'credential.helper=!gh auth git-credential'` (the keychain helper hangs).
- Task 3 (e2e.yml): still not added (private repo macOS minutes; Docker on hosted arm64 macOS). See Needs from lead.

## Doing
- QA-04b: run done (daily 4/4, pairing blocked on #26 for link/typed); PR #23 ready for review.

## Done (since last update)
- QA-07: gallery visual + a11y suite in light, dark, light-200%, dark-200%: committed text baselines, accessible names/roles/state, SVG hiding, headers, 44 pt hit areas, WCAG AA contrast on composited backgrounds, no truncation, type-scale tokens. Mutation check (lightened `text2`) turned contrast + baseline red, then reverted. Result: 0 product findings, so `KNOWN` is empty. Limit: structural, not pixels (Node has no layout); pixel screenshots need a simulator (see README). Re-run: `bash qa/ci/visual.sh`; update baselines: `UPDATE_BASELINES=1 bash qa/ci/visual.sh`.
- Finding (not a bug filed, FYI mobile): `GalleryScreen` ignores `SchemeOverride`/`FontScaleOverride` wrapped around it (it installs its own from internal state), so tests drive its switches.
- QA-03 merged by the lead (db26cfe).
- Acknowledged change-log rows (CONTRACTS §2): **BE-04** (invites v2: `create_invite` returns `{code, expires_at, token}`, `accept_invite`/`invite_preview` return json, D04 solo joiner, D02 limiter + token, body-borne 400 errors, `pair_invites` read-only for clients) and **BE-05** (answers 1–500, `reactions.kind`, `first_day` special on day 1, stage-aware dailies, `dev_seed`). Tests and helpers follow both.
- QA-03b: new `qa/contract/invites.test.ts` (create_invite shape/48 h/one active invite/token never readable; accept_invite code formats, D04, J5 inheritance, order of errors, reveal rule for the day-1 answer, race; rate limit 5/15 min incl. pinned clock and per-user; link token rules; global hourly cap alert row; `invite_preview` anon shape, no leaks, errors, limiter incl. anon IP). `rpc.test.ts`: `create_couple`, `get_daily_question` (first_day, day 2 is not special, stage rule), BE-24 list now includes the `*_at` and limiter functions. `tables.test.ts`: `pair_invites` anon denied (42501), answers 1–500 and threads 2000, reactions with `kind` (upsert, kinds, reveal rule, partner/outsider/anon, delete own). `planned.test.ts` now only holds the next backend rows (BE-06, 09, 10, 11, 14, 17, 20).
- Verified on real PostgREST (UNVERIFIED in the brief): `accept_invite`/`invite_preview` failures arrive as HTTP 400 with `error.message === '<CODE>'`, `error.code === 'P0001'`, `data` null, and the failed attempt persists in `private.invite_attempts`.
- CI run 41488134287: db-tests, plan-check, db-reset (incl. contract), functions, app, agents-sync-check, ci-ok green. Contract: 137 passed, 1 expected fail, 9 todo (3 files).

## Bugs and findings
- **#26 [SCR-J5] sev 2 (mobile):** joiner lands on an empty J3 after joining via link or typed code; couple is formed, never sees 13. Cause (reading): `useJoinPartner` onSuccess clears `usePendingInvite` first, J5's `if (!code) <Redirect href="/join/code">` wins over `router.replace('/paired')`.
- **#27 [SCR-J3] sev 3 (mobile):** number pad covers Continue / Try again on J3 and 12; no Done bar, no keyboard avoidance.
- **#28 [BE] sev 2 (backend):** sign-in mail has no 6-digit code: `supabase/config.toml` lacks `[auth.email.template.magic_link]` (and `confirmation`) with `{{ .Token }}`; check the hosted templates too.
- sev 4 (mobile, copy, no issue): 18 for a partner without a name reads "Answer first. your partner sees yours once they join and reply." (lowercase "your" after a full stop).
- Note: on 21, a reaction tap during the post-reveal animation is dropped (flow waits now). Minor; tell mobile if users report it.
- **QA-BUG-2 (sev 3, BE-05, dev tooling only):** `dev_seed.reset()` (called by `apply_scenario`) deletes only the couples listed in `dev_seed.couple`. If a persona is a member of any other couple (made through the app or a contract test), the next `apply_scenario` fails with `couple_members_one_couple_per_user`. The seeder works around it (drops every couple a persona belongs to first), but `reset()` should do the same so `select dev_seed.apply_scenario(...)` from psql is safe. Owner: backend.
- **QA-BUG-1 (sev 4, BE-04 or TEST_PLAN, lead to decide):** TEST_PLAN D02 says the token of an expired invite "does not skip the limit". Live: a valid token on an expired invite skips the limiter, so a user already at 5 failures gets `INVITE_EXPIRED`, not `RATE_LIMITED` (backend's own `invites-v2.test.mjs` encodes that). No security impact (the token is a 192-bit secret; nothing to guess). Test kept strict as `it.fails` in `invites.test.ts` ("the token of an expired invite does not skip the limit"); it goes red when the behaviour changes. Either backend changes `private.accept_invite_at` (check the limiter before reporting expiry) or QA updates the TEST_PLAN row.

## Next
- QA-02 (seed-scenario). Then QA-03: BE-06 onwards as they land.

## Blocked
- Required check on `main`: branch protection is not available on the current plan (lead raised with PO).

## Needs from
- **mobile:** fix #26 (blocks pairing link/typed E2E), then #27. 
- **backend:** #28 (magic_link/confirmation email template with `{{ .Token }}`); the E2E fallback can go once it lands.
- **lead:** decide how agents share the one local Supabase stack (project id `bonded`): a Codex backend run reset the DB mid-E2E. Options: per-worktree `project_id` + ports in a local override, or a lock/turn rule in the protocol.
- **mobile (MOB-09 follow-up, for QA-04a):** testIDs missing, flows assert around them today: `join-code-error` on the CodeInput error caption (J9 message); a marker for the expired state, e.g. `56-expired` on the title/body block (now inferred from `join-code-input` being hidden); a Today root id (`today-screen` or `18-screen`; after 13 the flows can only assert "13 is gone"); `01-screen` already exists via OnboardingFrame, fine. For MOB-32 please use (or tell me) ids for: joiner pending state (proposed `join-pending`), inviter request card + approve/decline on 10/11 (proposed `pairing-request`, `pairing-request-approve`, `pairing-request-decline`).
- **mobile, questions:** (1) no in-app path from Today (solo couple) to 10/11 or to 12, and 01 has no "sign in" for a returning user; flows use `bonded://invite`, `bonded://waiting`, `bonded://join`, `bonded://sign-in`. Intended? (2) `/join` is both `app/(pairing)/join.tsx` and the `app/join/` folder: please confirm `bonded://join` opens 12. (3) A link opened while J3 is already mounted may keep the old digits (`useState(initialCode)`); not covered yet. (4) For E2E builds: an EAS/profile or documented `expo run` config pointing at the local stack, and Android cleartext HTTP to `10.0.2.2` allowed (release builds block it).
- **lead (CI proposal, needs the `workflow` scope):** add `.github/workflows/e2e.yml`, `on: schedule: cron "30 2 * * *"`, `workflow_dispatch`, and `push: branches: [release/**]`. Job `e2e-ios` on `macos-15`: checkout; setup Node 24; `supabase/setup-cli@v1` + `supabase start` (Docker via `colima start`) + `supabase db reset`; `npm --prefix qa/scripts ci && npm --prefix qa/e2e ci`; install Maestro (`curl -fsSL https://get.maestro.mobile.dev | bash`, pin `MAESTRO_VERSION`); boot two iPhone simulators (`xcrun simctl create/boot`); build once (`npx expo prebuild -p ios && xcodebuild -configuration Release -sdk iphonesimulator`, cached by fingerprint) and `simctl install` on both; `npm --prefix qa/e2e run pairing -- all --a $SIM_A --b $SIM_B`; upload `qa/e2e/out/*.xml` + `~/.maestro/tests/**` as artifacts; `timeout-minutes: 45`, `concurrency: e2e`. Job `e2e-android` on `ubuntu-latest` with `reactivecircus/android-emulator-runner@v2` (one emulator: `errors` suite; a second AVD for the pair suites once stable). Not a required check; failures go to an issue labelled `area:e2e`. Later also iOS A + Android B.
- **Backend (BE-06), QA-BUG-3 sev 3:** `get_streak()` returns `completed_today: null` (not false) when `last_completed_on` is null (no completed day yet): `s.last_completed_on = v_today` is NULL. Expected boolean per CONTRACTS §2 / generated type. Fix `coalesce(s.last_completed_on = v_today, false)`. Pinned by `it.fails` in `qa/contract/streak.test.ts`.
- **backend:** please add scenario `streak-11-fresh-day` to dev_seed (= streak-11-your-turn with no answers today) so run-daily.ts can drop its local workaround.
- backend: nothing blocking. FYI QA-03 creates FIXTURE-CONTRACT-* questions and `fixture-contract-*` packs on the local stack; keep `get_daily_question` independent of seed content. For BE-24, `planned.test.ts` expects the helpers to be unreachable via `rpc()`.
- lead: when protecting `main`, require check **`ci-ok`** (it aggregates all jobs). If you prefer per-job checks: `plan-check`, `agents-sync-check`, `db-tests`, `db-reset`, `functions`, `app`. Names are stable; no path filters, so they always report.
- backend: keep the `test` and `check:types` scripts in `supabase/tests/package.json` (CI calls them) and its lockfile committed. For BE-23, a `supabase/functions/deno.json` is picked up automatically; test files `*_test.ts`.
- mobile: in root `package.json` (MOB-01) define `typecheck`, `lint` and `test` scripts and commit `package-lock.json`; add `.nvmrc` if you need a Node other than 24.

## Contract changes in flight
- —

## Questions for the product owner
- —
