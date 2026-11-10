# L2 · daily-loop

Today, answer, reveal, thread, streaks, history, recap, milestones, badges, offline.

Screens: 30. Open each `board_file` (or the live canvas) for the exact visual. Data names are proposed; map them to the existing contracts.

| ID | Screen | Route | Components | Data | Behaviour |
|---|---|---|---|---|---|
| J7 | First question, instant reveal (S02b-Joining) | `/(tabs)/today/answer?first=1` | QuestionCard, AnswerField, partner banner | answer (insert) → reveal partner answer | Partner answered already: go straight to 20/21 |
| 18 | Today: your turn (S04-Daily-Loop) | `/(tabs)/today` | TopBar(AvatarPair, streak Chip), Mascot, QuestionCard, Button, TabBar | daily_question, answer status ×2 (realtime), streak | "New in" countdown ticks live |
| 19 | Write your answer (S04-Daily-Loop) | `/(tabs)/today/answer` | Write/Voice switch, AnswerField (counter /500 free, /2000 Premium), info card | answer (insert); RLS hides partner answer until both exist | Private-until-both line always visible. Free: Voice tab carries a "Premium" label and opens the paywall (D46) |
| 19b | Write, up to 2000 (Premium) (S04-Daily-Loop) | `/(tabs)/today/answer (state)` | Write/Voice switch, AnswerField (counter /2000) | answer (insert, ≤ 2000 when Premium, DB-enforced) | Premium couples write up to 2000 characters (D46) |
| 19c | Record a voice answer (Premium) (S04-Daily-Loop) | `/(tabs)/today/answer (state)` | Write/Voice switch, voice recorder (play, record again, delete) | voice answer (private bucket; reveal rule on the object) | Up to 90 s, mono ~24 kbps on the phone; text or voice, never both (D46) |
| 19d | Write, near the free limit (S04-Daily-Loop) | `/(tabs)/today/answer (state)` | Write/Voice switch, AnswerField (counter /500), "Premium: 2000" hint | answer (insert, ≤ 500 free) | From ~450 characters: "N left. Premium: 2000" opens the paywall; plain 19 has no offer (D46) |
| 20 | Hold to reveal (S04-Daily-Loop) | `/(tabs)/today/reveal` | HoldToReveal, blurred AnswerCard, Mascot(glow) | answer (partner) fetched only after both answered | 1.2 s hold, selection ticks, success haptic |
| 21 | Revealed + reactions (S04-Daily-Loop) | `/(tabs)/today/revealed` | AnswerCard ×2, ReactionPill (emoji quick row ❤️ 😂 😮 🥹 🔥 + more), streak Chip | reaction (upsert), streak (+1) | Any single emoji, one per person (tap another to replace, same to remove), counts per emoji (D45). Heart reaction beats when selected |
| 22 | Thread (S04-Daily-Loop) | `/(tabs)/today/thread` | ChatBubble, ReactionPill, TypingIndicator, Composer | thread_message (realtime), typing presence | Messages animate in once. Text and voice messages mix (22b, D46); emoji reactions (D45) |
| 22b | Thread: voice message (Premium) (S04-Daily-Loop) | `/(tabs)/today/thread (state)` | ChatBubble (voice), hold-to-record Composer, "Slide to cancel" | thread voice message (private bucket) | Up to 60 s; free couples can listen, not record (D46) |
| 23 | Waiting on partner (S04-Daily-Loop) | `/(tabs)/today (state)` | Mascot(flicker), QuestionCard, Button.ghost(Nudge) | nudge (max 1/day), streak at risk | Bell rings; copy names the partner |
| 24 | Bonded today (S04-Daily-Loop) | `/(tabs)/today (state)` | Mascot(glow), BadgeLadder, countdown card | streak, next badge, next question time | Ladder shows next badge with ring |
| 24b | Today: little things button (first time) (S04-Daily-Loop) | `/(tabs)/today (state)` | Little-things button (time-of-day icon), first-time tip | little_things_today() | Icon by time of day, peeks at the others (off with Reduce Motion) (D48) |
| 24c | Little things: fan open (S04-Daily-Loop) | `/(tabs)/today (state)` | Fan of five, kiss counter, hug hold ring, Undo toast | send_little_thing (limits in DB) | Kiss up to 5 per send, hug hold up to 5 s, 3 s Undo; at the limit grey, free → "More kisses with Premium" (D48) |
| 24d | Today: partner sent something back (S04-Daily-Loop) | `/(tabs)/today (state)` | Mascot (gesture pose), speech bubble with Reply | little_things (realtime) | Bao and Bun act it out with sound; "Maya sent you 3 kisses · Reply"; same-time hug copy (D48) |
| 25 | Milestone (7/30/100) (S05-Streaks-Care) | `modal /milestone/[n]` | Confetti, Mascot(glow), badge ring | streak milestone event | Then native in-app review API (OS UI) |
| 26 | Monthly check-in (S05-Streaks-Care) | `sheet` | Sheet, face scale ×5 | feedback.check_in | Never routes to the store |
| 27 | Private feedback (S05-Streaks-Care) | `/(tabs)/us/feedback` | FeedbackPill multi-select, AnswerField | feedback (insert) | Read by a person; reply by email |
| 28 | Napping (missed day) (S05-Streaks-Care) | `/(tabs)/today (state)` | Mascot(ember / napping), streak stats, premium card | streak.longest, streak_saver (premium) | Never guilt; streak saver is premium |
| 29 | History calendar + list (S06-History) | `/(tabs)/history` | Heatmap, list rows, TabBar | daily_question history, answer status per day | Today cell pulses |
| 30 | Past question (S06-History) | `/(tabs)/history/[questionId]` | AnswerCard ×2, thread preview | answer ×2, thread_message count | Read-only |
| 31 | Weekly recap (S06-History) | `/(tabs)/history/recap` | Mascot ×7 (mood per day), stat tiles, most-loved card | weekly aggregate | Sunday push links here |
| 48 | Our milestones (S11-Milestones) | `/(tabs)/us/milestones` | Up-next card, timeline | milestone[] | Owner color per item |
| 49 | Personal milestone (S11-Milestones) | `modal` | Confetti, badge circle | milestone (personal) | "Tell Sam" triggers 50 on partner phone |
| 50 | Celebrate your partner (S11-Milestones) | `sheet (partner phone)` | Notification card, reaction buttons, TextField | celebration (insert), push | Brings both partners back |
| 51 | Anniversary day (S11-Milestones) | `/(tabs)/today (special)` | Countdown chip, Mascot(duo), special QuestionCard | key_date match → special question | Replaces daily question; streak still counts |
| 52 | Badges (S11-Milestones) | `/(tabs)/us/badges` | BadgeLadder, badge grid | badge[] | Yours orange, partner sky, shared gold |
| 52b | Badge unlocked (S11-Milestones) | `sheet` | Sheet, Confetti, badge pop, BadgeLadder | badge (1,3,7,14,21,30,50,100,365) | Heavy haptic |
| 53 | Empty history (S12-Edge-States) | `/(tabs)/history (empty)` | Mascot(spark), Button | — | Day 1 only |
| 55 | Offline (S12-Edge-States) | `banner on any screen` | Banner, AnswerField, status Chip | local queue (MMKV) → answer sync | Streak counts for the day written |
