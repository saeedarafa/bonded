# Bonded: design hand-off

Everything a frontend agent needs to build the app from the approved design. Exported 2026-11-02 from the "Couples App — Full Flow" canvas.

## Start here
1. **`DESIGN.md`:** the design system, covering colors (relative to the viewer), type, spacing, mascot, motion, haptics, components and copy voice.
2. **`specs/<lane>.md`:** the screens your lane builds, with route, components, data and behavior.

## What's inside
| Path | What it is |
|---|---|
| `DESIGN.md` | Design system spec, the source of truth |
| `screens.json` | Machine-readable index of all 85 screens: id, flow, lane, route, board, components, data, notes |
| `specs/L0…L5-*.md` | Screens grouped by build area (lane), generated from `screens.json` |
| `tokens/tokens.json` | Colors (light and dark), type, spacing, radius, sizes, motion, haptics |
| `tokens/theme.ts` | Expo theme built from the tokens, including `personColors(colors, isMe)` |
| `assets/mascot/*.svg` | Bao and Bun in 6 moods (still frames; animate with Rive or Lottie) |
| `assets/icon/*.svg` | App icon light and dark, Android adaptive foreground and monochrome |
| `source/*.dc.html` | The original design boards (HTML) for exact layout, copy and animation reference |
| `source/canvas.json` | Board titles and layout of the canvas |

## Viewing the designs
- **Live, animated:** https://claude.ai/artifact/RCcSEiQijYMB6wB1EZXsug. It's private, so the owner must share it before an agent can open it.
- **Offline:** the `source/*.dc.html` files are readable HTML with inline styles. Copy, spacing and colors can be read directly. They need the canvas runtime to render, so use the live link for visuals.

## Screen IDs
- **Numbered screens:** 01–66 follow the canvas.
- **Joining-partner flow:** J1–J10.
- **Badge-unlocked sheet:** 52b.

Use the ID in commits, PRs and questions (`[L2][21] Revealed + reactions`).
