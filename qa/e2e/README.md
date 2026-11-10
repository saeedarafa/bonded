# Bonded E2E (Maestro, two simulators)

Owner: QA. Flows live in `.maestro/` (QA-04). QA-04a covers pairing (`.maestro/pairing/`, `run-pairing.ts`);
QA-04b covers the daily loop: answer, hold to reveal, revealed + reactions (`.maestro/daily/`, `run-daily.ts`).
The thread (22) follows once MOB-12 lands.

## What is covered
| Suite (`run-pairing.ts`) | Scenario | Device A (Maya, inviter) | Device B (joiner) | Screens |
|---|---|---|---|---|
| `link` | `solo-invite-pending` | `inviter-waits.yaml`: 11, waits, moves to 13 by itself | `joiner-link-token.yaml` (`START=cold`): Sam (no account) cold-starts `bonded://j/BND4827?t=dev-seed-token-4827`; it opens J2 first (MOB-40) | 11, J2, J4, J5, 13 |
| `link-warm` | `solo-invite-pending` | `inviter-waits.yaml` | `joiner-link-token.yaml` (`START=warm`): the same link while the app is open on 01 | 11, 01, J2, J4, J5, 13 |
| `typed` **[D02]** | `solo-invite-pending` | `inviter-creates-code.yaml`: 10 makes a code, copy, new code, 11, waits, 13 | `joiner-typed-code.yaml`: Sam types the code on J3 (from 01 "I have a code") | 10, 11, 01, J3, J4, J5, 13 |
| `signed-in` **[D02]** | `solo-invite-pending` | `inviter-waits.yaml` | `joiner-signed-in-code.yaml`: Lea (signed in, solo: D04) types 4827 on 12 | 11, 12, 13 |
| `errors` | `invite-wrong-code`, `invite-expired`, `couple-full` | — | `joiner-wrong-code.yaml` (J9 typed, J9 by link, malformed link), `joiner-expired.yaml` (56), `joiner-couple-full.yaml` (J10: Lea confirms the D37 sheet, "Back to my space" -> Today) | J3, J9, 56, 12, J10, Today |
| `keeps-code` **[D36]** | `invite-wrong-code` | `inviter-keeps-code.yaml`, then `inviter-approves-kept-code.yaml` | `joiner-typed-code.yaml` with the kept code | Today, 10, 19, J3, J4, J5, 13 |
| `from-today` **[D37]** | `solo-invite-pending` | `inviter-waits.yaml` (approval) | `joiner-from-today.yaml`: Lea, Today "Join my partner instead" opens J3, J5 (signed in), J5-confirm archive, pending | Today, J3, J5, 13 |

| Case (`run-onboarding.ts`, one device) | Scenario | Flow | Screens |
|---|---|---|---|
| `fresh` | `fresh-install` | `onboarding/fresh-install.yaml`: noor, story, quiz, 07, **47 skip** (MOB-28), 08 sign-up, 09, 10 | 01-07, 47, 08, 09, 10 |
| `returning-solo` **[D40]** | `invite-wrong-code` | `auth/returning-sign-in.yaml`: Maya, 01 "I already have an account", 08, **10** | 01, 08, 10 |
| `returning-paired` **[D40]** | `paired-day1-partner-answered` | the same flow, lands on Today | 01, 08, Today |

| Suite (`run-daily.ts`) | Scenario | Device A | Device B | Screens |
|---|---|---|---|---|
| `reveal` **[reveal rule]** | `streak-11-fresh-day` (= `streak-11-your-turn` minus today's answers, done by the runner) | `daily/reveal-rule-first.yaml`: Sam answers on 19, waits on 23, moves to 24 by himself, holds on 20, sees both on 21, reacts love | `daily/reveal-rule-second.yaml`, started once Sam's answer is in the DB: Maya sees no trace of it on 18, on 21 / 20 opened early by link (not-ready states) or on 19; answers; tap + confirm on 20 (reduce motion on); sees both; sees Sam's reaction arrive | 18, 19, 23, 24, 20, 21 |
| `pack` **[reveal rule]** (QA-22, MOB-49) | `free-couple-packs` | `daily/pack-answer-first.yaml`: Sam opens the premium pack `gratitude` on 32, starts its free first question (D43) on 33, which opens 19 (not 30); answers; 30 waiting (`30-partner-waiting`) with no answer card and no text, not even his (D13); moves to 20 by himself when Maya answers; holds; both on 21 | `daily/pack-answer-second.yaml`, started once Sam's pack answer is in the DB: Maya starts the same question (same row), sees "answered" on 19 but not the text; answers; tap + confirm on 20; both on 21. The runner checks both answers and one pack row | 32, 33, 19, 30, 20, 21 |
| `first` | `paired-day1-partner-answered` | — | `daily/joiner-first-answer.yaml`: Sam's day-1 question is J7; Maya's answer hidden until Sam locks in, then 21 at once (no 20) | 18, J7, 21 |
| `reduced` | `streak-11-both-answered` | — | `daily/reveal-reduced-motion.yaml`: Maya, reduce motion on: one tap does not open, tap + confirm does; Sam's seeded love shows on her answer; streak chip | 24, 20, 21 |

The reveal suite also checks the database afterwards (both answers, Sam's `love` on Maya's answer). Answer
text typed on devices starts with `FIXTURE-E2E`. Flows may select by text only when the value is a single
runner parameter (`${ANSWER_A}`): that is data, not app copy (the lint allows exactly that). The runner
switches the simulator's reduce-motion setting (`simctl spawn <udid> defaults write com.apple.Accessibility
ReduceMotionEnabled`; Android: animation scales 0) and turns it off again.

Partner-joined detection is the inviter flow waiting on 10/11 until `13-screen` appears; nothing taps it.
The two devices sync through database state: the run script polls `pair_invites` (for the code device A
made) and checks `couple_members` afterwards. No sleeps.

**D02 (decided 2026-11-02):** a typed code will need the inviter's approval (BE-26 / MOB-32). Flows marked
`[D02]` / tag `d02-typed-code` route the step after the code through `.maestro/subflows/after-typed-code.yaml`
(joiner) and `inviter-approve.yaml` (inviter). Today both are no-ops. When MOB-32 lands: put the real
testIDs in those two files (the ones there are proposals), then run with `D02_APPROVAL=true`. Token-link
joins (`link`) stay immediate and must not change.

## Run it
Needs: Maestro CLI (`curl -fsSL https://get.maestro.mobile.dev | bash`), two booted simulators/emulators,
Docker, Supabase CLI, Node 24.

1. Local stack: `supabase start && supabase db reset`; `npm --prefix qa/scripts ci && npm --prefix qa/e2e ci`.
2. A build of the app on both devices, release-like (no dev menu), pointing at the local stack:
   - iOS simulator: `EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`, anon key from `supabase status`.
   - Android emulator: `EXPO_PUBLIC_SUPABASE_URL=http://10.0.2.2:54321` and cleartext HTTP allowed (see
     Needs from mobile in `docs/plan/status/qa.md`).
   - Leave `EXPO_PUBLIC_INVITE_DOMAIN` unset: links use the `bonded://` scheme.
   For example `npx expo run:ios --configuration Release` / `npx expo run:android --variant release`.

   **iOS simulator build (verified 2026-11-03: Xcode, iOS 18.0 sims, Apple Silicon; reuse for REL-03).**
   `npx expo run:ios` asks for a signing team. With `CODE_SIGNING_ALLOWED=NO` the app builds but hangs on
   the splash: expo-secure-store gets no keychain entitlement (`getValueWithKeySync` fails). Ad-hoc
   "sign to run locally" works: Xcode embeds the simulator entitlements, so no team is needed:
   ```bash
   export PATH="$HOME/.orbstack/bin:/opt/homebrew/opt/openjdk@17/bin:$PATH"   # never set DEVELOPER_DIR
   npm ci
   npx expo prebuild -p ios --no-install && (cd ios && pod install)
   git checkout -- package.json          # prebuild rewrites its scripts; mobile owns package.json
   export EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
   export EXPO_PUBLIC_SUPABASE_ANON_KEY=$(supabase status -o env | grep '^ANON_KEY=' | cut -d= -f2- | tr -d '"')
   (cd ios && xcodebuild -workspace Bonded.xcworkspace -scheme Bonded -configuration Release \
      -sdk iphonesimulator -destination id=<udid-A> -derivedDataPath build \
      CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER=)
   APP=ios/build/Build/Products/Release-iphonesimulator/Bonded.app
   strings -a $APP/main.jsbundle | grep -c 127.0.0.1:54321    # 1: the bundle points at the local stack
   otool -s __TEXT __entitlements $APP/Bonded | head -2       # present: keychain works
   for d in <udid-A> <udid-B>; do xcrun simctl uninstall $d app.bonded.mobile; xcrun simctl install $d $APP; done
   ```
   About 10 minutes clean, under 2 incremental. `EXPO_PUBLIC_*` is baked in at bundle time; the local
   demo anon key is stable across `supabase stop/start`. Re-run `prebuild` only when native deps change.
   **One stack per machine:** every worktree's `supabase start` uses the same project id (`bonded`) and
   ports, so a `supabase db reset` in another worktree resets the E2E database mid-run. Don't run
   E2E while another agent works on the stack.
3. Device ids: `xcrun simctl list devices booted`, `adb devices`. Then
   ```bash
   npm --prefix qa/e2e run pairing -- all --a <device-A> --b <device-B>
   npm --prefix qa/e2e run pairing -- errors --b <device>      # one device is enough
   npm --prefix qa/e2e run pairing -- d37-guard --b <device>   # #112: D37 sheet guard, one device (BEHIND point for 440x956)
   npm --prefix qa/e2e run daily -- all --a <device-A> --b <device-B>    # reveal | pack | first | reduced | all
   npm --prefix qa/e2e run daily -- reduced --b <device>        # first | reduced: one device
   ```
   It seeds each scenario, empties the invite limiter (all simulators share the Mac's IP, and anon
   attempts are limited per IP) and the mail catcher, runs both flows in parallel, and prints PASS/FAIL per
   pair. JUnit files: `qa/e2e/out/<folder>-<flow>.xml` (e.g. `pairing-inviter-waits.xml`, `daily-reveal-rule-second.xml`).
4. One flow by hand (seed first): `npm run qa:scenario invite-expired` then
   `maestro --device <id> test .maestro/pairing/joiner-expired.yaml`.

Env: `SUPABASE_DB_URL` (local only; the seeder refuses other hosts), `MAILPIT_URL` (default
`http://127.0.0.1:54324`), `MAESTRO` (path to the CLI), `D02_APPROVAL`.

Sign-in uses the email code: `.maestro/scripts/mail-otp.js` reads the 6-digit code from the sign-in mail in
the local Mailpit (or Inbucket) API on the host, and nothing else (QA-11, D35: the `magic_link` and
`confirmation` templates in `supabase/templates/` carry both the code and the PKCE link). If no code
arrives, the flow fails: check that the stack was restarted after a template change (`supabase stop &&
supabase start`) and run `npm --prefix qa/contract test -- email-auth`. Personas:
`qa/fixtures/personas.json`. Never point this at a hosted project.

iOS specifics handled in subflows: `open-link.yaml` (iOS 18 asks "Open in Bonded?" for `bonded://` links; a
stale prompt from a failed flow is cancelled by `dismiss-link-prompt.yaml`, also run at every launch),
`hide-keyboard.yaml` (optional hideKeyboard + the number pad's "Done" bar), `tap-away.yaml` (J3/12 number
pad, #27). These are the only places where flows select system UI text; the lint allows exactly those.

## Without a simulator
`npm --prefix qa/e2e run lint` parses every flow, checks the commands, `runFlow`/`runScript` paths, and that
every `id:` is a testID present in `app/` or `src/` (proposals for MOB-32 are allow-listed in
`lint-flows.ts`). Run it after any screen change.

## Known gaps (QA-04a)
- Entry points: `sign-in-persona.yaml` still opens `bonded://sign-in` (not 01 "I already have an account",
  which sets D40's returning flag and sends a solo persona to 10); D40 itself is `auth/returning-sign-in.yaml`.
  The solo inviter opens `bonded://invite` / `bonded://waiting`; the signed-in joiner `bonded://join` (12),
  and `from-today` uses Today's in-app entry.
- Never tap away (`tap-away.yaml`) on 12 after typing a code: for a solo joiner the D37 sheet is up and a
  tap on its scrim cancels it (REL-03c). 12 puts the number pad away itself; J3 flows still use tap-away.
- J9 and 56 are asserted by structure (`join-code-retry` present, `join-code-input` kept for J9 and hidden
  for 56) because the states have no testID of their own.
- A token link opens J2 first (MOB-40), cold (`link`) and warm from 01 (`link-warm`). A warm link while J3
  is already open is not covered.
- Not yet: RATE_LIMITED after 5 failures on device, push "Sam joined", J10 by public link, cross-platform
  (iOS A + Android B) run in CI.
