# Design gaps

Logged by the mobile developer when a state isn't designed (loading, empty, error, offline, locked, permission denied…). The product owner answers here or in a new design export.

| Date | Screen id | Missing state | Placeholder used | PO answer |
|---|---|---|---|---|
| 2026-11-02 | DS components | Error-tone `Banner` (blush tint) and error `Toast` (blush icon): the board shows only the success toast and no banner | Blush tint + blushText; toast keeps the dark pill with a blush icon | |
| 2026-11-02 | DS components | `ChatBubble` sending and failed states (and "tap to retry") | Sending: 70% opacity + "Sending…" caption; failed: blushText caption that is a 44 pt retry button | |
| 2026-11-02 | DS components / 20 | `AnswerCard` locked (partner hasn't unlocked): board 20 shows a blurred card, but a locked answer is never fetched (RLS), so there is no text to blur | Surface2 card, lock icon and "{name}'s answer is locked until you both answer." | |
| 2026-11-02 | DS components | `Heatmap` cell colours: board S06 uses #FFC9A8 for "one answered", which is not a token | `youTint` fill with `youText` number; "both" = `you`; "missed" = surface + line; "today" = 2 pt `you` outline, pulsing | |
| 2026-11-02 | DS components | `HoldToReveal` reduced-motion confirm ("tap with a confirmation") has no visual | Same ring; label switches "Tap to reveal" then "Tap again to reveal" | |
| 2026-11-02 | DS components | Reaction kinds: board shows heart, smile, sparkle but names none; CONTRACTS §2 `reactions` has `emoji`, not `kind` | UI kinds `love`, `laugh`, `wow` (icons heart, smile, sparkle); backend mapping needed | |
