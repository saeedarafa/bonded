# SEC-21: widget sign-in for Premium widgets (D59)

Date: 2026-11-12. Reviewer: security. Mode: focused guidance, written before BE-60 and MOB-77/78
are built. Source read only; no target code was run. Base: `origin/main` at the branch point of
`security/SEC-21-widget-auth`; D59 and the BACKLOG rows were read from
`origin/lead/LEAD-05-run-2026-11-12f` (PR #349, not merged yet).

## What exists today

- **The free D47 widgets hold no credential.** The app writes a JSON snapshot to the App Group
  (`UserDefaults(suiteName: group.<bundle id>)`, key `bonded.widget.snapshot`) on iOS. On
  Android it writes to `MODE_PRIVATE` shared preferences `bonded_widgets`. The snapshot holds
  the state, booleans, the streak, the day number, `dayEndsAt`, the partner's first name (20
  characters at most) and fixed copy. It holds no question, answer or message text
  (`src/features/widgets/snapshot.ts`). The widgets never call the network. Sign-out writes the
  empty snapshot.
- **Android receivers are `exported=false`.** Their PendingIntents use `FLAG_IMMUTABLE`
  (`plugins/widgets/index.js:408`, `plugins/widgets/android/kotlin/BondedWidgets.kt:76-122`).
- **The app session stays out of the App Group.** It is in an MMKV store encrypted with
  AES-256. The key is in expo-secure-store (the app-only keychain or Keystore), so the widget
  extension cannot read it today (`src/lib/storage.ts`).
- **`send_little_thing` gets the sender from `auth.uid()`** inside
  `private.send_little_thing_at`. It is granted to `authenticated` only. Limits, undo and
  idempotency are enforced in SQL: the per-kind limits by tier, the couple advisory lock, the
  unique `(sender_id, client_id)` index, sender-only undo with 10 undos a day, and the D24
  push cap.

D59 changes this in 2 ways. A widget, a Lock Screen accessory or a Control can now **write**
without opening the app. Widgets can now **read** fresh data while the app is closed. Both
need a credential that the extension (iOS) or a widget receiver (Android) can use.

## Options compared

| | A. Narrow widget token (recommended) | B. Main session in the background | C. Signed JWT with a custom `widget` role |
|---|---|---|---|
| What it is | An opaque random token. An edge function mints it for a signed-in user. The DB stores only its hash. | An App Intent runs in the app process and uses the Supabase session. | An edge function signs a short JWT for a new Postgres role with grants on the widget RPCs only. |
| What a leak exposes | Sending little things and reading the widget fields, for at most 48 h. It can be revoked right away. | The whole account (refresh token) for its lifetime. | The widget RPCs until the JWT expires. It cannot be revoked. |
| PO rule (no long-lived token in the shared container) | Met. | Not met. The refresh token is long-lived, and an extension would have to read it from the App Group or a shared keychain. | Met for lifetime. Revocation fails. |
| Other problems | One table, two edge functions or RPCs. | Supabase rotates refresh tokens and detects reuse. If the app and an intent both refresh, they race, and that can sign the user out everywhere. A JS runtime in an intent is heavy and slow. Whether iOS runs a widget's intent in the extension or the app process is not something we control. | The JWT signing secret would sit in an edge function. Needs a new PostgREST role and grants. |

**Recommendation: option A.** Options B and C are rejected.

## Recommended design (option A)

### Credential
- **Token:** 32 random bytes, base64url, prefix `bwt_`. It is opaque, not a JWT. Only
  `sha256(token)` is stored, in `private.widget_tokens`. RLS is on there, and all privileges are
  revoked from anon, authenticated and service_role (use definer functions only). Columns:
  `token_hash` (PK), `user_id` (FK `auth.users` **on delete cascade**), `couple_id`,
  `session_id` (the `session_id` claim of the minting JWT), `device_id` (a random install id,
  not a hardware id), `scopes` (fixed: `send_little_thing`, `undo_little_thing`,
  `widget_read`), `created_at`, `expires_at`, `revoked_at`, `last_used_at`.
- **Lifetime:** at most **48 h** from minting (absolute; using the token never extends it). The
  app mints a new token, and revokes the old one in the same transaction, in these cases:
  1. on every foreground when less than 24 h is left;
  2. in `BGAppRefreshTask` (iOS) or a periodic `WorkManager` job (Android);
  3. after a silent background push (the `partner_answered` hint MOB-57 already proposes).

  **A widget never refreshes its own token.** Otherwise the token would really be long-lived.
  An expired or revoked token makes the widget show "Open Bonded to continue". This is the same
  as the locked preview, and it shows no data.
- **One active token per (user, device):** minting rotates. Allow at most 5 live tokens per
  user. Allow at most 20 mints a day per user.
- **Minting:** an edge function `widget-token` (`verify_jwt = true`) or a definer RPC granted
  to `authenticated`. It requires an active, paired couple. It does **not** check Premium: a
  free user gets a token too, so the widget can show the locked preview from fresh state.
  Premium is checked on each use.

### Where the token is stored
- **iOS: a shared keychain access group, not the App Group.** Add a `keychain-access-groups`
  entitlement (for example `$(AppIdentifierPrefix)com.hellobonded.app.widget`) to the app and
  to the widget extension, and to the Controls extension if it is separate. Use
  `kSecClassGenericPassword` with `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`. Widgets
  render and Controls run while the phone is locked, so "WhenUnlocked" would break them.
  "ThisDeviceOnly" keeps the token out of backups and out of iCloud Keychain. Never put it in
  `UserDefaults(suiteName:)`, in a file in the App Group container, in the timeline entry or in
  Info.plist.
- **Android: the app's private storage, encrypted with a key in the Android Keystore.** On
  Android, widgets and their receivers run in the app's own process, so there is no "shared
  group". Store the token in `MODE_PRIVATE` prefs under a separate name (not `bonded_widgets`),
  encrypted with AES-GCM using a Keystore key (`setUserAuthenticationRequired(false)`).
  `androidx.security:security-crypto` (EncryptedSharedPreferences) is deprecated, so call the
  Keystore directly or use the expo-secure-store native API. Exclude this file from Auto Backup
  and device transfer (`dataExtractionRules` / `fullBackupContent`).

### Server path
- **Endpoint:** an edge function `widget` with `verify_jwt = false`, because the token is not a
  JWT. It reads the token only from `Authorization: Bearer bwt_…`, never from a URL or query
  string. It hashes the token and calls **one** service-only definer RPC per action, passing
  the hash. That RPC checks the token itself, so the edge function cannot skip the check:
  - The token exists, `revoked_at is null` and `expires_at > now()`.
  - The scope covers the action.
  - The Auth user exists.
  - `session_id` still exists in `auth.sessions`. Then sign-out (local or global) and "sign out
    other devices" end the token too.
  - The token's `couple_id` is still the user's active, paired couple.
  - Premium comes from `private.is_couple_premium(couple_id)` **on every call**. It is never
    read from the token and never cached.
- **Write:** BE-60 splits the core into `private.send_little_thing_core(p_uid, p_kind,
  p_amount, p_client_id, p_source, p_now)`.
  - `public.send_little_thing` passes `auth.uid()` and `'app'`. **It must not accept
    `'widget'` from the client.** The source is set by the server path, not by a parameter a
    client can choose.
  - The widget path passes `'widget'`. It refuses a free couple with `PREMIUM_REQUIRED` before
    any insert, so the free tier's quota is not used.
  - All the existing rules stay as they are: the couple lock, the limits, D24, undo (5 s,
    sender-only, 10 a day), and `UNDO_EXPIRED` once dispatched.
  - Do not fake `auth.uid()` with `set_config('request.jwt.claims')`. Pass the uid explicitly.
  - Store `source` on `little_things` for analytics.
  - The widget sends `p_amount = 1`. Kind is allow-listed in SQL as it is today. Undo through
    the widget token works only on rows that user sent.
- **Read:** `private.widget_state(p_token_hash)` returns allow-listed columns only:
  - days together and the next key date (type and date; **not the title** if a title is
    free text, see D54);
  - streak count, next badge id and whether a saver is available;
  - today's question **text** (catalogue content only);
  - mascot state;
  - the partner's first name (20 characters at most);
  - the last little thing **kind and time** (no body exists, keep it that way);
  - the on-this-day question text;
  - the ritual time;
  - `premium` (boolean);
  - the per-kind `at_limit`.

  It never returns answer, thread-message or voice fields, and never a path or signed URL.
  Build it with an explicit column list, never `select *` or `row_to_json` of a content table.
  A free or lapsed couple gets `{premium:false}` plus whatever the free D47 widgets already
  show. Nothing else.
- **Replay and rate limits:**
  - The token goes over TLS only and never into logs. Log a hash prefix at most, and never the
    Authorization header.
  - Each tap generates a new `client_id` (UUIDv4) on the device. The existing unique
    `(sender_id, client_id)` makes a replayed request return the first result instead of a
    second send.
  - Per token: at most 30 sends or undos per 10 min, and at most 120 reads per hour. The
    daily limits in SQL are still the real bound. Count in a DB table or an advisory-locked
    counter, not in edge memory.
  - Return `Cache-Control: no-store`.
  - The same error for unknown, expired and revoked tokens (`WIDGET_AUTH`, 401), so there is no
    oracle.
- **Revocation:**
  - **Sign-out:** the app calls `revoke` with the user's JWT before `signOut()`, then deletes
    the keychain item and writes the empty snapshot. The `auth.sessions` check above covers the
    case where the app could not reach the server.
  - **Unpair or ended couple:** the `couple_id` check makes the token invalid at once. Also
    revoke all tokens for that couple in the unpair/end RPC (defence in depth).
  - **Delete account:** the FK cascade removes the rows. delete-account already deletes the
    Auth user.
  - **Premium lapse:** no revocation is needed, because every call checks Premium. The next
    read returns `premium:false` and the widget shows the locked preview.
  - **Reinstall:** a new `device_id`. The old token expires within 48 h. iOS keychain items
    survive a reinstall, so on first launch the app deletes any widget keychain item it did not
    write in this install, and mints a new token.
  - **Purge:** a cron job deletes rows more than 7 days past `expires_at` or `revoked_at`.

### Client rules (MOB-77/78)
- **iOS:**
  - The interactive widget `Button(intent:)`, the Lock Screen accessory and the
    `ControlWidgetButton` all use an `AppIntent` that calls the `widget` endpoint with the
    keychain token. `openAppWhenRun = false`.
  - Set `isDiscoverable = false` (or do not add it to `AppShortcutsProvider`), so Shortcuts and
    Siri automations cannot run it in a loop. If the PO wants Siri later, that is a separate
    review.
  - Lock Screen and Control Center sends need a PO/lead call. **Recommended default:**
    `authenticationPolicy = .requiresAuthentication`, so the device must be unlocked to send.
    The alternative, `.alwaysAllowed`, lets anyone holding a locked phone send a hug. The
    impact is low (undo, daily limits), so the PO can accept that risk in writing.
  - Reads on the Lock Screen: mark the question text and the partner name `.privacySensitive()`,
    so they are redacted when the user has turned on "hide sensitive content" and the device
    is locked.
- **Android:**
  - The send button is a `PendingIntent.getBroadcast` to an **explicit component** (your own
    receiver class), with `FLAG_IMMUTABLE` and a distinct requestCode per kind. The receiver
    is `exported="false"` with no intent-filter action other apps can send. It re-checks
    `kind` against the allow-list.
  - The network call runs in `goAsync()` (10 s at most) or in an expedited `WorkManager` job,
    never on the main thread.
  - There is no Android Quick Settings tile in D59. If one is added, review it separately.
- **Both platforms:**
  - The timeline entries and the App Group / `bonded_widgets` snapshot may now contain the
    question text (D59 allows it). They must **never** contain answer, thread-message or voice
    text, a voice path or a signed URL, or the token.
  - The snapshot builder keeps its whitelist style (no spreads). Bump
    `WIDGET_SNAPSHOT_VERSION`.
  - Sign-out, unpair and account deletion clear the token and the cached Premium data.
  - Analytics: widget kind and action only (D54).

## BE-60 acceptance checks
1. A `private.widget_tokens` row stores only `sha256` of the token. Tests show the raw token is
   never stored or returned again after minting, and does not appear in logs.
2. Mint needs an authenticated user with an active, paired couple. It rotates the previous
   token for the same device. It enforces at most 5 live tokens and at most 20 mints a day.
   `expires_at` is 48 h or less, and use never extends it.
3. The widget endpoint uses `verify_jwt = false` and accepts the token only in
   `Authorization`. Unknown, expired, revoked, wrong-scope, ended-session and other-couple
   tokens all give the same 401 `WIDGET_AUTH`.
4. The token check runs **inside** the service-only definer RPC. The RPC has a pinned
   search_path and is revoked from anon and authenticated (tested).
5. A widget send for a free couple gives `PREMIUM_REQUIRED` and inserts no row. A Premium
   couple (either partner's Premium) succeeds. A lapsed couple is refused on the next call.
6. `public.send_little_thing` cannot set `source = 'widget'`. Widget rows have
   `source = 'widget'`. Limits, D24, undo (5 s, sender-only, 10 a day), `UNDO_EXPIRED` and
   `client_id` replay behave the same as the app path (shared tests).
7. Revocation tests: sign-out (revoke RPC and a deleted `auth.sessions` row), unpair/end,
   delete-account (cascade), and a token from the user's previous couple after a re-pair.
8. The read RPC returns only the allow-listed keys. A test seeds answers, thread messages,
   voice paths and a key-date title, then asserts none of them appears in the JSON. Reads for
   a free couple return the locked shape.
9. Per-token rate limits (sends and reads) and a purge job for old token rows.
10. CONTRACTS §2/§3 and the change log name the endpoint, the error codes, the token lifetime
    and the fields. SEC-21 re-reviews the PR (APPROVE before merge).

## MOB-77 (iOS) acceptance checks
1. The token is stored only in the shared keychain access group, with
   `AfterFirstUnlockThisDeviceOnly`. A plugin test asserts the entitlement on both targets.
   No `bwt_` string is ever written to the App Group (a test reads every App Group key).
2. App Intents: `openAppWhenRun = false` and `isDiscoverable = false`. Lock Screen and Control
   Center sends use the authentication policy the PO chose (default
   `.requiresAuthentication`).
3. A new `client_id` per tap. The UI shows "Sent", Undo, the limit reached and the locked
   preview from the server response, never from local guesses.
4. Refresh runs on foreground (less than 24 h left), in `BGAppRefreshTask` and after a silent
   push. The widget never mints. An expired token shows "Open Bonded" with no data.
5. Sign-out, unpair and delete-account remove the keychain item and write the empty snapshot.
   A reinstall clears a stale item.
6. Timeline and snapshot: no answer, message or voice text, and no token. The question text
   and partner name are `.privacySensitive()` on the Lock Screen.
7. Free or lapsed: the locked preview, and a tap opens the paywall `from=widget`. Analytics
   send widget kind and action only.

## MOB-78 (Android) acceptance checks
1. The token is in separate private prefs, encrypted with AES-GCM using a Keystore key, and
   excluded from backup and device transfer (a manifest/XML test).
2. The send PendingIntent is explicit, uses `FLAG_IMMUTABLE` and has a per-kind requestCode.
   The receiver is `exported="false"` and allow-lists `kind`. The work runs in `goAsync()` or
   WorkManager, off the main thread.
3. Checks 3 to 5 and 7 from MOB-77 apply (refresh via WorkManager or a push instead of
   `BGAppRefreshTask`).
4. The `bonded_widgets` snapshot never contains the token or any answer, message or voice text.

## Open points
- **PO:** may a locked phone send from the Lock Screen or Control Center (`.alwaysAllowed`), or
  must the device be unlocked first (the recommended default)?
- **PO:** is the 48 h lifetime acceptable? If the user does not open the app for 2 days, the
  widgets show "Open Bonded".
- **needs_validation (release, on a device):** that intents run with the keychain item while
  the phone is locked after first unlock, and that the `auth.sessions` check matches the hosted
  Supabase session ids.
