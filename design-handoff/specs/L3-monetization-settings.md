# L3 · monetization-settings

Gift, paywalls, packs, RevenueCat, settings, account deletion, AI report (later).

Screens: 18. Open each `board_file` (or the live canvas) for the exact visual. Data names are proposed; map them to the existing contracts.

| ID | Screen | Route | Components | Data | Behaviour |
|---|---|---|---|---|---|
| J8 | Paired, on partner plan (S02b-Joining) | `/(join)/done` | Confetti, Mascot(duo), Chip(premium) | entitlement (shared via couple) | If partner not premium → shared gift 14 |
| 14 | You earned a gift (S03-Gift-Paywall) | `/(offer)/gift` | Gift tile (wiggle), Mascot(glow), Button.premium | offer eligibility (new couple) | Shown after pairing, once per couple |
| 15 | Gift opened (S03-Gift-Paywall) | `/(offer)/gift/opened` | Mascot(glow), Countdown chip, PerkTile ×4 | RevenueCat offering "intro", offer.expires_at (real 24 h) | Countdown must be real; prices from RevenueCat |
| 16 | Intro paywall (S03-Gift-Paywall) | `/(offer)/paywall` | AvatarPair, PlanCard ×2, trial stepper | RevenueCat packages yearly (7-day trial) and monthly | Restore top-left; one plan covers both |
| 17 | Paywall exit sheet (S03-Gift-Paywall) | `sheet on 16` | Sheet, Mascot(flicker), comparison table | — | Promises the daily question stays free |
| 32 | Packs library (S07-Packs-Premium) | `/(tabs)/packs` | PackTile grid, free-this-week card, TabBar | pack[], entitlement | Locks float; pack icons static |
| 33 | Pack preview (S07-Packs-Premium) | `/(tabs)/packs/[packId]` | Hero tile, preview question, locked rows | pack.questions (first free) | First question of every pack is free |
| 34 | Paywall from pack (S07-Packs-Premium) | `/(offer)/paywall?from=pack` | Comparison table, PlanCard ×2 | RevenueCat offering "default" | Same component as 16 |
| 35 | You are both premium (S07-Packs-Premium) | `/(offer)/success` | Confetti(gold), Mascot(glow) | entitlement active (both members) | Partner gets a push too |
| 36 | Win-back offer (S07-Packs-Premium) | `/(offer)/winback` | Countdown chip, price card | RevenueCat offering "winback", eligibility | Shown once, day 3, real expiry |
| 40 | Us & settings (S09-Settings) | `/(tabs)/us` | Grouped list rows, AvatarPair, Mascot | profile, couple, entitlement | Links to 41, 42, 43, 48, 52 |
| 41 | Notification settings (S09-Settings) | `/(tabs)/us/notifications` | Toggle rows | notification_prefs | Each push type toggles separately |
| 42 | Couple settings & unpair (S09-Settings) | `/(tabs)/us/couple` | List rows, destructive Button | couple.unpair() | History readable 30 days after unpair |
| 43 | Delete account (S09-Settings) | `/(tabs)/us/delete` | Bullet list, TextField(type DELETE), destructive Button | account.delete() | Required by Apple and Google |
| 44 | AI consent (later) (S10-AI-Later) | `/ai/consent` | Checklist, consent status rows | ai_consent per member | Both partners must opt in |
| 45 | Weekly couple report (later) (S10-AI-Later) | `/ai/report/[week]` | Insight cards, suggested questions | report | Only answers both have seen; never trains models |
| 46 | Support resources (later) (S10-AI-Later) | `/support` | Resource rows | safety flag from report pipeline | Calm, no mascot jokes; localize hotlines |
| 57 | Payment failed (S12-Edge-States) | `sheet on paywall` | Sheet, error icon | RevenueCat purchase error | "Nothing was charged" |
