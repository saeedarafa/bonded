# SEC-23: Session replay guidance (D63), written before MOB-87

Security reviewer, 2026-11-13. Mode: focused guidance, written before the code exists (MOB-87 not built). Revision read: `origin/main` at `66a0031f`, plus D63/BACKLOG on `lead/LEAD-05-run-2026-11-13ad`. No target code was run. This is not legal advice: the EU consent part is a risk call for the lead and PO, and the privacy-policy author has to confirm it.

Sources (official PostHog docs, fetched 2026-11-13 as Markdown from posthog.com):
- [P1] `docs/session-replay/installation/react-native`
- [P2] `docs/session-replay/privacy` (React Native section, plus "Mobile session replay masking")
- [P3] `docs/session-replay/mobile` (wireframe vs screenshot mode)
- [P4] `docs/libraries/react-native/reference` (`PostHogSessionReplayConfig`, `optOut`, `optIn`, `stopSessionRecording`, `PostHogMaskView`)
- [P5] `docs/privacy/data-collection` (opt-out; cookieless table "What each mode does by consent state")
- [P6] `docs/toolbar/heatmaps`, `docs/libraries/react-native`

## Verdict summary

| Question | Verdict |
|---|---|
| App replay can be configured so no answer, message, voice, name, date or code text reaches PostHog | **Yes, conditionally.** It needs the config in A1, an **allow-list of recorded routes** (everything else wrapped in `PostHogMaskView`), a ban on `ph-no-mask`, and QA-54 on both platforms. Default masking alone is not enough (A2). |
| Opt-out ("Share usage data" off) stops replay at once | **Yes, per the docs**, if the app calls `stopSessionRecording()` and then `optOut()`. Snapshots already queued may still upload (A4). |
| App replay needs EU consent beyond "Share usage data" | **Yes, in my view.** Screen recording is not covered by the opt-out basis D54 uses for content-free counts, and the toggle copy would become untrue. **The lead must ask the PO before shipping** (A5). |
| App heatmaps | **Not supported in React Native.** PostHog heatmaps are a web toolbar feature; the RN docs list none. Tell the PO: website only. |
| Website replay with `cookieless_mode: 'always'`, no banner | **Does not work. Skip replay on the website.** PostHog's own table: `always` → session replay and surveys **No** [P5]. Making it work needs `on_reject` plus a banner, which the PO ruled out. |
| Website heatmaps with `cookieless_mode: 'always'`, no banner | **Work.** Same table: heatmaps **Yes** [P5]. Keep them, never on `/j/*`. |
| Store labels | Small change, shown in section C. The copy of the "Share usage data" toggle and the privacy policy must change. |

The flag `EXPO_PUBLIC_ANALYTICS_REPLAY` stays **off** in release builds until: (1) the PO answers A5, (2) MOB-87 meets A1–A4 and I re-review it, and (3) QA-54 passes on iOS and Android.

## A. App (`posthog-react-native` + `@posthog/react-native-plugin`)

Facts from the docs that drive this design:
- React Native always records in **screenshot mode**; wireframe mode is not available [P3]. Anything drawn on screen that the native masker does not recognise is uploaded as pixels.
- In React Native, `maskAllTextInputs` (default `true`) means "masking of all text **and** text input fields" [P4]. Plain text labels **can** be masked, but only text the native SDK recognises as a text view. The install page's comment "Whether text inputs are masked" [P1] is narrower; the reference [P4] and the privacy page ("By default all text, inputs, and images are masked") [P2] are the authority. Treat it as **needs_validation per platform** (QA-54).
- "Selectively unmasking elements is not currently available for mobile session replay. You should be more selective about which screens you capture" [P5]. PostHog itself recommends screen selection, not fine-grained masking.
- `ph-no-mask` takes precedence over `ph-no-capture` and over default masking for the whole subtree [P2]. One stray `ph-no-mask` unmasks everything under it.
- `captureLog` defaults to `true` and `captureNetworkTelemetry` defaults to `true` (iOS) [P1, P4]. Both can also be set remotely in the project replay settings (SDK ≥ 4.35) [P1].
- `captureTouches` (default `true`, plugin ≥ 2.9.0): set it to `false` "to keep screenshots without recording taps that could reveal sensitive input on a known keypad layout" [P4].

### A1. Required init options (MOB-87; extend the MOB-24 init test)

```ts
const replayOn = env.ANALYTICS_REPLAY === '1' && !isOptedOut && replayConsent; // A5
new PostHog(key, {
  host: 'https://eu.i.posthog.com',
  // existing D54 settings stay: autocapture off, surveys off, no advertising id
  enableSessionReplay: replayOn,
  sessionReplayConfig: {
    maskAllTextInputs: true,      // all text AND inputs (RN semantics)
    maskAllImages: true,          // avatars, photos, mascots: all placeholders
    maskAllSandboxedViews: true,  // iOS pickers (photo, contacts)
    captureLog: false,            // no console / logcat
    captureNetworkTelemetry: false, // no URLs (Supabase query strings carry ids/codes)
    captureTouches: false,        // no tap coordinates on the keyboard
    // sampleRate: leave unset or < 1; local value wins over remote
  },
});
```

The unit test must assert every one of these values literally, and fail if any of them is missing. Do not rely on the defaults (the project's remote config can change them, and so can a later SDK version).

**Project settings (PO in the PostHog UI, lead to record in ACCOUNTS 10):** in Replay settings, turn **console log capture** and **network capture** off as well. The docs do not say whether a local `false` beats a remote `true` for these two (they say it only for `sampleRate`), so keep both off in both places. Turning on "Record user sessions" for the app turns it on for the shared project, so the website must disable replay itself (B).

### A2. Which screens may be recorded: an allow-list, not a block-list

A block-list fails open when a new screen ships. Use the opposite:

1. A root `ReplayBoundary` in `app/_layout.tsx` wraps the navigator in `PostHogMaskView`, **unless** the current route is on a short, reviewed allow-list. Every route not on the list is recorded as one grey block (layout and timing only).
2. **Allow-list (proposed; the lead and PO can trim it):** onboarding story/quiz/plan (`(onboarding)/*`, starter, no partner data), `(auth)/sign-in` (the email input is masked), paywall/success/gift (`(offer)/*`, prices from RevenueCat only), `(pairing)/reminders`, `us/notifications`, `(tabs)/packs/index`, `store/*`. Even on these screens the A1 text masking stays on. The allow-list only means "not a solid block".
3. **Never recorded (always under `PostHogMaskView`, also if someone adds them to the list by mistake; enforce it in a unit test):**
   - 19–22 and the thread: `today/answer`, `today/reveal`, `today/revealed`, `today/thread`, `today/index` (partner name, question, answered state), `question/*`
   - 23–25 history: `history/*` including `recap`, `ended/*`
   - 31–33 voice (record, play, any waveform with a duration)
   - codes and links: `(pairing)/invite`, `(pairing)/join`, `(pairing)/waiting`, `j/[code]`, `join/*` (code, name, welcome with inviter name), `auth/callback`
   - 38 Us / key dates: `us/index`, `us/couple`, `us/badges` (names), `us/delete` (email), `us/feedback` (free text), `(pairing)/paired`, `(pairing)/partner-left`, `milestone/*`
   - little things (`FanItem` and every send/receive surface) and packs detail `packs/[packId]` (question text the couple answers)
   - any modal or sheet that shows a partner name, an answer preview, a key-date title or an invite code (the sheet sits above the route, so wrap the sheet itself)
4. **Ban `ph-no-mask`.** No `accessibilityLabel` containing `ph-no-mask` (case-insensitive substring match [P2]) anywhere in `app/` or `src/`. Add a grep test, or an ESLint `no-restricted-syntax` rule.
5. **Text that native masking cannot see:** `react-native-svg` `<Text>`, Skia, canvas and any text baked into an image are drawn as pixels, not text views. Today only `StoreScreen` uses `SvgText`, with static copy (`store.reveal.hold`). Rule: never render user data with `SvgText`, Skia or canvas; if that ever changes, the screen goes under `PostHogMaskView`.
6. **Screen names:** replay shows `$screen` names. Keep the D54 rule: route names only, never params (`j/[code]`, not `j/AB12CD`).

### A3. Native and Expo details
- Dev build only; Expo Go is not supported [P1]. Android API 26+, iOS 13+.
- Pin `@posthog/react-native-plugin` to **≥ 2.9.0** (for `captureTouches`), and keep `posthog-react-native` ≥ 4.47 (the plugin was renamed in 4.47.0+).
- `PostHogMaskView` sets `collapsable={false}`, so RN cannot flatten the wrapper away [P4]. Do not replace it with a hand-made `accessibilityLabel` on a plain `View`: that can be flattened, and it breaks VoiceOver/TalkBack labels.
- The keyboard and system sheets (share sheet, notification banners, permission dialogs) run outside the app window. The app cannot vouch for them, so QA-54 checks them (C).

### A4. Opt-out, sign-out, delete, test accounts
- **"Share usage data" off:** `await posthog.stopSessionRecording(); await posthog.optOut();`, in that order. `optOut()` "resolves once session replay has stopped" [P4]. Calling `stop` first keeps replay stopped if the person later opts back in. Turning the toggle back on calls `optIn()` and then, only if A5 consent exists and the flag is on, `startSessionRecording(false)` (a new session, not the old one).
- **Already-queued data:** "Events already queued on the device can still be sent to PostHog after the user opts out" [P5]. This is acceptable only because everything queued was recorded while the person had agreed and is masked. Mention it in the privacy policy ("may finish sending data recorded before you switched it off").
- **Cold start:** read the stored opt-out (and A5 consent) **before** constructing the client and pass `enableSessionReplay: false` when either is missing. Do not start replay and stop it a moment later.
- **Sign-out:** `stopSessionRecording()` before `reset()`, so the next account does not continue the previous person's recording.
- **Delete-account (BE-51/D54):** **needs_validation (backend).** I found no PostHog doc saying that deleting a person also deletes that person's **recordings**. If it does not, BE-51 must also delete the person's recordings, or the privacy policy must state the replay retention. Also stop replay before calling delete (SEC-16 Info 6 already asks for opt-out/reset before delete).
- **Test accounts:** `is_test_account: true` is registered before replay starts (it is a super property, so it rides on the session's events). E2E and Maestro builds keep replay **off** unless the run is QA-54. A dashboard filter on `is_test_account` hides them; that is a convenience, not a privacy control.

### A5. Does app replay need consent beyond "Share usage data" (EU/UK)? **Yes, in my view: the lead asks the PO before shipping.**

Why:
- D54 chose opt-out (default on) because the data is "pseudonymous, first-party and content-free": counts of route names and ids. A replay is a screen recording of the person's use of the app, tied to their Supabase uuid. Even masked, it is a new kind of processing, and its safety depends on the masking working on every screen, every OS version and every future release.
- The ePrivacy rule on reading from or storing on the device (Art. 5(3)) is not met by "strictly necessary" for analytics, and replay is the part of analytics regulators are most wary of. PostHog's own GDPR page says to "explicitly ask for consent" for product tracking. The current opt-out position is already flagged for the privacy-policy author (D54). Replay widens that gap rather than fitting inside it.
- The toggle copy, "Anonymous counts of what you tap, never what you write", would no longer be true. Shipping replay behind that copy is misleading regardless of law.

What I recommend the lead offers the PO (none of these is a banner):
1. **A separate setting "Share screen recordings (text hidden)", default off**, under "Share usage data", plus one line in the privacy policy. Replay runs only when both are on. This is the simplest option that is clearly OK.
2. Or replay **only for test accounts and the PO's own devices** (internal QA tool) until the privacy-policy author signs off.
3. Or the PO accepts the risk in writing after the privacy-policy author's advice, and the toggle copy and privacy policy are rewritten to mention screen recordings.

Option 2 can ship first. The flag stays off for the public until the PO picks.

## B. Website (hellobonded.com, `posthog-js`)

**Replay: skip it on the website.** PostHog's consent table for `cookieless_mode: 'always'` says: events yes, browser storage no, **session replay and surveys no**, heatmaps yes [P5]. Replay needs a persistent session id, so it needs storage, which needs `on_reject` mode plus a consent banner. The PO ruled that out ("never ask again, no banner"). ANALYTICS §5 already lists replay as off; D63's website clause resolves to "skip".

**Heatmaps: keep them**, cookieless and with no banner [P5]. Conditions:
- Set `disable_session_recording: true` explicitly in the web init. The shared project's "Record user sessions" will be on for the app (A1), so do not rely on cookieless mode alone to keep the web side off.
- Never load PostHog on `/j/*` (as ANALYTICS §5 already says). Heatmap and toolbar screenshots are taken by PostHog's Browserless service visiting the page URL [P6], so a `/j/{code}` URL must never reach a heatmap: the `before_send` query-string strip plus the `/j/*` exclusion cover this.
- `mask_all_text` is not needed (no user content on the marketing site), but keep `maskAllInputs` (the default) and never capture input values in autocapture.
- No `identify()` on the website. Optionally set `person_profiles: 'never'` [P5].

## C. Store labels, privacy policy and QA-54

**App Store (App Privacy)** (PRIV-02):
- "Usage Data → Product Interaction" is already declared (linked, analytics, not tracking). Masked replay fits there. Nothing extra is needed **if** QA-54 shows no user content in recordings.
- If any screen could leak user text, it would be "User Content → Other User Content". The design in A2 is meant to make that row unnecessary; do not ship until QA-54 proves it.
- With network telemetry and log capture off, no new "Diagnostics" use beyond Sentry's.

**Google Play (Data safety)** (PRIV-03):
- "App activity → App interactions" is already declared. Add the purpose "Analytics" if missing, and keep "not shared" (PostHog is a processor).
- If the PO picks option A5.1, mark replay as **optional** (the person chooses). If replay is on by default, mark it collected, with deletion on request (BE-51, subject to the recordings check in A4).

**Privacy policy (LEAD-20):** name session replay in the app: screenshots with text, inputs and images hidden; which screens are never recorded; how to switch it off; retention and deletion. The website section says "no recordings; cookieless heatmaps (where people click and scroll)".

**Toggle copy (mobile/PO, COPY_GUIDE):** the "Share usage data" explanation changes if replay sits under it (A5).

**QA-54 must check** (on a dev build with `EXPO_PUBLIC_ANALYTICS_REPLAY=1`, a test project or the bonded-dev project, fixture data with unique marker strings, on **both** iOS and Android):
1. Seed fixture answers, thread messages, partner name, key-date title, invite code, email and feedback text with unique markers (for example `QA54-ANS-…`). Visit every route in A2.3 and the allow-listed routes. In the PostHog player, no marker is readable on any frame. Excluded routes show one solid block. Include sheets, modals, the reveal animation, the history recap and the voice screens.
2. The keyboard is up while typing an answer or a code: no keys or typed characters are readable, and there are no tap dots (`captureTouches: false`).
3. Recordings have no console/logcat entries and no network panel entries (iOS and Android). Check this with the project replay settings in their production state.
4. Turning "Share usage data" off mid-session: no new frames after the switch (check by timestamp). After a cold start with it off: no recording at all. Turning it back on: a new session only (and only with A5 consent).
5. Sign-out followed by sign-in as a second test account: two separate recordings, never one recording that spans both.
6. Delete-account: the person's recordings are gone or have a documented retention (A4 needs_validation).
7. A static check on the code: `ph-no-mask` appears nowhere, and every route not on the allow-list renders under `PostHogMaskView` (unit test from MOB-87; QA confirms it runs in CI).
8. Website: no `/s/` or `/e/?…$snapshot` replay requests from hellobonded.com; no PostHog requests at all on `/j/*`; heatmap data present for `/`; no cookies or localStorage keys from PostHog.
9. Release builds have the flag off until the lead records the PO's A5 answer and my MOB-87 review.

## Open items and owners
- **Lead → PO:** the A5 consent question (options 1–3). Also tell the PO that app heatmaps are not available in React Native.
- **Mobile (MOB-87):** A1–A4; ask me to review the PR.
- **Backend (BE-51):** whether PostHog person deletion removes recordings (needs_validation).
- **PO (PostHog UI, ACCOUNTS 10):** replay console log and network capture off in the project settings.
- **Lead (LEAD-04, ANALYTICS §5):** the website stays replay off, with `disable_session_recording: true` explicit; heatmaps stay on.
- **Lead (LEAD-20, PRIV-02/03):** privacy policy and labels as in C.

Unverified (docs only, not run): the RN text-masking coverage on Fabric text views; whether a local `captureLog`/`captureNetworkTelemetry` `false` overrides a remote `true`; recordings deletion with the person. QA-54 and the backend check close these.

## Addendum (2026-11-13): reviews of #439, #441 and #440

- **#439 MOB-87 (head `4c90fe5`): APPROVE to merge with the flag off.** A1–A4 are met in code and tests. Fix before flag-on:
  1. Allow-listed screens show first names: `(onboarding)/plan/building`, `plan/trial`, `plan/moment`, `(offer)/paywall`, `success`, `gift`, `(pairing)/reminders` and `(tabs)/packs`. Either move them to the never list or mask the name line, or prove the masking with a name marker in QA-54. This corrects my A2.2 proposal, which allowed some of these screens.
  2. When you go back from a never-recorded screen to an allowed one, `useSegments()` unmasks the boundary while the never-recorded screen is still sliding out (needs_validation in QA-54; a possible fix is to keep the mask until `transitionEnd`).
  3. QA-54 also checks `Alert.alert`, the share sheet and permission dialogs.

  Flag-on is still blocked by: A5 (the code has no separate replay consent), QA-54, the project replay settings, BE-51 recordings deletion and LEAD-20.
- **#441 MOB-24 Sentry (head `8e58395`): APPROVE.** Low: on iOS, `enableNetworkBreadcrumbs` (default true) adds native request URLs, including query strings, that skip the JS `beforeSend` and `beforeBreadcrumb` on native crashes. Set it to `false`. Info: the DSN is in Sentry's **US** region, so the privacy policy must name the US transfer (or the PO moves the org to the EU); turn on Sentry's "Prevent storing IP addresses" and data scrubbing.
- **#440 website (merged `a625145`):** this matches B. No replay. It is cookieless with memory persistence and no person profiles. It never runs on `/j/*` (script guard plus CSP `connect-src 'none'`). Query strings are stripped except `utm_*`. The CSP is limited to the PostHog EU hosts. No issue filed. Info: lazy extensions from `eu-assets.i.posthog.com` have no SRI; an uppercase `/J/<code>` path is not covered by the guard.
