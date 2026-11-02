# Bonded: design system

Read this before building any screen. Values here are the source of truth; `tokens/tokens.json` holds the same values in machine-readable form, and `tokens/theme.ts` wires them into Expo.

Live canvas (all screens, animated): https://claude.ai/artifact/RCcSEiQijYMB6wB1EZXsug. It's private until the owner shares it. `source/` holds the same boards as `.dc.html` files.

## 1. The idea

A daily question for couples. Both partners answer, answers stay locked until both have replied, then they reveal together and talk about it.

The mascot is two dumplings: **Bao** (the viewer, orange blush) and **Bun** (their partner, sky blush). Their mood mirrors the ritual. They are never sad, only sleepy. Copy talks about being together and your bond, not about the steamer; steam and the lid are only part of the artwork.

## 2. Color

### Rule 1: colors are relative to the viewer
- `you` (orange) is always the signed-in user, `partner` (sky) is always the other person.
- On Maya's phone Maya is orange; on Sam's phone Sam is orange.
- There is no gender field. In code: `const isMe = item.user_id === session.user.id`, then `personColors(colors, isMe)`.

### Rule 2: one job per color
| Token | Light | Dark | Only for |
|---|---|---|---|
| `bg` | #F7EFE3 | #1B140F | Screen background |
| `surface` | #FFF9F1 | #261C16 | Cards, sheets, tab bar |
| `surface2` | #F1E4D2 | #32261E | Chips, inactive tiles |
| `line` | #E2CFB5 | #3E3027 | Borders, dividers |
| `text` / `text2` / `text3` | #2A1407 / #6B5442 / #735B49 | #F6ECDF / #CDBBA8 / #A8927E | Primary / supporting / captions |
| `you` · `youText` · `youTint` | #FF8A4C · #A3461A · #FFE3D1 | same · #FFA676 · #4A2A18 | The viewer, primary actions |
| `partner` · `partnerText` · `partnerTint` | #9CC9FF · #2A5F94 · #DCEBFF | same · #A9D0FF · #1F2C3A | The partner |
| `premium` · `premiumText` · `premiumTint` | #E9BA52 · #8A6512 · #FBF0D6 | same · #F0C96A · #2E2414 | Premium only, never elsewhere |
| `blush` · `blushText` · `blushTint` | #FF7F8B · #B3263A · #FBE3E6 | same · #FF9AA4 · #3A1A1E | Hearts, real deadlines, errors, destructive |
| `bamboo` | #B08A5A | #8C6A44 | Mascot art only (basket and lid) |

### Rule 3: never use a bright fill as text on cream
- Orange, sky, gold and blush fills are too light to read as text on the cream background.
- Use the `*Text` shade instead. All text pairs pass WCAG AA (4.5:1). Checked pairs are on the Foundations board.

## 3. Type
- **Fonts:** Outfit for display, buttons and numbers; DM Sans for body. Load both with `@expo-google-fonts`.
- **Numbers that change** (streaks, countdowns, counters) use tabular numerals: `fontVariant: ['tabular-nums']`.

| Style | Font | Size / line | Weight |
|---|---|---|---|
| display | Outfit | 40 / 44 | 800 |
| h1 | Outfit | 30 / 35 | 700 |
| h2 (questions) | Outfit | 21 / 27 | 600 |
| button | Outfit | 17 / 22 | 700 |
| body | DM Sans | 16 / 24 | 400 |
| label | DM Sans | 15 / 20 | 600 |
| caption | DM Sans | 13 / 19 | 500 |

Support Dynamic Type and font scaling up to 200%. Layouts wrap and stack; never truncate a question or an answer.

## 4. Space, radius, size
- **Spacing:** 4pt grid (4, 8, 12, 16, 24, 32, 48). The screen gutter is 24.
- **Radius:** tile 7, chip 15, input 16, card 22, sheet 32. Buttons and pills are fully round.
- **Touch targets:** 44 × 44 minimum everywhere, including icon buttons and reaction pills.
- **Fixed sizes:** primary button height 56; tab bar 80 plus the safe area.
- **Design frames:** screens are drawn at 390 × 844 (iPhone 15). Store screens are verified at 440 × 956 pt (iPhone 16 Pro Max) and 412 × 915 dp (Pixel). Use flex, not fixed heights.

## 5. Mascot: Bao and Bun
Six moods. SVG stills are in `assets/mascot/`; animate them in production with Rive (one state machine) or Lottie (one file per mood).

| Mood (file) | `mood` prop on canvas | When |
|---|---|---|
| together | bright | Both answered today |
| celebrating | glow | Reveal, milestones, gift, premium |
| waiting | flicker | You answered, partner hasn't (or the reverse) |
| snuggled | duo | Just paired, anniversaries, paywall hero |
| saving-a-seat | spark | Partner hasn't joined yet, empty states |
| napping | ember | Missed day: lid closed, napping, never sad |

Rules:
- Blush shows whose dumpling it is, and it's relative to the viewer, like everything else.
- Steam means activity. The lid means rest.
- Never crying, angry or permanently apart. Don't recolor the dough. Minimum size is 24px; below 40px, drop the eyes and keep the blush dots.
- Screen-reader labels describe the state, e.g. "Bao and Bun, waiting. Sam hasn't answered yet."

## 6. Motion and haptics
- **Library:** Reanimated 3 for UI motion, Expo Haptics for feedback.
- **Durations:** fast 200 ms, base 300 ms, slow 500 ms, celebrate 1.6 s.
- **Easings:** standard `cubic-bezier(.2,.8,.2,1)`; squish `cubic-bezier(.34,1.56,.64,1)`.

| Moment | Animation | Plays | Haptic |
|---|---|---|---|
| Mascot idle | Breathing squish 2.6 s, blink every 4.2 s, steam | Loop | — |
| Waiting | Bao wobbles 2 s, Bun sleeps | Loop | — |
| Hold to reveal | Ring fills over 1.2 s, lid lifts, card unblurs | Once | selection ticks → success |
| Both answered | Squash-and-stretch bounce, heart pops | Twice | success |
| Badge unlocked | Badge pops, ladder step fills | Once | heavy |
| Milestone | Jump together, sesame-seed confetti | 3× | heavy |
| Chat messages, notifications | Pop or slide in | **Once only** | — |
| Countdowns | Tick every second | Live | — |
| Loading | Skeleton pulse 1.4 s (never a spinner for content) | Loop | — |
| Nudge bell, gift box, offer chip | Ring / wiggle / pulse | Loop | light on tap |
| Field error | Shake 400 ms | Once | error |

Reduced motion:
- Mascots switch to still poses.
- Confetti, bounces and pulses are removed; badges fade in instead of popping.
- Hold to reveal becomes a tap with a confirmation.

## 7. Components (build once, share everywhere)
Each component, with its states, is on the Components board (`source/DS-Components.dc.html`).

- **Buttons:** `Button` (primary, premium, ghost, destructive, text link; states: default, pressed, focus, loading; no disabled state, explain what's missing instead).
- **Chips and avatars:** `Chip` (neutral, streak, countdown, premium, partner, status), `Avatar`, `AvatarPair`.
- **Inputs:** `TextField` (default, focus, error + message), `AnswerField` (character counter /500), `CodeInput` (4 digits + "BND" prefix).
- **Selection:** `Toggle`, `OptionRow` (radio and checkbox), `FeedbackPill`, `PlanCard`.
- **Cards:** `QuestionCard`, `AnswerCard`, `PerkTile`, `PackTile`.
- **Chat:** `ChatBubble` (me / partner), `ReactionPill`, `TypingIndicator`, `Composer`.
- **Progress:** `ProgressBar`, `HoldToReveal` (ring), `BadgeLadder` (1-3-7-14-21-30-50-100-365), `Heatmap` (both / one / missed / today), `Skeleton`.
- **Navigation and overlays:** `TabBar` (Today, History, Packs, Us), `TopBar`, `Sheet`, `Toast`, `Banner` (offline), `Confetti`.
- **Mascot and widgets:** `Mascot` (mood, size), plus home and lock screen widgets (native; see flow 8).

## 8. Copy voice
- Warm, short, never guilt. Say what happened, then what to do.
- Use the partner's name ("Sam answered"), never "your partner" when the name is known.
- Prices are always placeholders (`[PRICE]`) filled from RevenueCat offerings. Never hard-code them.
- No fake ratings, reviews or awards anywhere.
