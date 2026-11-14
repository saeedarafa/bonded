# Widget device checks (QA-49)

Contract half: `qa/contract/widgets.test.ts` (TEST_PLAN D59). Device half: this folder.
Evidence goes in `evidence/<date>/` (screenshots and DB rows only: no answer text, no token, no hash).

| Part | Platform | State |
|---|---|---|
| QA-49b | Android, emulator-5554 | **pass** 2026-11-14 (`evidence/2026-11-14/android-*.png`; recipe in `docs/plan/status/qa.md`, QA-49b session) |
| QA-49c | iOS, REL-A | **not run**: the 2026-11-14 06:35 session had a sandbox with no `xcrun simctl`, no Docker, no xcodebuild of the app (see "QA-49c static part" below). Run the recipe below from a shell outside the sandbox. |
| founder | real iPhone | unlock prompt, locked keychain, redaction (list at the end) |

## Helpers

- `ios-leak-check.sh <udid> [2h]`: counts `bwt_` in the simulator's unified log, the App Group
  container (incl. `Library/Preferences/group.com.hellobonded.app.plist`, keys printed), the app data
  container and the extension's PluginKit container; prints how many keychain items are in the
  `*.com.hellobonded.app.widget` access group (1 signed in, 0 after sign-out). Never prints a match.
- `db-check.sh <db container>`: Maya's widget tokens (lifetime, revoked, last used), usage counters,
  little_things rows (`source`, `undone`), entitlements. Never prints a token or hash.
- `flows/ios-add-little-things.yaml`: DRAFT Maestro flow that places the widget through SpringBoard
  (never run). If it misses, place the widget by hand once.

## QA-49c recipe (REL-A only)

```bash
UDID=E90AE3CD-873E-4237-89DC-5211A5D03243      # REL-A. Never create or delete simulators.
xcrun simctl list devices booted; adb devices  # REL-B / emulator-5554 may belong to other agents
W=$PWD                                         # the qa worktree, on origin/main
```

1. **Isolated stack `qa49c`** (never the `bonded` stack on 54321 or another agent's):
   copy `supabase/` to `$TMPDIR/qa49c-sb/supabase`, set `project_id = "qa49c"` and the ports
   api 57521, db 57522, shadow 57520, pooler 57529, studio 57523, local_smtp 57524 in its
   `config.toml`; `supabase start --workdir $TMPDIR/qa49c-sb`, `supabase db reset --workdir …`,
   `docker exec -i supabase_db_qa49c psql -U postgres -c "select dev_seed.apply_scenario('premium-couple')"`,
   `supabase functions serve widget --workdir $TMPDIR/qa49c-sb` (keep running, log to a file).
2. **Build copy:** `rsync -a --exclude /node_modules --exclude /ios --exclude /android --exclude /.git $W/ $B/`
   (exclude only the top-level dirs: `--exclude ios` also drops `plugins/widgets/ios`), symlink
   `node_modules`. In `$B/app.config.ts` replace `'./plugins/widgets',` with
   `['./plugins/widgets', { premium: true, supabaseUrl: 'http://127.0.0.1:57521' }],`.
   `$B/.env`: `EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:57521`, the anon key from `supabase status`,
   `EXPO_PUBLIC_SHIP_LITTLE_THINGS=1`, RevenueCat keys **empty** (a `test_` key kills the app on iOS).
3. `CI=1 npx expo prebuild --clean --no-install --platform ios`, `cd ios && LANG=en_US.UTF-8 pod install`, then
   `xcodebuild -workspace Bonded.xcworkspace -scheme Bonded -configuration Debug -sdk iphonesimulator -destination id=$UDID -derivedDataPath $B/ios/build ARCHS=arm64 ONLY_ACTIVE_ARCH=YES CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO build`.
   Do **not** pass `CODE_SIGNING_ALLOWED=NO`: without the simulated entitlements the keychain groups
   do not exist and SecureStore fails. `xcrun simctl boot $UDID`, `xcrun simctl install $UDID <Bonded.app>`.
4. Metro from `$B` (`npx expo start --dev-client`), open the app, sign in as `maya@bonded.test`
   (email OTP; the code is in Mailpit on 57524). Paired Premium home appears.
5. **Place the widget**: `maestro --device $UDID test qa/widgets/flows/ios-add-little-things.yaml`
   or by hand. If it cannot be placed, record that, and check the extension through the log instead
   (`xcrun simctl spawn $UDID log stream --predicate 'process == "BondedWidgetExtension"'` while
   `WidgetCenter` reloads after sign-in): a `state` call must reach `functions serve` and
   `widget_token_usage` read must count 1.

Checks (screenshot each with `xcrun simctl io $UDID screenshot evidence/<date>/ios-NN-*.png`, rows
with `db-check.sh supabase_db_qa49c`):

| # | Step | Expect |
|---|---|---|
| 1 | after sign-in | token row (48 h, not revoked); widget "Little things / Tap to send / Send Sam a hug"; read bucket >= 1; leak check keychain count 1 |
| 2 | tap Send | without opening the app: row `kind=hug, source=widget`; widget "Sent to Sam 🤍" + Undo |
| 3 | Send, then Undo within 5 s | `undone_at` set; buttons back |
| 4 | Send, wait > 5 s, Undo (if still drawn) | 409 UNDO_EXPIRED: no `undone_at`; buttons back (iOS has no separate "undo expired" line) |
| 5 | limit: send goodnight once (widget medium or app), then goodnight from the widget | 409: "Goodnight sent · Back tomorrow", no second row |
| 6 | lapse: `update entitlements set is_active=false …`, tap Send | locked preview (Premium / See Premium, lock), no row; tap opens `bonded://paywall?from=widget&widget_kind=little_things` |
| 7 | sign out in the app | token `revoked_at` set; keychain count 0; widget "Tap to catch up / Open Bonded" |
| 8 | `ios-leak-check.sh $UDID 2h` | PASS (0 `bwt_` in log, App Group, app and extension containers) |
| 9 | if time | screenshots: Little things medium, Bonded small/medium, Your turn, Lock Screen kinds in the gallery |

Watch for (from the static part): the extension's Info.plist has **no** `NSAppTransportSecurity`
(the app's has `NSAllowsLocalNetworking`). ATS normally lets plain http through to `127.0.0.1` /
`localhost`; if the extension's call fails with NSURLError -1022, that is a test-setup limit (prod is
https), not a product bug: tell mobile and use `localhost` or an https tunnel.

Cleanup: `xcrun simctl shutdown $UDID`, stop Metro and `functions serve`,
`supabase stop --no-backup --workdir $TMPDIR/qa49c-sb`, delete `$B` (the `ios/build` DerivedData is
several GB) and the stack copy.

## Founder items (real iPhone only; a simulator cannot show these)

1. Lock Screen circular "Send a hug" and the Control Center control on a **locked** phone ask to
   unlock before anything is sent (`.requiresAuthentication`); nothing reaches the server before.
2. The widget's token read while the phone is locked after a restart (before first unlock):
   `AfterFirstUnlockThisDeviceOnly` means "Open Bonded" until the first unlock, then normal.
3. Redaction: Lock Screen "Today's question" / "Thinking of you" and Little things in StandBy show
   the neutral lines with no partner name while locked.
4. iOS 18.2+: the control opens the paywall / Today when the send cannot happen (`OpenURLIntent`).

## QA-49c static part (done 2026-11-14, in the sandbox)

`expo prebuild --platform ios` of origin/main 1f56821c with `premium: true`,
`supabaseUrl: 'http://127.0.0.1:57521'` (the plugin accepts it): app entitlements
`keychain-access-groups` = `$(AppIdentifierPrefix)com.hellobonded.app` then `…app.widget`, App Group
`group.com.hellobonded.app`; extension entitlements = the widget group only + the same App Group;
extension Info.plist `BondedSupabaseURL` = `http://127.0.0.1:57521`, `BondedWidgetKeychainGroup` =
`$(AppIdentifierPrefix)com.hellobonded.app.widget` (expanded at build time; MOB-77b saw it expanded
on REL-A). The extension xcodebuild failed in the sandbox (CoreSimulator service and the build arena
folder are not reachable), not because of the code; MOB-77b built it with 0 warnings outside.
