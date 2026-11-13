# 08a–h · Email sign-in screens (team draft for PO approval)

Decision: DESIGN_DELTA **D42** (the placeholder is fine for development; the screens are designed before launch) on top of **D35** (the email carries a 6-digit code and a sign-in link; the code is the primary path). Task: **LEAD-09**; build task: **MOB-39** (blocked until the PO approves this draft). **Status: draft. Mobile does not build from this until the PO approves it and the lead removes "team draft" from the board title and moves the scope rows below into `scope-map.json`.**

- **Board:** `source/W-email-signin.dc.html` (canvas title "08a–h · Email sign-in"). Sections 08 (keyboard rule), 08a to 08h. Light strip first, then dark, for the main states.
- **Replaces:** the placeholder email steps inside `src/features/auth/SignInView.tsx` (steps `email` and `code`). The sign-in options screen 08 and J4 stay as drawn in S02 / S02b.
- **Tokens, type, components:** `DESIGN.md` §2 to §7 only. **No new colours, no new components.** Reused: `TopBar` + `ProgressBar`, `TextField` (default, focus, error), the `CodeInput` pattern (one box per digit, as on screens 10 and J7, now six), `Button` (primary, ghost, loading), text link, `Banner` (offline) and the `Notice` card style of the existing success/error chips (tints `youTint` and `blushTint`). Bao & Bun moods from `assets/mascot/`.
- **personColors:** nothing on these screens is "you" or "partner" data; orange (`you`) is only the primary action and the focus ring, as everywhere. Error uses `blush` / `blushText` / `blushTint` (DESIGN.md: "real deadlines, errors, destructive").
- **Devices drawn:** iPhone SE 375×667 pt, iPhone 16 Pro Max 440×956 pt (DESIGN.md verified sizes), Pixel 412×915 dp. Keyboard heights drawn: SE 260 pt, Pro Max 336 pt, Pixel 300 dp (each includes the suggestion strip). The keyboard is the system's; it is drawn for its height only and never restyled.

## 1. The six screens and their states

| Board | Screen | States drawn |
|---|---|---|
| 08a | **Email entry** | empty (closed) / typed (open); not an email address; 200% text; sending (button loading) |
| 08b | **Code entry** | waiting and typing; checking; 200% text |
| 08c | **Expired code** | timed out |
| 08d | **Wrong code** | digits kept, red boxes |
| 08e | **Resend** | cooldown (60 s); new code sent |
| 08f | **Error / offline** | offline; could not send (server); too many tries (08g); sign-in link did not work (08g) |

08g adds the small-phone variants (sending, too many tries, link failed, long email wrapping). 08h is the Android pair. Every state is drawn keyboard closed and keyboard open on SE and Pro Max unless the caption says otherwise.

## 2. The keyboard rule (hard requirement)

**The keyboard must never cover or override the sign-in, continue, resend or code controls, or the focused field.**

1. **Four stacked parts** (board section 08): TopBar (56) · scroll content (mascot, title, body, field, field message) · **pinned actions** (notice, primary button, links) · keyboard.
2. **Pinned actions dock to the top edge of the keyboard.** iOS: `KeyboardAvoidingView` (behavior `padding`) keyed to the keyboard frame so the bar moves with the keyboard animation (250 ms, not after it). Android: `softwareKeyboardLayoutMode: "resize"` / `adjustResize` with edge-to-edge insets (`react-native-safe-area-context`); **never `adjustPan`**, which pushes the top of the screen out of view. Gap between the bar and the keyboard: 8 pt. With the keyboard closed the bar sits above the safe area (38 pt Pro Max, 20 pt SE, 28 dp Android gesture bar).
3. **The focused field is always visible.** On focus the scroll content scrolls so the field and its message line are above the pinned bar (`scrollToFocusedInput`; content is a `ScrollView` with `keyboardShouldPersistTaps="handled"` so a tap on a button never first dismisses the keyboard).
4. **What gives way, in order:** mascot (96 pt Pro Max / 72 pt SE closed → 48 pt Pro Max beside the title / hidden on SE open) · body copy (Pro Max keeps it; SE shows one caption line "Sent to <email>") · progress bar (hidden at 150% text and above) · title (scrolls out at 200%). **Never** give way: the field, its message, the primary button, the links.
5. **Notices ride the pinned bar** (offline, sent, link failed): so they are on screen with the keyboard up and they never push the field away. Field errors sit under the field.
6. **No state change closes the keyboard.** Expired, wrong code, cooldown, sent, offline all keep the keyboard and the focus. Only Back, success or the user closes it.
7. **At 150% text and above, Resend and "Use a different email" move from the pinned bar into the scroll content just under the field message** (they still sit above the keyboard; they scroll). The primary button stays pinned. Reason: at 200% on SE the keyboard leaves 387 pt, and three pinned rows would crowd out the field.
8. **Measured, not assumed.** The static render check run for this draft (headless Chromium, 82 phone frames) found: the pinned bar's bottom edge is at or above the keyboard top on every frame, the field is fully in view on every frame, and the field message is in view on every frame except the SE 200% code frame, where only the two links are one scroll away (rule 7). Frames that overflow are drawn scrolled to the field (title faded out at the top). QA turns this into an automated check (§9).

SE budget with the keyboard open at 100% text (387 pt visible): TopBar 56 + title 35 + gaps ~24 + field (label 20 + box 56–64) ~90 + message ~38 = ~245, pinned bar 76 (email) to 128 (code with links), leaving 14–66 spare. The worst 100% case (offline / link-failed notice + button + links) scrolls the title out, never the field.

## 3. Screen specifications and copy

Copy voice: warm, short, never guilt; say what happened, then what to do. Emails and codes shown on the board are test data (`maya@example.com`, `482913`). All strings go in `src/i18n/locales/en.json` under `auth.*` (the existing keys are reused where the text is unchanged).

### 3.1 Email entry (08a)
- **Opens from** 08 "Continue with email" or J4. Keyboard opens on arrival. Back (top bar, also Android back) returns to the three sign-in options; typed text is kept for the session.
- **Mascot** Bao & Bun `bright` (the same as 08).
- **Title** "What's your email?" · **Body** "We'll send a 6-digit code and a sign-in link. No password needed." (existing keys `auth.emailTitle`, `auth.emailBody`).
- **Field** label "Email"; placeholder "you@example.com"; focus ring 2 pt `you`. Input: `keyboardType="email-address"`, `autoCapitalize="none"`, `autoCorrect={false}`, `autoComplete="email"`, `textContentType="emailAddress"`, `returnKeyType="send"` (same action as the button).
- **Primary button** "Send code". No disabled state: an empty or malformed field shows the error below.
- **Not an email address** (no `@`, or nothing after it, or no dot in the domain): message under the field "That doesn't look like an email address. Check it and try again." (`auth.errors.email`, extended). Red 2 pt border + alert icon + the words (never colour alone), field shake 400 ms, error haptic, announced. No request is made.
- **Sending**: the button shows its loading state ("Sending…", ring icon); field locked; keyboard stays.
- **Could not send** (server error, unknown error): notice in the pinned bar "We couldn't send that email. That's on us, not you. Try again in a moment." + button "Try again"; the email text is kept; mascot `ember` (napping, never sad).
- **Offline**: same banner as the code screen (3.6), button "Send code".
- On success: go to 3.2 and start the 60 s cooldown.

### 3.2 Code entry (08b)
- **Mascot** `flicker` (waiting: the code is on its way). **Title** "Check your email". **Body** "We sent a 6-digit code to **<email>**. Enter it here, or tap the sign-in link in the email." (`auth.codeTitle`, `auth.codeBody`; the email is bold, wraps anywhere, never cut). On SE with the keyboard open the body collapses to the caption "Sent to <email>".
- **Field** = the existing `CodeInput` pattern with six boxes: **one real text input** (`autoComplete="sms-otp"` on Android, `textContentType="oneTimeCode"` on iOS, `keyboardType="number-pad"`, `maxLength={6}`, `accessibilityLabel="6-digit code"`), drawn as six display boxes (each box 64 pt tall at 100%, flexible width, minimum 40 pt; digits Outfit 700 28 pt, tabular). The caret box has the 2 pt `you` ring. Non-digits are dropped; pasting "482 913", "482-913" or "482913" fills all six. **Boxes are `importantForAccessibility="no-hide-descendants"`; the input carries the label and value.**
- **Helper line** under the boxes: "The code works for 1 hour. Nothing yet? Check spam." (clock icon).
- **Primary** "Continue" (verifies). Auto-submits when the sixth digit lands (typed, pasted or autofilled); the button stays for anyone who prefers it (open decision 1).
- **Links** (pinned, one row, 44 pt tall each, tap targets ≥ 44): "Send a new code" · "Use a different email" (returns to 3.1 with the typed email).
- **Checking**: all six digits, boxes locked, button loading "Checking…", helper "Checking your code…", `aria-busy`; keyboard stays so nothing jumps. Success navigates on (pairing, join or home per the flow); no success screen.
- **The sign-in link** from the same email also works (D35, CONTRACTS §10) and takes the user straight on; no code is needed. If the link fails (expired, opened on another device) the app returns to this screen with the notice in 3.6.
- **Autofill and paste (system behaviour, not drawn by Bonded):** iOS shows "From Mail · 482913" or the code from Messages in the suggestion strip above the number pad when the system finds a code; one tap fills all six. Android shows "Suggested" only when an autofill service has a code; paste from the clipboard always works. Do not read the clipboard without a user paste (iOS 16+ prompts otherwise).

### 3.3 Expired code (08c)
- **When:** the app's own timer says more than 1 hour since this code was sent (`otp_expiry` 3600 s in `supabase/config.toml`), including after the app was in the background; or the server answers `otp_expired` and the local timer also says expired. (Supabase returns the same `otp_expired` for expired, wrong and superseded codes, so the client cannot tell them apart from the response alone; see open decision 4.)
- **Mascot** `ember` (lid closed, napping). Boxes cleared and still typeable (the user may already hold a fresh email); caret in box 1.
- **Message** (clock icon, not red: nobody did anything wrong): "That code timed out. Codes work for 1 hour. Tap below for a fresh one."
- **Primary** becomes "Send a new code" (orange). **Link** "Use a different email". The keyboard stays; typing a fresh code and the sixth digit still auto-submits.
- Haptic: none (it is a calm state). Announce: "That code timed out. Send a new code."

### 3.4 Wrong code (08d)
- **When:** verification fails and the code is not known to be expired (wrong digits, an older email's code after a resend, or an already-used code).
- Digits stay in the boxes so a single typo is one tap; focus returns to the last box; the first edit clears the error.
- **Message** (alert icon, `blushText`): "That code isn't right. Check the newest email and try again." plus the quiet hint (mail icon, `text2`): "Asked for a few? Only the newest code works." (the hint is dropped at 150% text and above).
- Red 2 pt box borders + icon + words (never colour alone); shake 400 ms + error haptic; announced: "That code isn't right. Check the newest email and try again."
- **Primary** "Continue"; links as 3.2. After the third wrong attempt in a row the "Send a new code" link gets focus order first (no extra UI, no lockout by the app; the server's own limit applies, see 3.7).

### 3.5 Resend (08e)
- **Cooldown 60 s** after every send (first send and each resend), shown in the link row: clock icon + "Send a new code in 0:42" (tabular numerals, `text3`, no underline = not tappable). It counts down once a second on screen. The link is not a disabled button; it states what it is waiting for.
- Under the boxes after the first send: "Sent. It usually arrives within a minute. Check spam too." (mail icon).
- **Sent** (after tapping "Send a new code"): the request is sent, boxes cleared, caret in box 1, cooldown restarts at 1:00, and a notice in the pinned bar (success tint, check icon): "New code sent to <email>. Older codes stop working." Light success haptic. Stays until the next edit or 6 s. Announced: "New code sent."
- Screen reader: the countdown is **not** announced every second. It is announced once when it starts ("You can ask for a new code in 60 seconds") and once when it ends ("You can send a new code now"); `accessibilityLiveRegion="none"` on the ticking text, `polite` on the end message.
- If the server answers faster than 60 s (rate limit `over_email_send_rate_limit`) the countdown shows the server's remaining seconds when given, else restarts at 60.

### 3.6 Error and offline (08f, 08g)
- **Offline** (no connection on send or check): dark Banner in the pinned bar above the button (existing Banner pattern, `role="alert"`): wifi-off icon + "You're offline. Reconnect, then tap Continue. Your code is saved." (on the email screen: "...then tap Send code. Your email is saved."). Typed text kept. The button stays tappable; tapping offline re-shows the banner with an error haptic. Links hidden (nothing to resend while offline). Mascot `ember`.
- **Could not send** (server): see 3.1; on the code screen a failed check that is not wrong/expired shows the same notice, button "Try again".
- **Too many tries** (server limit on checks or sends): message under the boxes, alert icon: "Too many tries. Take a short break, then try again in a few minutes." Boxes kept; links hidden; mascot `ember`.
- **Sign-in link did not work** (notice in the pinned bar, alert icon, `blushTint`): "That link didn't work. Enter the code from the same email, or send a new one." (replaces `auth.errors.link`). The code boxes are shown focused and empty.

### 3.7 Behaviour notes
- **Back:** iOS back button / Android back goes code → email → options, one step each (existing `goBackOneStep`).
- **App in background** while waiting for the email: on return the timer is rechecked (expired state if over 1 hour) and the keyboard reopens on the code field.
- **Same email entered twice in a row:** allowed; the cooldown still applies.
- **No password, no account-exists wording:** the screens never reveal whether an account exists (the same copy for new and returning users).
- **J4 (joining partner):** the same two screens; the progress bar shows the join progress (1/3) instead of 4/4; nothing else differs.

## 4. Accessibility

- Every interactive element ≥ 44 × 44 pt (iOS) / 48 × 48 dp (Android): back, field, boxes (whole row focuses the input), buttons, both links.
- **Labels:** back "Back" (code screen: "Back to email"); email field "Email"; code input "6-digit code", value read as the digits typed ("4 8 2"), with the count ("3 of 6 digits"); primary button the visible label; links their visible text; the cooldown link reads "Send a new code in 42 seconds, not available yet" once at the start (see 3.5).
- **Errors are never colour alone:** border + icon + words + shake + haptic + a screen-reader announcement (`accessibilityLiveRegion="assertive"` for errors, `polite` for sent and expired). Focus stays in the field after an error; the message is the field's `accessibilityHint` so it is read with the field.
- **Order:** back, title, body, field, message, primary, links. The mascot is decorative on these screens (hidden from the screen reader; the title and message carry the meaning).
- **Text size to 200%:** drawn for the email and code screens (08a-3, 08b-3). Everything wraps; the code boxes stay on one row (they flex, digits scale, box height caps at 150%); the mascot hides when the keyboard is open; the pinned button grows; nothing is cut. At 200% the progress bar and the title may scroll out; the field, its message and the primary button never do.
- **Contrast:** text pairs are the DESIGN.md AA pairs (`blushText` on `blushTint`, `youText` on `youTint`, `text` on `surface`). The offline banner is `text` on `bg` inverted (the existing Banner).
- **Reduced motion:** mascot still poses; the shake becomes a 1-frame outline flash (the border and the message already carry the state); no countdown animation.
- **VoiceOver / TalkBack:** pasted or autofilled codes announce "6 digits entered" once.

## 5. Haptics and motion

| Moment | Motion | Haptic |
|---|---|---|
| Invalid email / wrong code | field shake 400 ms, border to `blush` | error |
| Code accepted | straight on to the next screen | success (light) |
| New code sent | notice slides in (200 ms) | success (light) |
| Expired | notice appears, no shake | none |
| Offline tap | banner re-appears | error |
| Keyboard open/close | pinned bar moves with the keyboard (250 ms, system curve) | none |
| Mascot | breathing squish idle; stills in reduced motion | none |

## 6. Analytics

Rules (D54, ANALYTICS): **no email address, domain, code or code length in any event, log, crash report or breadcrumb.** Properties are ids, numbers, booleans only. Typed `track()` only.

- **Existing events used:** `sign_in_viewed` (`context`), `sign_in_started` (`method: email`), `email_code_requested` (`resend: boolean`), `sign_in_failed` (`method`, `error_code`).
- **Proposed additions for ANALYTICS (lead owns; added with MOB-39):**
  - `email_code_verified`: `attempts` (number), `input` (`typed` | `pasted_or_autofilled`), `auto_submitted` (boolean).
  - `email_code_state_shown`: `state` (`expired` | `wrong` | `cooldown` | `too_many` | `link_failed` | `offline`), `keyboard_open` (boolean). No other properties.
- **`error_code` values** for `sign_in_failed` on email: a closed set `EMAIL_INVALID`, `CODE_WRONG`, `CODE_EXPIRED`, `RATE_LIMITED`, `OFFLINE`, `SERVER`. Never the provider's message (it can echo the address).
- Sentry: the email and the code are scrubbed from breadcrumbs, URLs and request bodies (`beforeSend` already strips auth requests; mobile adds a test for `/auth/v1/otp` and `/auth/v1/verify`).
- The mascot mood, the cooldown seconds and the text length are not sent.

## 7. Platform behaviour summary

| | iOS | Android |
|---|---|---|
| Keyboard avoidance | `KeyboardAvoidingView` + pinned bar | `adjustResize`, edge-to-edge insets, never `adjustPan` |
| Email field | `emailAddress`, `autoComplete="email"`, saved addresses in the strip | `autofillHints=emailAddress` |
| Code field | `oneTimeCode`, number pad, Mail/Messages suggestion | `sms-otp` / `autofillHints=smsOTPCode`, number pad; paste always works |
| Return key | "send" on email; "done" on code (submit) | same (IME action) |
| Back | top bar back | top bar back and system back (step by step) |
| Dismiss | tapping outside the field does not dismiss (buttons need it); swipe-down on the content (`keyboardDismissMode="interactive"`) | same |

## 8. Build notes for MOB-39 (once approved)

- Components: `TopBar`, `ProgressBar`, `TextField`, a `CodeInput` generalised to `length` (4 for invite codes, 6 here) with a single hidden `TextInput`, `Button`, text link, `Banner`, a small `Notice` (the card used for "sent" and "link failed"; built from existing tints). No new tokens.
- A `useKeyboardAwareLayout` helper (pinned-bar docking, scroll-into-view, 150% text rule) shared by the email and code steps; also reusable by screens 10, J7 and J5 later.
- Cooldown: a monotonic timer from the time the send succeeded (not wall-clock), survives rerender and a quick back-and-forth to the email step (cooldown is per email).
- Expired: a `sentAt` timestamp in memory only (never stored with the email).
- Test hooks: `testID` on `email-field`, `email-send`, `code-input`, `code-submit`, `code-resend`, `code-change-email`, notices `notice-*`.

## 9. QA acceptance (proposed task)

A new QA task (proposed; the lead adds it to BACKLOG on approval): on SE and Pro Max, light and dark, 100% and 200% text, assert that with the keyboard open (a) the pinned button's bottom edge is above the keyboard top, (b) the focused field and its message are inside the visible area, (c) Resend and Continue are tappable; for every state in §1. Also: paste "482-913" fills six boxes; the offline banner does not move the field; no email or code in any captured analytics or Sentry payload (extends QA-08).

## 10. Open PO decisions (lead default in bold; the board draws the defaults)

1. **Auto-submit on the sixth digit?** Default: **yes** (typed, pasted or autofilled), button still there. Alternative: never auto-submit (one extra tap, no accidental attempt on a typo).
2. **Resend cooldown length.** Default: **60 s** (Supabase's hosted per-user minimum between emails). Backend should set `auth.email.max_frequency` to 60 s locally too (it is 1 s in `supabase/config.toml` now) so dev matches.
3. **Progress bar on the email steps.** Default: **shown**, same as 08 (4/4) and J4 (1/3), hidden at 150% text. Alternative: hide it on the email and code steps (they are sub-steps of the same screen).
4. **Expired vs wrong.** Default: **the app's own timer decides** (Supabase returns the same error for expired, wrong and superseded codes). Alternative: one combined message ("That code isn't right, or it has timed out"), as the placeholder says today; simpler, slightly less helpful.
5. **Code lifetime shown as "1 hour".** Default: **as configured today** (`otp_expiry` 3600). A shorter life (for example 15 minutes) is more secure; it needs backend config and the copy changes with one constant.
6. **Email typo hint** ("Did you mean gmail.com?"). Default: **no** (not drawn).
7. **Remember the last used email on this device to prefill** (returning users). Default: **no** (privacy; nothing stored).
8. **Mascot moods** for these screens: `bright` (email), `flicker` (code), `ember` for expired, offline, could not send and too many tries. Default: **as drawn.**
9. **Autofill note:** the iOS "From Mail" suggestion is a system feature; nothing for Bonded to design. Confirm you are happy that Android has no guaranteed code suggestion for emailed codes (paste always works).
10. **Copy review.** All strings on the board are drafts for your approval; edits go in this spec and `en.json`.

## 11. Proposed registry entries (not applied)

Do not apply until approval. `screens.json` (design-handoff, PO-owned) rows, after `08`:

```json
{ "id": "08a", "title": "Email entry", "flow": "2 Pairing", "lane": "L1", "route": "/(auth)/sign-in (step: email)", "board": "W-email-signin", "components": "TopBar, ProgressBar, TextField, Button, Banner", "data": "Supabase Auth signInWithOtp", "notes": "Keyboard never covers the field or buttons; pinned actions; 200% text; shares with J4 (D42)", "board_file": "source/W-email-signin.dc.html", "lane_name": "onboarding-pairing" },
{ "id": "08b", "title": "Code entry (+ expired, wrong, resend, errors)", "flow": "2 Pairing", "lane": "L1", "route": "/(auth)/sign-in (step: code)", "board": "W-email-signin", "components": "CodeInput (6), Button, Banner, Notice", "data": "Supabase Auth verifyOtp; link bonded://auth/callback", "notes": "States 08c to 08g are states of this screen, not routes; paste + one-time-code autofill; 60 s resend cooldown", "board_file": "source/W-email-signin.dc.html", "lane_name": "onboarding-pairing" }
```

`scope-map.json` `screens` (lead-owned; then `node scripts/plan/generate.mjs` regenerates `SCOPE.md`):

```json
"08a": { "p": "P0", "m": "M4", "mob": ["MOB-39"], "be": ["BE-27"], "route": "/(auth)/sign-in" },
"08b": { "p": "P0", "m": "M4", "mob": ["MOB-39"], "be": ["BE-27"], "route": "/(auth)/sign-in" }
```

SCOPE note: 08 and J4 stay M2 (Apple/Google/email options). 08a and 08b are M4, P0 before launch (D42); they replace the placeholder steps. J4 uses the same screens. REL: add rows to `qa/release/screen-requirements.csv` for 08a/08b (keyboard rule, 200% text, offline, expired, wrong).

Other registry changes proposed on approval (all lead-owned): BACKLOG note on MOB-39 (acceptance: "matches `W-email-signin` boards, §2 keyboard rule passes on SE and Pro Max, light and dark, 200% text"); a QA task (§9); ANALYTICS rows (§6); a backend note to align `max_frequency` (decision 2).
