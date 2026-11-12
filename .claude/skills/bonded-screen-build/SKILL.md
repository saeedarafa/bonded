---
name: bonded-screen-build
description: Turn a Bonded design-handoff screen into a production Expo/React Native screen. Covers reading the board and spec, tokens and personColors, components, mascot, motion and haptics, accessibility, states, data wiring and verification. Use when building or reviewing any app screen or component.
---

# Building a Bonded screen

## 1. Gather the spec (in this order)
1. Find the screen in `design-handoff/screens.json`, by id (`20`, `J7`, `52b`). It gives you the route, components, data, notes and `board_file`.
2. Read its row in `design-handoff/specs/L*.md` and in `docs/plan/SCOPE.md` (priority, milestone, tasks).
3. Open `design-handoff/<board_file>`. It's HTML with inline styles: copy, spacing and colours can be read directly. The live animated canvas is linked in `design-handoff/README.md` (private; ask the PO for access).
4. Map the proposed data names to real ones. The spec's `Data` column is a *proposal*; the truth is `docs/CONTRACTS.md` §2 plus the `decided` rows in `docs/plan/DESIGN_DELTA.md`. Examples: `invite.redeem(code)` is `accept_invite(p_code)`; `answer (insert)` is the `answers` upsert; `nudge` is `send_nudge()`. If nothing maps, put it under *Needs from backend*.

## 2. File layout
```
app/(tabs)/today/reveal.tsx            route only: export { default } from '@/features/daily/screens/RevealScreen'
src/features/daily/
  api.ts            Supabase calls (typed with Database)
  hooks.ts          useTodayQuestion(), useRevealPartner() ... (TanStack Query)
  screens/RevealScreen.tsx
  components/       screen-specific pieces
  __tests__/
src/ui/             shared components (DESIGN.md §7) + theme.ts
src/lib/            supabase, queryClient, queryKeys, realtime, errors, analytics, i18n
```

## 3. Visual rules (from DESIGN.md, non-negotiable)
- **Colours relative to the viewer:**
  ```ts
  const isMe = row.user_id === session.user.id;
  const pc = personColors(colors, isMe);
  ```
  Orange = me, sky = partner, on *both* phones. Gold only for premium. Blush only for hearts, deadlines, errors and destructive actions.
- **Never a bright fill as text on cream.** Use `youText`, `partnerText`, `premiumText`, `blushText`.
- **Tokens only.** Use `useTheme()` for colours, `type.*`, `space.*` (4 pt grid, gutter 24), `radius.*` and `size.*`. A raw hex value or a number font size in a screen is a bug.
- **Fonts:** Outfit for display, buttons and numbers; DM Sans for body. Numbers that change get `fontVariant: ['tabular-nums']`.
- **Buttons have no disabled state.** If an action isn't possible yet, say what's missing.
- **Prices** come from RevenueCat offerings (`[PRICE]` in the boards). Never hard-code them.

## 4. Mascot
- `<Mascot mood="waiting" size={120} label={t('mascot.waiting', { partner })} />`
- Moods: together, celebrating, waiting, snuggled, saving-a-seat, napping. Never sad.
- Blush is relative to the viewer: Bao = me.
- Below 40 px, drop the eyes. Reduced motion means a still pose.

## 5. Motion and haptics (DESIGN.md §6)
- Reanimated 3. Durations: 200 / 300 / 500 ms, celebrate 1.6 s. Easing: standard `Easing.bezier(.2,.8,.2,1)`, squish `Easing.bezier(.34,1.56,.64,1)`.
- Chat messages and notifications animate **once**. Content loading uses a `Skeleton`, never a spinner.
- Haptics:
  - hold to reveal: selection ticks, then success;
  - badge or milestone: heavy;
  - field error: error, plus a 400 ms shake.
- `useReducedMotion()`: no confetti, bounces or pulses; badges fade; hold-to-reveal becomes a tap with a confirm.

## 6. States every screen must have
Loading (skeleton) · empty · error (mapped code from `errors.ts`, plus a retry) · offline (banner; queue writes where the design says) · partner-not-joined (where relevant) · light **and** dark. Missing from the design? Use a neutral version and add a line to `docs/design/GAPS.md`.

## 7. Accessibility checklist
- [ ] Every touchable is 44 × 44 pt or more (use `hitSlop` for small icons).
- [ ] `accessibilityRole` and `accessibilityLabel` on icon buttons, reaction pills (`"Love, selected"`) and the mascot.
- [ ] Dynamic Type up to 200%: text wraps; questions and answers are never truncated; rows stack.
- [ ] Focus order follows the visual order; modals trap focus; Android back closes sheets.
- [ ] Colour is never the only signal (status chips carry text).
- [ ] Screen-reader announcement for reveal, new message, errors.

## 8. Data wiring rules
- Supabase calls only in `api.ts`, called only from Query hooks; keys from `queryKeys.ts`.
- Realtime events only `invalidateQueries`; never trust the payload.
- Writes are optimistic where the design implies instant feedback (answer, reaction, message), with rollback and a "Not sent — retry" state.
- No security logic on the client. If RLS hides it, it's absent; don't filter.
- Never log or track answer or message text.

## 9. Verify before you call it done
1. `npx tsc --noEmit && npm run lint && npm test`
2. Seed a scenario (`npm run qa:scenario <name>`) and walk the screen on the **iOS simulator and the Android emulator**, as both personas where the screen differs per viewer.
3. Compare against the board in light and dark; check 200% font and reduced motion.
4. Add new shared components to `/dev/gallery`.
5. PR with screenshots (light and dark, both platforms) and the screen id in the title.

**Simulators (AGENTS.md non-negotiable).** Use only `REL-A` (iPhone 16 Pro Max, iOS 18.0) and `REL-B` (iPhone SE 3rd, iOS 18.0): `xcrun simctl list devices | grep -E "REL-A|REL-B"`. Never `xcrun simctl create` (or create one in Xcode) and never delete REL-A/REL-B. Run `xcrun simctl list devices booted` and `adb devices` first; never take a device another agent is using. Up to three agents may use devices at once, each on its own device (REL-A, REL-B, emulator-5554); a two-device Maestro flow (pairing, daily, reveal) takes two of them; never boot a third iOS simulator. `xcrun simctl shutdown <udid>` (or kill the emulator) what you booted when done.
