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
| 2026-11-02 | 08 / J4 | Email one-time-code steps: the boards only show the three buttons (no email field, code entry, resend, wrong or expired code, rate limit) | Same screen swaps its body: mascot + title + `TextField` (email) then `TextField` (6 digits, one-time-code autofill), "Continue", ghost "Send a new code" and "Use a different email"; errors under the field; back steps code → email → options | |
| 2026-11-02 | 08 / J4 | Provider error state (Apple/Google failed, offline) | Blush `Banner` above the buttons; cancelling the Apple/Google sheet shows nothing | |
| 2026-11-02 | 08 | Apple button on Android | Not shown (Sign in with Apple is iOS only here); Google + email remain | |
| 2026-11-02 | 08 / J4 | Terms and Privacy Policy link targets (no URLs given) | Inline underlined links open `https://<EXPO_PUBLIC_INVITE_DOMAIN>/terms` and `/privacy`; they do nothing while the domain is the placeholder | |
| 2026-11-02 | `/` | Signed-in loading and couple-load error before the app opens | Skeleton blocks; blush Banner + "Try again" | |
| 2026-11-02 | 18 | Your turn when the partner hasn't answered either (the board only shows "Sam already answered"), and the solo couple (partner not joined) | Copy "Answer first. Sam sees yours once they reply." / "...once they join and reply."; mascot waiting (solo: saving a seat); partner row "Hasn't answered yet" / "Hasn't joined yet" | |
| 2026-11-02 | 18 / 23 / 24 | Loading and load-error states of Today | Skeleton blocks; blush Banner with the mapped error (e.g. LIBRARY_EXHAUSTED) + "Try again" | |
| 2026-11-02 | 23 | Nudge after it was sent, and before `send_nudge` exists (BE-10) | Until BE-10: no button, only the streak hint. Afterwards: success toast "Nudge sent to Sam"; NUDGE_LIMIT / PARTNER_ALREADY_ANSWERED as an error toast | |
| 2026-11-02 | 24 | Day one (streak 1, "1 days in a row") and every badge earned (past 365) | "Bonded today. Your streak starts here."; "Every streak badge earned" | |
| 2026-11-02 | 28 | "Before yesterday: 11 days" needs the streak that just ended; `get_streak` has no such field | Row left out (only "Longest streak") until backend adds it | |
