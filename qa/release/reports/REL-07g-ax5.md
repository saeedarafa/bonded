# Release validation: REL-07g, AX5 re-check of MOB-80 (#356 #357 #358) + 33/34 on REL-B (main 87ca0a7)

Re-check of the largest Dynamic Type size (AX5) fixes in MOB-80 (PR #364) and the 33/34 check REL-07f left
blocked. **Not a store GO/NO-GO**: local Release build against a local stack. Session 2026-11-12 20:25-21:00
EET. REL-B only; REL-A and emulator-5554 not touched.

## 1. Build identity
| Field | iOS |
|---|---|
| Device | REL-B, iPhone SE 3rd gen, iOS 18.0 Simulator (D057FF7E), 375 x 667 pt, light, AX5 (`accessibility-extra-extra-extra-large`), Reduce Motion off |
| Commit | `main` 87ca0a7 (merge of #364), branch `release/REL-07g-ax5`. `CI=1 expo prebuild -p ios --no-install`, pod install, `xcodebuild -configuration Release -sdk iphonesimulator ARCHS=arm64 ONLY_ACTIVE_ARCH=YES` (ad-hoc), BUILD SUCCEEDED in about 8 min |
| Version | 0.1.0 (1), `com.hellobonded.app` |
| Build env | `EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:57521`, local demo anon key, `EXPO_PUBLIC_SHIP_LITTLE_THINGS=1`, `EXPO_PUBLIC_SHIP_PREMIUM_HISTORY=1`, `EXPO_PUBLIC_SHIP_VOICE=1`; no RevenueCat / PostHog key |
| Backend | isolated local stack `rel07g` (/tmp/rel07g, ports 575xx); scenarios `streak-11-your-turn` (18-22, free couple, Sam answered) and `free-couple-packs` (33/34) |

Sign-in was done at the default text size (the QA sign-in subflow cannot run at AX5 on the SE), then AX5 was
set and the app relaunched. 01/05/07 ran on a fresh install at AX5.

## 2. Results
Evidence in `qa/release/evidence/87ca0a7-rel07g/` (local, gitignored). Flows in `flows/`; runs in `ax5-0157/`,
`ax5-daily/`, `ax5-packs/`; hierarchy dumps `19-`, `22-`, `34-hierarchy.json`.

| # | Check (AX5, light) | Issue | Result | Evidence |
|---|---|---|---|---|
| 1 | 01 Welcome hero title | #358 | **pass** | `IOS-AX5-01.png`: "One / question a / day. / Just the / two of you." wraps between words |
| 2 | 05 title | #358 | **pass** | `IOS-AX5-05.png`: "Where are / you two / right now?" |
| 3 | 07 title | #358 | **pass** | `IOS-AX5-07.png`: "Who's in / this / together?" |
| 4 | 20 title | #358 | **pass** | `IOS-AX5-20-title.png`: "Sam's / answer is / ready" |
| 5 | 18 gift chip | #358 | **pass** | `IOS-AX5-18-gift.png`: "You earned / a gift" + "Open" on one row inside the chip |
| 6 | 18 little-things tip, first open after sign-in | #357 | **pass** | `IOS-AX5-18-tip.png`: the whole tip ("Send Sam a little something. ... tap Kiss again for more.") is on screen above the button |
| 7 | 21 streak chip while scrolling | #357 | **pass** | `IOS-AX5-21-chip.png`, `IOS-AX5-21-chip-scrolled.png`: "12 · / bonded / today" wraps inside the screen (right edge clear); content scrolls under the header row. The header row is about 140 pt tall at AX5 (a quarter of the SE screen), acceptable |
| 8 | 22 free couple: header wraps | #356 | **FAIL** | `IOS-AX5-22-header-overlap.png`, `IOS-AX5-22-up.png`, `22-hierarchy.json`: the top bar `22-screen-top` stays 56 pt tall (y 20-76) while its subtitle (the question) is laid out at y 60-116, so it shows one cut line ("What's a small thing I") and the scrolling content (`22-answers` from y 84, the empty-state text) is drawn over it. The title "Today's thread" fits on one line |
| 9 | 22 free couple: voice notice below the header | #356 | **pass** | `22b-free-note` at y 313-427, above the composer, no longer over the header |
| 10 | 22 free couple: messages scroll | #356 | **pass** | the message area (`22-messages`) scrolls: `-22-top` vs `-22-up` differ (empty state, then the "Both answers" card); this scenario has no thread messages, so only the empty state and answers card scrolled |
| 11 | 33 pack detail | — | **pass** | `IOS-AX5-33-sample.png`, `ax5-packs/.../IOS-AX5-33-*.png`: title, description, sample question card and the locked list wrap between words; page scrolls to the unlock button |
| 12 | 34 paywall (unavailable state, no RevenueCat key) | new | **FAIL** | `IOS-AX5-34-unavailable-cut.png`, `34-hierarchy.json`: not scrollable; title at y -58..152 (top lines above the screen), body to y 767 (past 667; "Your daily qu" also cut at the right edge), `34-back` not on screen. Default size fine (`IOS-default-34-unavailable.png`, Back at y 453). Bug draft A below |
| 13 | 34 paywall with offerings | — | **blocked** | no RevenueCat sandbox key on the Mac |

Also seen (not in the check list; bug draft B below): non-title labels still break mid-word at AX5: 05 option cards
("Livi / ng", "Eng / age / d or / mar / ried", "Lon / g- / dist / anc / e"), 19 notice "Sam has / answere / d",
21 answer card name "Sa / m", 22 "Both / answer / s".

Side note: on 19 at AX5 the tab bar stays visible over the bottom of the scroll view; once scrolled to the end,
`19-submit` (y 317-569) clears the tab bar (586). A Maestro tap at 50 % visibility hit the History tab; not a
product finding.

## 3. Summary
| Issue | Result |
|---|---|
| #356 (22 header/notice) | **FAIL**: notice below the header and scrolling pass; the header still does not grow, so the question subtitle is cut to one line and covered by scrolling content |
| #357 (18 tip, 21 chip) | **PASS** |
| #358 (titles 01/05/07/20, 18 gift chip) | **PASS** |
| 33 / 34 at AX5 | 33 pass; 34 unavailable state FAIL (new, draft A); 34 with offerings blocked (no RevenueCat key) |

## 4. Bug drafts (the issue tool was refused in this session; lead, please file)
**A. [SCR-34] AX5 on iPhone SE: paywall unavailable state does not scroll; title and Back button off screen.**
sev-3 (suggested), labels bug + accessibility, owner mobile. Build: iOS Release sim build of main 87ca0a7, no
RevenueCat key; REL-B, iOS 18.0, AX5, light; `free-couple-packs`, Maya: Packs -> Gratitude (33) -> unlock -> 34.
Expected: the unavailable state scrolls (or caps its title), so title, body and `34-back` can be reached.
Actual: not scrollable; "Not available right now" at y -58..152, body to y 767, last visible line cut at the right
edge, `34-back` off screen; swiping does nothing. Default size fine. Evidence: `IOS-AX5-34-unavailable-cut.png`,
`34-hierarchy.json`, `IOS-default-34-unavailable.png`, `34-default-hierarchy.json`.

**B. [SCR-05][SCR-19][SCR-21][SCR-22] AX5 on iPhone SE: card labels still break mid-word.** sev-4 (suggested),
labels bug + accessibility, owner mobile. Same build/device. Titles from #358 now wrap (pass); other labels in
narrow boxes break mid-word: 05 option cards (`IOS-AX5-05-cards-midword.png`, `-midword2.png`), 19 partner notice
(`IOS-AX5-19-notice-midword.png`), 21 answer card name (`IOS-AX5-21-chip.png`), 22 answers card
(`IOS-AX5-22-up.png`). Expected: word-only wrapping (cap the label scale, or stack the row at large sizes).

## 5. Residual risk / verdict
No sev-1/2 found. AX5 UI checks: #357 and #358 verified fixed; #356 still fails (sev-3); new sev-3 on the 34
unavailable state and a sev-4 on card labels. Not a store GO/NO-GO (local build, no EAS build, no RevenueCat key).

Cleanup: REL-B shut down (text size reset to default), stack `rel07g` stopped `--no-backup`, worktree `ios/`
build output removed.
