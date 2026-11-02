# L0 · design-system

Theme, tokens, fonts, shared components, Mascot, i18n scaffold, dark mode, loading skeletons.

Screens: 5. Open each `board_file` (or the live canvas) for the exact visual. Data names are proposed; map them to the existing contracts.

| ID | Screen | Route | Components | Data | Behaviour |
|---|---|---|---|---|---|
| 54 | Loading skeleton (S12-Edge-States) | `every data screen` | Skeleton | — | Pattern for all screens; no content spinners |
| 63 | Today (dark) (S14-Dark-Mode) | `theme` | all | — | Every screen must work in dark |
| 64 | Hold to reveal (dark) (S14-Dark-Mode) | `theme` | all | — | Reference for dark tokens |
| 65 | Thread (dark) (S14-Dark-Mode) | `theme` | all | — | Partner bubble #1F2C3A |
| 66 | Paywall (dark) (S14-Dark-Mode) | `theme` | all | — | Gold stays premium-only |

## Components to build first (DESIGN.md §7)
Button · Chip · Avatar / AvatarPair · TextField · AnswerField · CodeInput · Toggle · OptionRow · FeedbackPill · PlanCard · QuestionCard · AnswerCard · PerkTile · PackTile · ChatBubble · ReactionPill · TypingIndicator · Composer · ProgressBar · HoldToReveal · BadgeLadder · Heatmap · Skeleton · TabBar · TopBar · Sheet · Toast · Banner · Confetti · Mascot

Reference board: `source/DS-Components.dc.html` (every component with its states). Tokens: `tokens/tokens.json`. `tokens/theme.ts` imports JSON, so enable `resolveJsonModule` in tsconfig (Expo's default does).
