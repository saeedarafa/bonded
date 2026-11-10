# L1 · onboarding-pairing

Story onboarding, quiz, sign-in, reminders, invite, joining partner, key dates, pairing edge cases.

Screens: 23. Open each `board_file` (or the live canvas) for the exact visual. Data names are proposed; map them to the existing contracts.

| ID | Screen | Route | Components | Data | Behaviour |
|---|---|---|---|---|---|
| 01 | Welcome (S01-Onboarding) | `/(onboarding)/welcome` | Mascot(glow), Button, Button.ghost | — | "I have an invite code" → J3 code entry |
| 05 | Quiz: your stage (S01-Onboarding) | `/(onboarding)/quiz/stage` | ProgressBar, OptionRow(radio) | couple.stage | dating | living_together | married | long_distance. Comes right after 01 (D49); quiz 1/4 |
| 06 | Quiz: what you want more of (S01-Onboarding) | `/(onboarding)/quiz/goals` | ProgressBar, OptionRow(checkbox) grid | couple.goals[] | Seeds first packs and paywall copy. Before the story (D49); quiz 2/4 |
| 02 | Story: life gets loud (4 stage versions) (S01-Onboarding) | `/(onboarding)/story/1` | ChatBubble (decorative), Mascot(flicker), PageDots | — | Four versions picked by the stage on 05 (D49): Dating "Life gets busy.", Living together "Life gets loud." (default), Engaged or married "Life gets full.", Long-distance "Miles get loud.", each with its own bubbles. Bubbles pop in once |
| 03 | Story: things go quiet (S01-Onboarding) | `/(onboarding)/story/2` | Mascot(ember / napping), OptionRow(radio) | onboarding_answers.last_learned (local until sign-in) | Self-reported "last learned something new" |
| 04 | How it works (S01-Onboarding) | `/(onboarding)/story/3` | Mascot(duo), step rows | — | 3 steps: same question, locked, reveal; plus one line naming the goals picked on 06 (D49) |
| 07 | Quiz: your names (S01-Onboarding) | `/(onboarding)/quiz/names` | TextField ×2, AvatarPair, Mascot(spark) | profile.display_name, invite.partner_name | Partner name pre-fills invite copy |
| 47 | Key dates (S11-Milestones) | `/(onboarding)/quiz/dates` | DateField, date rows, Toggle | key_date[] (together_since, anniversary, birthdays), prefs.remind_week_before | Optional, skippable. Partner adds own birthday |
| 08 | Sign in (S02-Pairing) | `/(auth)/sign-in` | Button (Apple, Google, email) | Supabase Auth | Apple button must follow Apple HIG on iOS |
| 09 | Reminder primer (S02-Pairing) | `/(pairing)/reminders` | Notification preview card, OptionRow(radio) | notification_prefs.ritual_time | System permission prompt only after "Turn on reminders" |
| 10 | Invite partner (S02-Pairing) | `/(pairing)/invite` | Mascot(spark), code card, Button(share) | invite.code, invite.expires_at (48 h), invite.link | Share sheet with deep link |
| 11 | Waiting, answer first (S02-Pairing) | `/(pairing)/waiting` | Mascot(flicker), QuestionCard | daily_question (day 1), invite status (realtime) | User can answer before partner joins |
| 12 | Join with code (S02-Pairing) | `/(pairing)/join` | CodeInput | invite.redeem(code) | Partner avatar is sky on joiner phone |
| 13 | You are paired (S02-Pairing) | `/(pairing)/paired` | Confetti, Mascot(duo), Chip(Day 1) | couple.paired_at | Shown on both phones; heavy haptic |
| J2 | Personal welcome (S02b-Joining) | `/(join)/welcome?token=` | Mascot(duo), inviter pill | invite.inviter (name, avatar) | Requires deferred deep link (survives install) |
| J3 | Code prefilled (S02b-Joining) | `/(join)/code` | CodeInput (success state) | invite.redeem(code) | Manual entry fallback if no link |
| J4 | Quick sign in (S02b-Joining) | `/(join)/sign-in` | ProgressBar 1/3, auth buttons | Supabase Auth | Shares component with 08 |
| J5 | Your name (S02b-Joining) | `/(join)/name` | TextField, AvatarPair | profile.display_name; reads couple.stage, key_date | Stage and dates are inherited, not asked |
| J6 | Reminders matched (S02b-Joining) | `/(join)/reminders` | OptionRow (same as partner / own) | notification_prefs.ritual_time (default = partner) | Then system permission prompt |
| J9 | Wrong code (S02b-Joining) | `/(join)/code` | CodeInput(error), shake | invite.redeem → error not_found | Error haptic; "Start my own" |
| J10 | Couple already full (S02b-Joining) | `/(join)/full` | Mascot(duo), card | invite.redeem → error couple_full | Exactly two per couple |
| 56 | Invite expired (S12-Edge-States) | `/(join)/code (state)` | CodeInput(error) | invite.redeem → error expired | "Ask Maya for a new code" |
| 58 | Partner left (S12-Edge-States) | `/(pairing)/partner-left` | Mascot(spark), download card | couple.status = ended, export | History kept 30 days, PDF export |
