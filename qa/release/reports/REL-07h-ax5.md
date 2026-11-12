# Release validation: REL-07h, AX5 re-check of MOB-80b (#356 #366 #367) on REL-B (main 9ee8342)

Re-check of PR #369 (MOB-80b, merged) at the largest Dynamic Type size (AX5), light mode, on the iPhone SE.
Follows REL-07g (`qa/release/reports/REL-07g-ax5.md`), which failed #356 and filed #366 (34 unavailable state)
and #367 (card labels mid-word). **Not a store GO/NO-GO**: local Release build against a local stack.
Session 2026-11-12 21:32-22:10 EET. REL-B only; REL-A (booted by another agent during this run) and
emulator-5554 not touched.

## 1. Build identity
| Field | iOS |
|---|---|
| Device | REL-B, iPhone SE 3rd gen, iOS 18.0 Simulator (D057FF7E), 375 x 667 pt, light, AX5 (`accessibility-extra-extra-extra-large`) |
| Commit | `main` 9ee8342 (after merge of #369 and #370), branch `release/REL-07h-ax5`. `CI=1 expo prebuild -p ios --no-install`, pod install, `xcodebuild -configuration Release -sdk iphonesimulator ARCHS=arm64 ONLY_ACTIVE_ARCH=YES` (ad-hoc), BUILD SUCCEEDED in about 8 min (host load about 4) |
| Version | 0.1.0 (1), `com.hellobonded.app` |
| Build env | `EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:57521` (checked in `main.jsbundle`), local demo anon key, `EXPO_PUBLIC_SHIP_LITTLE_THINGS=1`, `EXPO_PUBLIC_SHIP_PREMIUM_HISTORY=1`, `EXPO_PUBLIC_SHIP_VOICE=1`; no RevenueCat / PostHog key |
| Backend | isolated local stack `rel07h` (/tmp/rel07h, ports 575xx); scenarios `streak-11-both-answered` (20-22 with 4 thread messages), `streak-11-your-turn` (19), `free-couple-packs` (33/34/16) |

Maya signed in at the default text size, then AX5 was set and the app relaunched. 05 ran on a fresh install at AX5.

## 2. Results
Evidence in `qa/release/evidence/9ee8342-rel07h/` (local, gitignored): top-level `IOS-AX5-*.png`, flows in
`flows/` (`ios-signin-h`, `ios-dismiss`, `ios-22h`, `ios-22top`, `ios-21mine*`, `ios-19h`, `ios-34h`,
`ios-16only`, `ios-05h`), Maestro runs in `ax5-daily/`, `ax5-packs/`, `ax5-0157/`, hierarchy dumps
`05-`, `19-`, `21-`, `22-`, `34-hierarchy.json`.

| # | Check (AX5, light) | Issue | Result | Evidence |
|---|---|---|---|---|
| 1 | 22 header shows the whole question | #356 | **pass** | `IOS-AX5-22-top.png`, `22-hierarchy.json`: `22-screen-top` now y 20-175 (was fixed at 56 pt); "Today's thread" + "What's a small thing / I do that makes your / day better?" fully visible, wraps between words |
| 2 | 22 messages scroll below the header | #356 | **pass** | `IOS-AX5-22-msgtop.png`, `-22-msg1.png`, `-22-up.png`: with 4 thread messages the message list scrolls and is clipped at the header's bottom edge, never drawn over it; voice notice (`22b-free-note`) stays above the composer |
| 3 | 34 unavailable state scrolls to Back | #366 | **pass** | `IOS-AX5-34-top.png` (mascot + "Not / available / right now" fully on screen), `IOS-AX5-34-back.png` (body ends "every day.", `34-back` y 559-657 fully visible after scrolling); no text past the right edge; Back returns to 33 (`ios-16h` run: 33 shown after tap) |
| 4 | 16 unavailable state scrolls to Back | #366 | **pass** | `bonded://paywall?from=history`: `IOS-AX5-16-top.png`, `IOS-AX5-16-back.png`, `IOS-AX5-16-back-done.png` (Back returns to 33) |
| 5 | 05 stage cards one per row, labels whole words | #367 | **pass** | `05-hierarchy.json`: all four tiles x 24-351 (one per row); `IOS-AX5-05-s1.png`, `-05-s6.png`: "Dating", "Living together", "Engaged or / married", "Long-distance" |
| 6 | 19 partner notice | #367 | **pass** | `IOS-AX5-19-notice.png`: "Sam has / answered. You'll / see theirs the / moment you / lock yours in." (was "answere / d") |
| 7 | 21 answer card names | #367 | **pass** | `IOS-AX5-21-s0.png` ("Sam" + "6:34 PM" on one row), `IOS-AX5-21-mine-head2.png` ("You" + "6:54 PM") (was "Sa / m") |
| 8 | 22 "Both answers" card | #367 | **pass** | `IOS-AX5-22-msgtop.png`: "Both answers" on one line with the avatars and chevron |

Observation (not a failure, no bug filed): at AX5 on the SE, the 22 message viewport between the header
(155 pt) and the voice notice + composer is only about 140 pt tall, and message text is uncapped by design
(PR #369: question and answer text are not capped), so one or two words of a message are visible at a time.
It scrolls and stays readable. Worth a design look if AX5 on small phones matters (for example, letting the
header scroll away or capping the free voice notice); left to the lead.

## 3. Summary
| Issue | Result |
|---|---|
| #356 (22 header + scroll) | **PASS** |
| #366 (34 and 16 unavailable state) | **PASS** |
| #367 (05 tiles, 19 notice, 21 names, 22 "Both answers") | **PASS** |

## 4. Residual risk / verdict
No failures, no new bugs. All three issues stay closed. 34 with real offerings is still blocked (no RevenueCat
sandbox key on the Mac). Not a store GO/NO-GO (local build, no EAS build).

Cleanup: text size reset to `large` (default), REL-B shut down, stack `rel07h` stopped `--no-backup`,
worktree `ios/` build output removed.
