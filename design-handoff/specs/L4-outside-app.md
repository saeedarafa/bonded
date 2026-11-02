# L4 · outside-app

Push notifications, widgets (iOS WidgetKit, Android Glance), deep links.

Screens: 4. Open each `board_file` (or the live canvas) for the exact visual. Data names are proposed; map them to the existing contracts.

| ID | Screen | Route | Components | Data | Behaviour |
|---|---|---|---|---|---|
| J1 | Invite arrives (messenger) (S02b-Joining) | `external` | Link preview image (OG card) | invite link metadata | Design the OG image 1200×630 from this card |
| 37 | Lock screen notifications (S08-Outside-App) | `push payloads` | Notification copy, lock widget | push tokens, notification_prefs | See rules on 39 |
| 38 | Home widgets (S08-Outside-App) | `WidgetKit / Glance` | Small + medium widget | widget timeline: whose turn, streak, next question | Tapping opens Today |
| 39 | Notification rules (S08-Outside-App) | `server (Edge Function)` | — | notification scheduler | Max 4/day per person, quiet hours 23–07 |
