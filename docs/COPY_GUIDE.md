# Bonded copy guide

Owner: lead architect (structure); the product owner approves every user-facing line. Lasting rules for writing app copy, so new lines match the approved voice. Approved strings live in i18n (`src/i18n/`) and, for pushes, in `supabase/content/notifications.json` (PO-owned).

## Voice (all screens)
- Warm, a little playful, never cheesy. Plain words a tired person gets in one glance.
- About the couple, never about the app.
- No pressure: no guilt, no shame, no "are you sure you want to lose…", no fake urgency or fake timers (D52, D57).
- No clinical or therapy claims, no promises ("guaranteed", "will fix", "save your relationship").
- Prices and percentages only from RevenueCat offerings, never written into copy (non-negotiable).
- Original: nothing copied from other apps.

## Goal feelings (P3 paywall, D58)

P3 shows up to 3 lines, one per goal picked on 06, describing how life with the partner feels once they have more of it. Feeling, not features.

### Approved lines
| Goal key | Line |
|---|---|
| `deep_talks` | Evenings where {partner} really opens up, and you really listen. |
| `laughing` | More of the laughs that make you two feel like *you*. |
| `romance` | That spark from the start, back in your everyday life. |
| `future` | Dreaming about your life together, out loud, side by side. |
| `hard_conversations` | Talking about the hard things without it turning into a fight. |
| `learning` | Still finding out new things about {partner}, even years in. |
| general: closeness (none picked) | Evenings that end with you two feeling close. *(lead draft, PO to approve)* |
| general: laughter (none picked) | Silly little moments you two laugh about for days. *(lead draft, PO to approve)* |
| general: curiosity (none picked) | Still finding out new things about each other, even years in. *(lead draft, PO to approve)* |

`{partner}` = the name from 07, fallback "your partner". Headline: "Picture you and {partner}, a few weeks from now" ("Picture the two of you, a few weeks from now" without a name). Closing line keeps the only factual reminders: "A few minutes a day, together. {partner} is included."

### Display rules
- At most 3 lines, in the 06 board order (not tap order).
- One small emoji or icon per line; the goal's 06 icon if it reads well.
- No feature lists, pack names or Premium jargon in this block.
- Price, trial length, renewal and cancel text stay unchanged and at least as visible as this block (store rules).
- Analytics may record which goal keys showed, never the copy.

### The method: writing a line for a new goal
1. **Start from the goal, end at the feeling.** Ask: "If they get more of this, what moment do they live, and how does it feel?" Write that moment, not the product. ✗ "Deep Talks pack" ✓ "Evenings where {partner} really opens up".
2. **A scene, not an adjective.** A concrete everyday moment (evenings, side by side, out loud, years in) beats "closer", "stronger", "better communication".
3. **Both people in it.** Use "you two", "your life together" or {partner}'s name. It is about the couple, never about the app. Use {partner} in at most 2 of the 3 lines so it doesn't feel templated.
4. **Name the quiet fear gently, then the relief,** only where the goal implies one (hard conversations: "without it turning into a fight"; learning: "even years in" = not growing stale). Never shame, never imply the relationship is failing.
5. **Hope, not promise.** No "guaranteed", "will fix", "save your relationship", numbers, percentages, therapy or clinical claims. Words like "more of", "back in", "still" are fine.
6. **Short and spoken.** One sentence, about 6–12 words, reads aloud naturally. No exclamation marks, no questions, no "unlock".
7. **Same shape across lines** so 3 lines read as one picture: each starts with the moment or feeling ("Evenings…", "More of…", "That spark…", "Talking…", "Still…"); no line starts with "You will".
8. **Original and on-brand:** warm, a little playful, never cheesy or sexual (romance = spark and feeling wanted, not explicit); nothing copied from other apps.
9. **Test before shipping:** would a couple smile or nod reading it about themselves? Does it still work if only this line shows? Does it fit the smallest screen (SE) at 200% text without truncation?

### Adding a goal later
A new goal on 06 is **not done** until it has its P3 feeling line, written with this method, approved by the PO in `docs/plan/PO_ANSWERS.md`, and its i18n key `premium.goalFeelings.<goal>`. New goals need copy only, no layout change.

## Offers (D52, D57)
- Real numbers from the store only; real expiry only; no "last chance" that is not true.
- The way out is always visible and plainly worded ("No thanks, continue free", "Continue to cancel", "Not now").
