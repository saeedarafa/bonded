# 38c · Premium widgets (team draft for PO approval)

Eight Premium widgets for the Home Screen, plus Lock Screen widgets and an iOS 18 Control Center control. Decision: DESIGN_DELTA **D59** (extends D47; the two free 38b widgets, Countdown and Partner answered, stay free and unchanged). Task: LEAD-17. **Status: draft. Mobile does not build from this until the PO approves the PR.**

- **Board:** `source/W38c-Premium-widgets.dc.html` (canvas title "38c · Premium widgets"). Sections 38c-1 to 38c-12. Every Home Screen set is drawn twice: light strip, then dark strip.
- **Tokens:** `DESIGN.md` §2–4 only. No new colours. personColors as everywhere: the viewer is orange (`you`), the partner is sky (`partner`). Gold (`premium`) appears only on the locked preview.
- **Mascot:** Bao & Bun still poses from `assets/mascot/` (the six moods). Widgets cannot animate, so a state change swaps the still pose. The board imports the animated `Dumplings` component and turns its animation off inside widgets.
- **Builders:** iOS = WidgetKit + App Intents (MOB-77), Android = Glance (MOB-78), backend Premium check on widget sends = BE-60, sign-in model = SEC-21, QA = QA-49, release = REL-10.

## 1. Rules for every widget (non-negotiable)

1. **No answer or message text, ever,** on any widget, Lock Screen widget, StandBy, Control Center or Android widget (reveal rule, FUN-04). Little things show only their **kind, count and time**. Today's question and On this day show **the question text only**.
2. **Lock Screen privacy.** On Lock Screen widgets, the question text and the partner's name are marked `privacySensitive()`. While the device is locked they are redacted (system placeholder bars) and the partner's name is replaced by neutral copy ("A hug for you · 9:14"). Home Screen widgets follow the system's "Allow access when locked" setting the same way. Android: Lock Screen widgets do not exist on phones; Glance widgets hide question text when `KeyguardManager.isDeviceLocked` (Pixel "At a Glance" / hub mode).
3. **Premium is enforced on the server** (BE-60). A widget send calls `send_little_thing` marked as coming from the widget; the DB refuses it for a free couple (`PREMIUM_REQUIRED`). The widget never decides Premium alone. One partner's Premium covers both.
4. **Free or lapsed Premium → locked preview** (38c-9): the widget's own name, a gold `Premium` chip with a lock, a still mascot, one line saying what it does, "See Premium". Tap opens the paywall with `from=widget` (and `widget_kind`). No fake data behind a blur: the preview shows no couple data at all.
5. **Sign-in** follows SEC-21: no long-lived token readable in the shared app group; a scoped, short-lived widget token. When it has expired or the user signed out: "Tap to catch up" + **Open Bonded** (38c-9). The widget keeps no data from before.
6. **Ended couple** (38c-9): napping pose (lid closed), "This widget is resting", **Open Bonded**. No partner name, no counts, no history. Never sad wording, never "breakup" wording.
7. **Not paired yet:** "Saving a seat" + **Send invite** (opens the invite screen).
8. **Analytics:** widget kind and action only (`widget_kind`, `action`: `view_locked`, `tap_open`, `send`, `undo`, `send_failed`). Never question ids, names or counts. ANALYTICS owner (lead) adds the events with LEAD-18.
9. **Copy voice:** warm, short, never guilt. Use the partner's name when known. No countdown on limits.
10. **Tap targets:** every button inside a widget is at least 44 × 44 pt (iOS interactive widgets) / 48 × 48 dp (Glance). The whole widget is also a tap target that opens the app at the right place.

## 2. Sizes

| Platform | Family | Size (design) | Notes |
|---|---|---|---|
| iOS | small | 158 × 158 pt (iPhone 15) | SE 148, Pro Max 170. Same layout, flex; content margin 14–16 |
| iOS | medium | 338 × 158 pt | SE 321, Pro Max 364 |
| iOS | large | 338 × 354 pt | Not drawn. Proposal: none in v1 (no widget needs it). PO to confirm |
| iPad | small / medium / extra large | system sizes | Same small and medium layouts; no extra large in v1 |
| iOS Lock Screen | circular, rectangular, inline | 72 pt circle; 160 × 72 pt; one line | Monochrome (vibrant) rendering |
| iOS 18 Control Center | control, 1 × 1 and 2 × 1 | system | Also on the Lock Screen bottom controls and the Action button |
| Android | 2 × 2, 4 × 2, 4 × 1 | ~152 dp, ~320 × 152 dp, ~320 × 72 dp | Resizable: 2 × 2 → 3 × 2 keeps the small layout; 4 × 2 → 5 × 3 keeps the medium layout centred; 4 × 1 → 5 × 1 |

Corner radius: iOS uses the system widget shape (`containerBackground`); Android 24 dp (`system_app_widget_background_radius` when available).

## 3. The eight widgets

Each row: what it shows, where a tap goes, the states drawn on the board. Deep links use the existing `bonded://` routes (CONTRACTS).

### 3.1 Little things (38c-1) · small, medium, Lock Screen, Control Center
- **Small:** the time-of-day little thing, same rule as the in-app button: 05–11 Good morning, 11–20 Hug, 20–05 Goodnight (local time). Big orange round button + "Send Sam a hug" + "Tap to send". **One tap sends it without opening the app** (App Intent / Glance `actionRunCallback`) via `send_little_thing(p_kind, 1, p_client_id)`. Kiss bursts and long hugs stay in the app (a widget tap = 1 kiss / a short hug).
- **Medium:** all five in the in-app order (Good morning, Hug, Kiss, Miss you, Goodnight). The time-of-day one is filled orange; the others are outlined.
- **States:** default (each time window), **sent** ("Sent to Sam 🤍", snuggled pose, **Undo** for 5 s, then back to default), **limit reached** (button grey with a dashed outline; for goodnight/good morning: "Goodnight sent · Back tomorrow"; for a capped hug, kiss or miss you: "Hugs are done for today"; no countdown, no guilt; free couples never reach this from a widget because the widget is locked), **send failed / offline** ("Couldn't send · Tap to try again"; the same `p_client_id` is reused so a retry counts once), locked, ended, expired.
- Undo calls `undo_little_thing(id)`; the server window is 5 s, so the widget shows Undo for 5 s at most and then reloads its timeline.
- Haptic on send where the platform allows (iOS: system; Android: none).
- A11y label: "Little things. Send Sam a hug. Double tap to send."

### 3.2 Thinking of you (38c-2) · small, medium, Lock Screen rectangular
- The last little thing the partner sent: kind (+ count for kisses) and time: "Sam sent a hug · 9:14", partner-tinted icon (sky). Button **Send one back** sends the same kind.
- Medium: mascot + "Sam sent 3 kisses" + "Today · 9:14" + **Kiss back** and **Hug**.
- **States:** default, sent back ("Hug back sent 🤍"), **partner never sent anything** ("Nothing from Sam yet" + **Send a hug**), locked, ended, expired. After 24 h without a new one it keeps the last one with its day ("Yesterday · 21:40"); after 7 days it switches to the never-sent layout with "Send Sam a hug".
- An undone gesture disappears from the widget on the next reload.

### 3.3 Days together (38c-3) · small, medium, Lock Screen rectangular/inline, StandBy
- "1,284 days together" counted from the relationship start date in key dates; the next key date: "Anniversary in 12 days". Medium shows the next two ("12 days to your anniversary", "48 days to Sam's birthday").
- **States:** default, **on the day** ("Happy anniversary · 4 years together today", celebrating pose), **no key dates** (count from pairing: "212 days in Bonded" + **Add dates**, opens key dates), locked, ended, expired.
- Tap: Us tab, key dates.

### 3.4 Streak (38c-4) · small, medium, Lock Screen circular, StandBy
- Count ("12 · days, both of you"), progress to the next badge on the ladder 1-3-7-14-21-30-50-100-365 ("2 days to badge 14"), streak saver available or not. Medium shows the ladder (done steps orange, next step dashed).
- **States:** default, **missed day with a saver** (napping pose, "Saver ready" + **Use saver**: opens the app's streak saver sheet; the widget never spends a saver by itself), missed day without a saver (napping, "New streak starts with today's question"), **no streak yet** ("Start a streak today · Both answer, day one."), locked, ended, expired.

### 3.5 Today's question (38c-5) · small, medium, Lock Screen rectangular
- The question text only + **Answer now** (opens `bonded://today`). Never the answer, never a hint of it.
- **States:** not answered, **you answered** ("You answered · waiting for Sam", lock icon), **both answered** (**Reveal together**: opens Today, where the hold-to-reveal happens), Sam answered (medium: "Sam answered" next to **Answer now**), locked, ended, expired.
- Long questions: up to 3 lines on small, 3 on medium, 2 on the Lock Screen; the rest is cut with "…" (the only place a question may be cut: the full text is one tap away). This is a documented exception to DESIGN.md §3 "never truncate a question", and needs PO approval.

### 3.6 Bao & Bun mood (38c-6) · small
- Just the mascots, large, with one short line. Pose follows the couple's day: waiting (neither answered) → `waiting`; one answered → `waiting` with "Sam answered · Your turn" or "You answered · Sam's turn"; both answered → `together`; revealed → `celebrating`; missed day → `napping` ("New question at midnight"). Never sad.
- Tap: Today.

### 3.7 On this day (38c-7) · small, medium
- "On this day · 2025" + the question both answered a year ago. Tap opens that day in History (`bonded://question/{couple_question_id}`); the answers are only in the app.
- **Fallback (proposal):** if there is no answered day exactly a year ago, show 6 months ago, then 1 month ago, with the label changed ("6 months ago you both answered"). If none: "Memories start here · Next month this shows a question you both answered."
- History lock (D55) still applies in the app: a free couple's old day opens locked, but this widget is Premium anyway.

### 3.8 Ritual time (38c-8) · small, medium, Lock Screen circular/inline
- Time left to the couple's ritual time: "2h 14m · to your ritual" (tabular numbers; iOS uses `Text(timerInterval:)` so it counts without timeline reloads; Android updates every 15 min and shows "2h 15m" style rounding).
- **States:** before, **at ritual time** ("It's ritual time" + **Answer together**; medium says "Answer together now"), **both answered** ("Done for today · See you tomorrow at 21:00"), **no ritual time set** ("Pick your ritual time" + **Choose a time**), locked, ended, expired.

## 4. Lock Screen and Control Center (38c-10)

- **Circular:** Send a hug (one tap, same intent as 3.1; after sending shows a check and "Sent" for 5 s), Streak ("12 days"), Ritual ("2h ritual"). Locked (free): a lock and "Premium"; tap opens the app on the paywall.
- **Rectangular:** Today's question (redacted when locked), Thinking of you (name replaced when locked), Days together.
- **Inline:** "🔥 12-day streak · ritual 21:00" style, one line, no names, no question.
- Rendering: monochrome / vibrant only; no orange. The mascot is not used on the Lock Screen (too small and monochrome).
- **Control Center (iOS 18 `ControlWidgetButton`):** "Send a hug · Bonded". States: default, **sent** (check, "Sent to Sam 🤍", tinted orange; Undo only in the app), **Premium** (lock, "Premium · opens Bonded": opens the paywall `from=widget`), **hugs done today** (dimmed, "Opens Bonded"). The control's tint is `you` orange. The same control can be placed on the Lock Screen bottom row and the Action button.
- Sending from the Lock Screen while the device is locked: **proposal: no Face ID needed** for Send a hug (it reveals nothing, and one tap is the point of the feature). Opening anything that shows content still requires unlocking. SEC-21 decides.

## 5. Android (38c-11)

- Same content, states and copy as iOS. Glance layouts: 2 × 2 = iOS small, 4 × 2 = iOS medium, 4 × 1 = a one-line bar (Days together, Streak, Ritual time).
- **Material You (Android 12+):** default is **Bonded colours** (cream / dark brown surfaces). If the user has dynamic colour on, surfaces, chips and secondary text take the wallpaper colours (`GlanceTheme` dynamic `surface`, `surfaceVariant`, `onSurface`), while **Bao & Bun, the orange send action and personColors stay** (Rule 1: orange is always the viewer). Drawn: sage and lilac wallpapers. Dark mode follows the system.
- Sends use a Glance `ActionCallback` → the same RPC; no app launch. Undo: a 5 s "Undo" chip.
- Android has no Lock Screen widgets on phones and no Control Center; a Quick Settings tile "Send a hug" is a possible later addition (not in v1, PO to decide).

## 6. Every device and mode (38c-12 and rules)

- **StandBy (iOS):** small widgets show scaled up on black. Use the system background removal (`containerBackgroundRemovable`); text stays `text` on dark. In **night mode** (red) the system tints everything red; the mascot is still readable as a shape. Days together and Streak are the StandBy candidates.
- **iOS 18 tinted:** `widgetRenderingMode == .accented`: the orange button and the icon become the accent group (`widgetAccentable()`); the mascot uses `widgetAccentedRenderingMode(.desaturated)` so it stays a soft still, not a flat blob. **Clear:** surfaces become glass and text turns white; the orange button follows the system's accent rendering.
- **Light / dark:** every widget on the board, both strips. Dark uses the dark token column; the orange button keeps `#2A1407` text in both modes (contrast 7.5:1). Checked text pairs used on the board: `premiumText` on `premiumTint` 4.7:1 light / 9.6:1 dark, `youText` on `surface` 5.8:1, `partnerText` on `partnerTint` 5.5:1, `text2` on `surface` 6.8:1 light / 8.9:1 dark.
- **Largest text sizes:** widgets do not scale with Dynamic Type beyond the system's widget limits, but at the AX sizes the small layout **drops the sub line first**, then the chip, never the name or the action. Names are never cut mid-word at default sizes (see long names). Android: `sp` units; same drop order.
- **Long names:** the widget uses the partner's display first name. If it does not fit on two lines, it is shortened with "…" at a word boundary or after 12 characters ("Sent to Alexandria-Jo… 🤍"). The accessibility label always has the full name.
- **Right to left (Arabic, Hebrew):** layouts mirror (chip and mascot swap sides, buttons align right); the five little things keep their order from the reading start; numbers stay in Western digits unless the locale uses others; the 🤍 and icons do not mirror (they are not directional). Drawn once as a layout reference on 38c-12 (placeholder Arabic text, to be translated properly).
- **iPhone SE to Pro Max, iPad:** same layouts at each family size (flex, no fixed positions). SE small (148 pt) is the tightest: checked copy fits there at default text size.
- **Reduce Motion / Transparency:** widgets are still anyway; with Reduce Transparency the clear mode falls back to solid surfaces.

## 7. Copy (proposed `widgets.*` i18n keys, en)

| Key | Text |
|---|---|
| `widgets.littleThings.name` | Little things |
| `widgets.littleThings.send.hug` | Send {partner} a hug |
| `widgets.littleThings.send.morning` | Say good morning |
| `widgets.littleThings.send.night` | Say goodnight |
| `widgets.littleThings.tapToSend` | Tap to send |
| `widgets.littleThings.sent` | Sent to {partner} 🤍 |
| `widgets.littleThings.undo` | Undo |
| `widgets.littleThings.onceADay` | {kind} sent · Back tomorrow |
| `widgets.littleThings.limit` | {kinds} are done for today |
| `widgets.littleThings.failed` | Couldn't send · Tap to try again |
| `widgets.thinking.got` | {partner} sent {thing} · {time} |
| `widgets.thinking.gotLocked` | A {thing} for you · {time} |
| `widgets.thinking.sendBack` | Send one back |
| `widgets.thinking.never` | Nothing from {partner} yet |
| `widgets.days.count` | {n} days together |
| `widgets.days.inBonded` | {n} days in Bonded |
| `widgets.days.next` | {event} in {n} days |
| `widgets.days.addDates` | Add dates |
| `widgets.streak.days` | days, both of you |
| `widgets.streak.nextBadge` | {n} days to badge {badge} |
| `widgets.streak.saverReady` | Saver ready |
| `widgets.streak.start` | Start a streak today |
| `widgets.question.answerNow` | Answer now |
| `widgets.question.waiting` | You answered · waiting for {partner} |
| `widgets.question.reveal` | Reveal together |
| `widgets.onThisDay.yearAgo` | A year ago you both answered |
| `widgets.onThisDay.empty` | Memories start here |
| `widgets.ritual.left` | to your ritual |
| `widgets.ritual.now` | It's ritual time |
| `widgets.ritual.answerTogether` | Answer together now |
| `widgets.ritual.done` | Done for today |
| `widgets.locked.cta` | See Premium |
| `widgets.ended` | This widget is resting |
| `widgets.expired` | Tap to catch up |
| `widgets.open` | Open Bonded |

## 8. Open questions for the PO

1. Today's question / On this day: cut long questions with "…" on widgets (exception to "never truncate a question")? The board assumes yes.
2. Large widget family: none in v1? (Board assumes none.)
3. On this day fallback to 6 months / 1 month when there is nothing a year ago? (Board assumes yes.)
4. Send a hug from the Lock Screen / Control Center without Face ID? (Board assumes yes, pending SEC-21.)
5. Android Material You: wallpaper colours for surfaces, Bonded orange kept for the action and mascot? (Board assumes yes.)
6. Android Quick Settings tile "Send a hug": later, not v1?

## 9. Not covered yet in this draft

- Pixel-accurate frames per device size (SE, Pro Max, iPad) and per AX text size: rules are written here; the board draws the iPhone 15 size and one largest-text sample.
- Dark-mode Material You and dark tinted/clear variants are described, not drawn.
- The RTL sample uses placeholder Arabic; real translations come with i18n.
- The `widgets.*` keys above are proposals for the mobile owner (`src/i18n`).
- `screens.json` / L4 spec row for 38c: added once the PO approves.
