# Content (owner: product owner)

Development content for Bonded. **All of it is original placeholder copy**, marked `status=placeholder`. The product owner replaces or approves it before launch (task: content sign-off in M5). Agents load it; they don't rewrite it.

| File | What | Loaded by |
|---|---|---|
| `questions.csv` | 100 daily questions, 56 pack questions (7 packs × 8), 5 special questions (`special` column: first_day, anniversary, together_since, half_iversary, birthday) | content loader (BE-05) → `questions`, `pack_questions` |
| `packs.csv` | 7 packs from board S07 (Gratitude, Deep Talks, Laugh Together, Future Us, Long-Distance, Spicy · 18+, Money & Home) | loader → `question_packs` |
| `badges.csv` | Streak ladder 1-3-7-14-21-30-50-100-365 and achievement badges (board S11) | loader → badge catalogue (BE-12) |
| `notifications.json` | Push types, copy templates, caps and quiet hours (board S08 screen 39) | `notify`, `daily-reminder` functions (BE-08, BE-19) |
| `emails.json` | Transactional email copy: the day-5 trial reminder (D50), **draft** until the PO approves | `daily-reminder` function (BE-48d) |

## Columns in `questions.csv`
- `external_id`: stable key (the loader upserts on it).
- `depth`: 1 light, 2 personal, 3 deep.
- `stages`: `all`, or a `|`-separated list of `dating`, `living_together`, `engaged_married`, `long_distance`.
- `is_premium`, `daily_eligible`: as they sound.
- `pack_slug`, `pack_position`: set for pack questions; `pack_position` is the order inside the pack. Every pack question needs Premium (D51): there is no free preview, whatever the position or `is_premium` says.
- `special`: set for special-day questions.

`stages` and `special` need matching columns in the `questions` table (BE-05).

## Rules for writing questions
Original wording only, nothing copied from other apps. Every question must work when asked of both partners at once. Warm, never guilt; no therapy claims. Spicy stays flirty, never explicit (store age rating).
