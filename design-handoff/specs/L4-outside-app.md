# L4 · outside-app

Push notifications, widgets (iOS WidgetKit, Android Glance), deep links.

Screens: 5. Open each `board_file` (or the live canvas) for the exact visual. Data names are proposed; map them to the existing contracts.

| ID | Screen | Route | Components | Data | Behaviour |
|---|---|---|---|---|---|
| J1 | Invite arrives (messenger) (S02b-Joining) | `external` | Link preview image (OG card) | invite link metadata | Design the OG image 1200×630 from this card |
| 37 | Lock screen notifications (S08-Outside-App) | `push payloads` | Notification copy, lock widget | push tokens, notification_prefs | See rules on 39 |
| 38 | Home widgets (S08-Outside-App) | `WidgetKit / Glance` | Small + medium widget | widget timeline: whose turn, streak, next question | Tapping opens Today |
| 38b | Home widgets: your turn (S08-Outside-App) | `WidgetKit / Glance` | Small widgets: Countdown, Partner answered; still mascot pose | widget timeline: my/partner answered (bool), deadline, streak | Never shows the partner's answer (FUN-04); tapping opens Today (D47) |
| 39 | Notification rules (S08-Outside-App) | `server (Edge Function)` | — | notification scheduler | Max 4/day per person, quiet hours 23–07 |
