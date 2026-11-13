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
| `resume` **[MOB-61b]** (optional, not in `all`) | `fresh-install` | `onboarding/resume-after-kill.yaml`: 01, 05 dating, 07 names, 02; `stopApp` + `launchApp` without `clearState` lands on 02 again (dating version, partner name kept), then 03. DB: noor still has no account | 01, 05, 07, 02, 03 |

MOB-61b: a relaunch **without** `clearState` after partial onboarding (signed out, or a brand-new account mid-quiz) resumes at the last onboarding screen (08 included), not 01. Every flow that needs 01 starts with `subflows/launch-signed-out.yaml` (`clearState` + `clearKeychain`); the flows that relaunch with `clearState: false` (`inviter-keeps-code`, `inviter-approves-kept-code`) are signed in with a couple, so the front door drops the kept quiz and opens Today (audited 2026-11-11).

| Suite (`run-daily.ts`) | Scenario | Device A | Device B | Screens |
|---|---|---|---|---|
| `reveal` **[reveal rule]** | `streak-11-fresh-day` (= `streak-11-your-turn` minus today's answers, done by the runner) | `daily/reveal-rule-first.yaml`: Sam answers on 19, waits on 23, moves to 24 by himself, holds on 20, sees both on 21, reacts love | `daily/reveal-rule-second.yaml`, started once Sam's answer is in the DB: Maya sees no trace of it on 18, on 21 / 20 opened early by link (not-ready states) or on 19; answers; tap + confirm on 20 (reduce motion on); sees both; sees Sam's reaction arrive | 18, 19, 23, 24, 20, 21 |
| `pack` **[reveal rule]** (QA-22, MOB-49) | `premium-couple` (D51 / BE-46: no free pack questions; was `free-couple-packs` under D43) | `daily/pack-answer-first.yaml`: Sam opens the premium pack `gratitude` on 32, starts its first question from row `33-question-1` on 33, which opens 19 (not 30); answers; 30 waiting (`30-partner-waiting`) with no answer card and no text, not even his (D13); moves to 20 by himself when Maya answers; holds; both on 21 | `daily/pack-answer-second.yaml`, started once Sam's pack answer is in the DB: Maya starts the same question (same row), sees "answered" on 19 but not the text; answers; tap + confirm on 20; both on 21. The runner checks both answers and one pack row. Before the run it backdates the couple's badge awards so 52b does not open over Today (QA-24; the win-back clock it also closed is retired by D52); first device-run PASS 2026-11-10 on two iOS 18.3 simulators (as `free-couple-packs` + `33-start-free`; the premium-couple variant is not device-run yet) | 32, 33, 19, 30, 20, 21 |
| `first` | `paired-day1-partner-answered` | — | `daily/joiner-first-answer.yaml`: Sam's day-1 question is J7; Maya's answer hidden until Sam locks in, then 21 at once (no 20) | 18, J7, 21 |
| `reduced` | `streak-11-both-answered` | — | `daily/reveal-reduced-motion.yaml`: Maya, reduce motion on: one tap does not open, tap + confirm does; Sam's seeded love shows on her answer; streak chip | 24, 20, 21 |
| `little` **[D48]** (QA-29, MOB-58/59; not in `all`) | `streak-11-fresh-day`, the couple's little things deleted | `little-things/kiss-first.yaml`: Maya opens the fan (24b -> 24c), sends one kiss, lets the 3 s Undo toast pass, waits on Today until 24d shows "Sam kissed you back" (`BACK_TEXT`) | `little-things/kiss-reply.yaml`, started once Maya's kiss is in the DB: Sam's fresh install shows 24d "Maya sent you a kiss" (`RECEIVED_TEXT`), Reply sends one kiss back (toast passes). DB: exactly Maya kiss x1, Sam kiss x1, none undone. **Needs a build with `EXPO_PUBLIC_SHIP_LITTLE_THINGS=1`**. Not device-run yet | 24b, 24c, 24d |
| `voice-free` **[D46]** (QA-29, MOB-54/55; one device, not in `all`) | `streak-11-fresh-day` (free) | — | `daily/voice-free-paywall.yaml`: Maya's 19 shows Write \| Voice with "Premium" on Voice; tapping it opens 16, never the recorder. DB: no answer, no voice object. **Needs a build with `EXPO_PUBLIC_SHIP_VOICE=1`**. Not device-run yet | 18, 19, 16 |
| `day-ended` **[D56]** (QA-38, MOB-73/BE-57; one device, not in `all`) | `streak-11-fresh-day`, Maya's day -1 answer removed (only Sam answered) | — | `daily/day-ended-past.yaml`: 29 row "Only Sam answered" (`29-row-<id>-only`), 30 keeps Sam's answer locked, `bonded://history/<id>/answer` shows 19 "This day has ended" (no field, no paywall), its button lands on Today. Then `daily/day-ended-late-type.yaml` + `day-ended-late-send.yaml`: Maya types today's answer, the runner moves that question to day -3 (day ended), lock-in -> `DAY_ENDED` on 19 (`19-error`, `19-day-ended-today`), no 16, text kept. DB: no answer on either ended day. Realtime stays live, so the runner's UPDATE reaches the phone and 19 must keep the opened question while a draft exists (#258, fixed by #260); `--pause-realtime` pauses `supabase_realtime_$SUPABASE_PROJECT_ID` while the runner ends the day (a midnight-like path, no event). **Device-run PASS 2026-11-11 on REL-A** (main e10a5d9 with the pause; main 8d73c3c without it, QA-38d) | 18, 29, 30, 19 |
| `day-ended-offline` **[D56]** (QA-38, MOB-73; one **Android** device, `setAirplaneMode`) | `streak-11-fresh-day` | — | `daily/day-ended-offline-queue.yaml` (answer queued offline, `55-queued`), the runner ends that day, `daily/day-ended-offline-card.yaml`: back online, Today shows `today-day-ended`; Show reveals Maya's own text, OK removes the card; no 16. **Device-run PASS 2026-11-11 on emulator-5554** (Android 17, release APK of main 8d73c3c, QA-38d; the APK needs cleartext HTTP to `10.0.2.2`: add `android:usesCleartextTraffic="true"` to the generated manifest after prebuild, local build output only) | 19, 55, 18 |

| Suite (`run-history.ts`, QA-39) | Scenario | Device (one) | Screens |
|---|---|---|---|
| `locked` **[D55]** (MOB-71/BE-55) | `history-month` (free; entitlements removed, day-3 gift dropped) | `history/locked-free.yaml`: 29 lists the newest day before yesterday both answered (day -2) with its question, lock + "Premium" (`29-row-<id>-locked`); a tap opens 16 (title "Unlock all your history with Premium" when the build has a RevenueCat key); yesterday opens 30 unlocked; `bonded://history/<id>` shows 30 locked (`30-partner-premium`, `30-mine-premium`, no text) and its unlock button opens 16; `bonded://history/<id>/thread` shows 22 locked, no composer, no reply text. DB: nothing deleted. **Device-run PASS 2026-11-11 on REL-A** (main e10a5d9, no RevenueCat key: 16's History title not checked) | 29, 30, 22, 16 |
| `premium` **[D55]** | `history-month` + Maya entitled (30 days) | `history/premium-open.yaml`: the same day has no lock and opens 30 with Sam's seeded answer; then the runner sets `expires_at` a minute in the past and runs `locked-free.yaml` again (lapse relocks). DB: answers, messages and reactions unchanged. **Device-run PASS 2026-11-11 on REL-A** | 29, 30 |
| `ended` **[D55, D08]** | `partner-left` (Maya free) | `history/ended-locked.yaml`: 58 (`58-download` there) -> `58-history` -> the archive with the MOB-70 note "You can read these until …", an older archived day locked with "Premium" opens 16; `bonded://ended/<id>` shows `ended-q-locked`, no text. **Device-run PASS 2026-11-11 on REL-A** (no RevenueCat key) | 58, 29, 30, 16 |
| `paywall-row` **[D55, D27]** (not in `all`) | `history-month` | `history/paywall-17-history-row.yaml`: `bonded://paywall?from=history` -> × -> 17; `--shipped` (a build with `EXPO_PUBLIC_SHIP_PREMIUM_HISTORY=1`): "History: Last 2 days / Everything" (`17-row-premiumHistory`) shows; without it: absent. Needs a RevenueCat sandbox key. Not device-run yet (no key on the Mac, 2026-11-11) | 16, 17 |

The PDF itself (58 "Download your history" with a locked day) is checked in Jest (qa/a11y `58 export-locked`:
only the open day's text, plus "1 older day needs Premium, so it isn't in this PDF."; qa/app `history-lock`);
on a device, run `ended`, tap `58-download` once by hand and read the shared PDF.

The `reveal` and `reduced` suites drop the seed's day-3 gift first (QA-35): the streak-11 seeds cross 3 days, so
since BE-47 a never-subscribed maya_sam holds a live `day3` gift and Today would open 14 over 18.

| Suite (`run-offers.ts`, one device `--a`) | Scenario | Flow | Screens |
|---|---|---|---|
| `gift` **[D52]** (QA-35) | `free-couple-packs` + `earnDay3Gift` (first `streak-3` badge now, unopened `day3` gift; clears the personas' `premium_history` and today's offer-screen claims, which the dev seed keeps) | `offers/day3-gift.yaml`: Maya; Today opens 14 by itself (not 52b), "Not now", chip "You earned a gift · Open" -> 14 -> "Open the gift" -> 15 with the 12 h countdown -> "Not now" (no 17) -> Today chip "25% off · ends in 11:59". DB: opened once, `expires_at = first_opened_at + 12 h`, Maya's claim today is `gift` | 14, 15, Today |
| `gift-none` **[D52]** (QA-35) | `free-couple-packs` + `earnBadgeWithoutGift` (Sam has a lapsed yearly entitlement: ever subscribed) | `offers/day3-gift-none.yaml`: 52b sheet, never 14, no chip on Today. DB: no `day3` row | 52b, Today |
| `hint` **[D46]** (QA-35) | `streak-11-your-turn` (free) minus the seed's gift | `daily/answer-hint-19d.yaml`: 19 at 449 characters has no offer; the 450th shows `19d-upsell` ("50 left. Premium: 2000"), which opens 16. DB: Maya saved nothing | 18, 19, 19d, 16 |

The states are proven without a device by `qa/contract/e2e-seeds.test.ts` (CI). **Since MOB-76 (#429, lead
2026-11-13) the gift suites need a build WITH a RevenueCat key** (Test Store or sandbox, see below) whose `day3`
offering has an intro price, and an intro-eligible App User ID: the app no longer falls back to 50%, so no intro
price from the store means no gift (14 never opens, no chip). Run `gift-none` / `gift-after-offer` on that same
build too: without a key they would pass for the wrong reason. `hint` runs on either build.
`npm --prefix qa/e2e run offers -- all --a $REL_A`.

| Suite (`run-offers.ts`, D57, QA-48c; all need `--rc`) | Scenario | Flow | Screens |
|---|---|---|---|
| `close-p3` **[D61]** (QA-52) | `fresh-install`, exit rows cleared | `offers/close-p3-no-offer.yaml`: signed out, P3 × twice: never the exit offer sheet, straight to 08 (MOB-84; 17 tolerated until the lead confirms). DB: no exit rows. Needs MOB-84 (older builds still show the sheet) | P3, 17, 08 |
| `close-16` **[D61]** (QA-52) | `free-couple-packs` + `prepareExitOffer` (exit rows, premium_history and today's claims cleared; no gift) | `offers/close-16-no-offer.yaml`: Maya, 16 × twice -> 17 both times, never the sheet. DB: no exit rows, no `exit_*` claim (`paywall_close` is retired: `trigger_retired`) | 16, 17 |
| `cancel` (iOS only) | `premium-couple` + `prepareExitOfferPremium` | `offers/cancel-offer.yaml`: Maya, Us -> Manage subscription -> cancel offer screen (`cancel-offer-screen`, MOB-84) -> × (back to 40) -> Manage subscription again -> store page, no screen. DB: Maya exactly `cancel`, claims `[exit_cancel]` | 40, cancel offer |

`npm --prefix qa/e2e run offers -- exit --a $REL_A --rc` runs all three (`exit-premium` / `exit-gift` and their `exit-offer-none-*.yaml` flows were retired with MOB-84: no paywall × offer exists any more). They need a build **with** a RevenueCat
key and the `exit30` offering (and `cancel30` for `cancel`). Since QA-51 (PO 2026-11-13) that key is the
RevenueCat **Test Store** key (`test_…`, products `yearly_v2`/`monthly_v2`/`yearly_day3_v2`/`yearly_exit30_v2`,
offerings default/day3/exit30, entitlement `premium`; no store account needed) in the repo `.env` as
`EXPO_PUBLIC_REVENUECAT_IOS_KEY` / `_ANDROID_KEY`: copy it into the worktree `.env` before the build. A store
sandbox key (`appl_`/`goog_`, [ACCOUNTS 9b](../../docs/plan/ACCOUNTS.md)) works the same. `--rc` (or
`RC_SANDBOX=1` / `RC_TEST_STORE=1`) is the promise that the build has the key; the runner prints which kind
the env/.env holds (`test-store`, `sandbox` or `none`, never the key). Without `--rc` each suite prints
`SKIP ... needs a RevenueCat key` and the run exits 0 (CI runs exactly that as a smoke check, plus
`tsc -p qa/e2e/tsconfig.json`). The P3, 16 and gift cases need an intro-eligible customer (a fresh App User ID
in the Test Store; else the store gate says no and 17 shows first); `cancel` needs an active yearly
subscription for Maya's App User ID (`cancel` skips on Android: D57 v1 has no cancel offer there). Since MOB-76 the gift suites use the same keyed
build (their `day3` offering must carry the intro price), so one Test Store build serves `all`. The server answers each state gives are proven in `qa/contract/e2e-seeds.test.ts`.
**D61 (QA-52):** the 30% exit offer no longer shows on paywall × (P3, 16), only on an in-app cancel of the
trial or Yearly (a store-side cancel gets one push), and whoever was offered the 30% never gets the day-3 gift.
`exit-p3` / `exit-16` (and `exit-offer-p3.yaml` / `exit-offer-16.yaml`) became `close-p3` / `close-16`
(`close-p3-no-offer.yaml` / `close-16-no-offer.yaml`). `gift-after-offer` (no `--rc`, gift build, needs BE-62 on
the stack): `free-couple-packs` + `earnBadgeAfterExitOffer` (Sam has a `cancel` exit-offer row) -> the
`day3-gift-none.yaml` flow (52b, no 14, no chip); DB: no `day3` row. MOB-84: the cancel offer is a screen (`/subscription/offer`, also the `cancel_offer` push target,
`bonded://subscription/offer`; push fixture in `qa/fixtures/push-payloads.json`). Device-run attempt 2026-11-13 (QA-51, REL-A, Test Store build): not completed, see
`docs/plan/status/qa.md`.

The reveal suite also checks the database afterwards (both answers, Sam's `love` on Maya's answer). Answer
text typed on devices starts with `FIXTURE-E2E`. Flows may select by text only when the value is a single
runner parameter (`${ANSWER_A}`): that is data, not app copy (the lint allows exactly that). The runner
switches the simulator's reduce-motion setting (`simctl spawn <REL-A/REL-B udid> defaults write com.apple.Accessibility
ReduceMotionEnabled`; Android: animation scales 0) and turns it off again.

Partner-joined detection is the inviter flow waiting on 10/11 until `13-screen` appears; nothing taps it.
The two devices sync through database state: the run script polls `pair_invites` (for the code device A
made) and checks `couple_members` afterwards. No sleeps.

**D02 (decided 2026-11-02):** a typed code will need the inviter's approval (BE-26 / MOB-32). Flows marked
`[D02]` / tag `d02-typed-code` route the step after the code through `.maestro/subflows/after-typed-code.yaml`
(joiner) and `inviter-approve.yaml` (inviter). Today both are no-ops. When MOB-32 lands: put the real
testIDs in those two files (the ones there are proposals), then run with `D02_APPROVAL=true`. Token-link
joins (`link`) stay immediate and must not change.

One-device flow (no runner yet): `packs/free-couple-pack-locked.yaml` (QA-33, D51): scenario `free-couple-packs`, Maya opens `gratitude` from 32 (`32-featured` present), sees the read-only sample on 33 (no `33-question-1`), and both a locked row and "Unlock every pack" open 34. Run with `npm run qa:scenario free-couple-packs` (then put the couple's badge awards 3 days back, as `quietToday` does, or 52b may cover Today) then `maestro test .maestro/packs/free-couple-pack-locked.yaml`. 34 is left by its own button (`34-close`, or `34-back` on a build without a RevenueCat key): Maestro `back` is Android only. **Device-run PASS 2026-11-11 on REL-A** (main 8d73c3c, no RevenueCat key, QA-38d).

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
   REL_A=$(xcrun simctl list devices | grep 'REL-A' | grep -oE '[0-9A-F-]{36}')   # the only two Bonded sims
   REL_B=$(xcrun simctl list devices | grep 'REL-B' | grep -oE '[0-9A-F-]{36}')
   npm ci
   npx expo prebuild -p ios --no-install && (cd ios && pod install)
   git checkout -- package.json          # prebuild rewrites its scripts; mobile owns package.json
   export EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
   export EXPO_PUBLIC_SUPABASE_ANON_KEY=$(supabase status -o env | grep '^ANON_KEY=' | cut -d= -f2- | tr -d '"')
   (cd ios && xcodebuild -workspace Bonded.xcworkspace -scheme Bonded -configuration Release \
      -sdk iphonesimulator -destination id=$REL_A -derivedDataPath build \
      CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER=)
   APP=ios/build/Build/Products/Release-iphonesimulator/Bonded.app
   strings -a $APP/main.jsbundle | grep -c 127.0.0.1:54321    # 1: the bundle points at the local stack
   otool -s __TEXT __entitlements $APP/Bonded | head -2       # present: keychain works
   for d in $REL_A $REL_B; do xcrun simctl uninstall $d com.hellobonded.app; xcrun simctl install $d $APP; done
   ```
   About 10 minutes clean, under 2 incremental. `EXPO_PUBLIC_*` is baked in at bundle time; the local
   demo anon key is stable across `supabase stop/start`. Re-run `prebuild` only when native deps change.
   **One stack per machine:** every worktree's `supabase start` uses the same project id (`bonded`) and
   ports, so a `supabase db reset` in another worktree resets the E2E database mid-run. Don't run
   E2E while another agent works on the stack.
3. Devices: iOS uses only the two Bonded simulators, **REL-A** (iPhone 16 Pro Max, iOS 18.0) and **REL-B**
   (iPhone SE 3rd, iOS 18.0); never create or delete simulators (AGENTS.md, Simulators). Their UDIDs (the runner needs
   UDIDs, not names): `REL_A=$(xcrun simctl list devices | grep 'REL-A' | grep -oE '[0-9A-F-]{36}')`, same for `REL_B`.
   **Sharing devices (PO 2026-11-12):** at most three sub-agents use devices at the same time, each on its own
   device: REL-A, REL-B (iOS) and the Android emulator `emulator-5554`. A two-device flow takes two of them for
   that agent. Check `xcrun simctl list devices booted` and `adb devices` first and never take a device another
   agent is using; a one-device run uses one free device (REL-A in the examples below; REL-B or the emulator
   when REL-A is taken). Never create a simulator (no `simctl create`, no REL-C), never delete REL-A/REL-B, and
   shut down only what you booted when done (`xcrun simctl shutdown <udid>`, `adb -s emulator-5554 emu kill`).
   **App id (PO 2026-11-12):** `com.hellobonded.app`, invite domain `hellobonded.com`. A device that still has a
   Bonded build with the old app id needs that app uninstalled once and a fresh build installed: the flows'
   `launchApp`/`clearState` act on the new id only. Then
   ```bash
   npm --prefix qa/e2e run pairing -- all --a $REL_A --b $REL_B
   npm --prefix qa/e2e run pairing -- errors --b $REL_A        # one device is enough
   npm --prefix qa/e2e run pairing -- d37-guard --b $REL_A   # #112: D37 sheet guard, one device (BEHIND point for 440x956)
   npm --prefix qa/e2e run daily -- all --a $REL_A --b $REL_B    # reveal | pack | first | reduced | all
   npm --prefix qa/e2e run daily -- reduced --b $REL_A          # first | reduced: one device
   npm --prefix qa/e2e run daily -- day-ended --b $REL_A        # QA-38 (D56): one device, REL-A only
   npm --prefix qa/e2e run daily -- day-ended-offline --b emulator-5554   # QA-38: Android only (airplane mode)
   npm --prefix qa/e2e run history -- all --b $REL_A           # QA-39 (D55): locked | premium | ended | all
   npm --prefix qa/e2e run history -- paywall-row --b $REL_A --shipped   # build with EXPO_PUBLIC_SHIP_PREMIUM_HISTORY=1
   ```
   **Isolated stack (QA-38c, preferred over the shared `bonded` one):** copy `supabase/` to a scratch dir, set
   `project_id` and the ports in its `config.toml` (e.g. `qa38c`, 565xx incl. `shadow_port`, `inspector_port`),
   `supabase start -x studio,imgproxy,vector,logflare,supavisor,edge-runtime,postgres-meta`, build with its
   `API_URL`/`ANON_KEY`, then run with `SUPABASE_PROJECT_ID=<id> SUPABASE_DB_URL=<its DB_URL> MAILPIT_URL=<its MAILPIT_URL>`.
   `supabase stop --no-backup` and delete the scratch dir afterwards.
   `day-ended` and `day-ended-offline` rewrite the couple's days (Maya's day -1 answer removed, today's
   question moved to day -3), so re-seed (`npm run qa:scenario streak-11-fresh-day`) before any other suite.
   They need a `com.hellobonded.app` build of main with MOB-73 (testIDs `19-day-ended*`, `today-day-ended*`).
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

Monthly check-in (26, MOB-23): on a couple together 30 days or more (`history-month`, `delete-account`),
Today opens the 26 sheet once after this phone saw today's reveal. No flow returns to Today after a reveal
on such a couple yet; one that does runs `subflows/dismiss-check-in.yaml` there (taps `26-skip` only when
the sheet is visible). The current reveal flows use couples paired 2 or 11 days ago and land on 21.

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
