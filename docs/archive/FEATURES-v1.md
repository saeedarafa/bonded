# MVP Feature List

Each feature has an ID used in the agent briefs ([database](agents/database.md), [backend](agents/backend.md), [frontend](agents/frontend.md)) and in commit messages (`F04: …`). **DB / BE / FE** show which agent has work on it.

Milestones: **M1** foundations (week 1) · **M2** core loop (weeks 2–3) · **M3** retention (week 4) · **M4** monetisation (week 5) · **M5** launch hardening (week 6).

| ID | Feature | DB | BE | FE | Milestone |
|---|---|:-:|:-:|:-:|:-:|
| F01 | Sign up / sign in | ✓ | | ✓ | M1 |
| F02 | Onboarding profile | ✓ | | ✓ | M2 |
| F03 | Partner pairing | ✓ | | ✓ | M2 |
| F04 | Daily question | ✓ | | ✓ | M2 |
| F05 | Answer, lock and reveal | ✓ | | ✓ | M2 |
| F06 | Discussion thread + reactions | ✓ | | ✓ | M2 |
| F07 | Live updates | ✓ | | ✓ | M2 |
| F08 | Push notifications | ✓ | ✓ | ✓ | M3 |
| F09 | Daily reminder | ✓ | ✓ | ✓ | M3 |
| F10 | Streak | ✓ | | ✓ | M3 |
| F11 | History | ✓ | | ✓ | M3 |
| F12 | Question packs (premium) | ✓ | | ✓ | M4 |
| F13 | Subscription + paywall | ✓ | ✓ | ✓ | M4 |
| F14 | Settings, unpair, delete account | ✓ | ✓ | ✓ | M4 |
| F15 | Analytics + crash reporting | | ✓ | ✓ | M5 |
| F16 | Question content (150+) | ✓ | | | M5 |

---

### F01 — Sign up / sign in
Email one-time code, Sign in with Apple (iOS), Google.
- A profile row exists right after first sign-in.
- The session survives app restarts; sign-out clears the local cache and drafts.

### F02 — Onboarding profile
Name, avatar (optional), timezone (auto-detected), reminder time, relationship start date (asked after pairing).
- Can't reach the main tabs without a name.
- Timezone is updated automatically if the device timezone changes.

### F03 — Partner pairing
- "Invite partner" creates a 6-character code and a share link (`couplesapp://invite/{CODE}` + universal link); the share sheet opens.
- "I have a code" accepts a code typed in any case, or arrives pre-filled from the link.
- Errors shown for invalid/expired code, own code, already paired.
- The inviter's screen moves to Today automatically when the partner joins (realtime or refetch on focus).
- One couple per person; the code works once and expires after 7 days.

### F04 — Daily question
- Both partners see the same question, which changes at midnight in the couple's timezone.
- Questions don't repeat for a couple. Free couples never get premium daily questions.
- Today screen shows: question, your status, partner status (not answered / answered and locked / revealed), streak.

### F05 — Answer, lock and reveal (the core of the product)
- Text answer, 1–2000 characters. The draft is kept on the device if the app closes.
- Until you answer, your partner's answer shows as a locked bubble ("Answer to unlock").
- After you answer, it reveals with an animation.
- Editing your answer is allowed.
- Sending is retry-safe: offline or failed sends show "Not sent — retry" and never create duplicates.

### F06 — Discussion thread + reactions
- The thread opens when both have answered. Messages 1–2000 characters, sent with an optimistic update.
- One emoji reaction per person per answer or message.
- Unread dot per question; it clears on opening the thread.

### F07 — Live updates
- While the app is open, partner answers, reveals, messages and reactions appear without pull-to-refresh (≤ 2 s).
- A locked answer's text is never sent to the partner's device.

### F08 — Push notifications
- Permission requested after pairing, not at first launch.
- Partner answered: "{name} answered today's question — answer to see it". Both answered: "You both answered — see what {name} said". New message: "{name}: {preview}".
- Tapping a push opens the right question.
- Invalid device tokens are removed.

### F09 — Daily reminder
- At the user's chosen local time, only if they haven't answered today's question. At most one per day.
- Can be turned off in Settings.

### F10 — Streak
- +1 for each day both partners answered the daily question. It resets after a missed day (shows 0).
- Current and longest streak are shown on Today.

### F11 — History
- Past questions, newest first, paginated, each with both answers (or locked/unanswered state) and an unread-thread indicator.
- Filter: all / answered by both / waiting.

### F12 — Question packs (premium)
- Explore tab lists packs; premium packs show a lock for free couples and open the paywall.
- Opening a question from an unlocked pack creates it for the couple; it then works like F05/F06.

### F13 — Subscription + paywall
- Yearly (7-day free trial) and monthly plans through RevenueCat.
- **One subscription covers the couple**: if either partner pays, both get premium within 1 minute.
- Restore purchases. Paywall shown from locked packs and Settings.

### F14 — Settings, unpair, delete account
- Edit name, avatar, reminder time, relationship start date.
- Unpair (with a confirmation step) removes the couple's shared data.
- Delete account (required by both stores) deletes the user and their data, then signs out.
- Links: privacy policy, terms, crisis support, contact.

### F15 — Analytics + crash reporting
- PostHog events listed in [ARCHITECTURE.md §8](ARCHITECTURE.md). Sentry for app and edge functions.
- No answer or message text in analytics or crash reports.

### F16 — Question content
- 150+ original daily questions plus 3 packs of 15. Each question has a category and a depth (1–3).
- Written by you; the database agent provides the seed format and loader.
