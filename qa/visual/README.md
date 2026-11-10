# qa/visual: gallery visual + a11y regression (QA-07)

Renders `GalleryScreen` (`/dev/gallery`, screen 54) in four modes, **light, dark, light at 200% text, dark at 200% text**, and checks it. It runs in Jest in Node: no Docker, no simulator.

```bash
bash qa/ci/visual.sh                       # same command CI uses
npx jest -c qa/visual/jest.config.js       # direct
UPDATE_BASELINES=1 npx jest -c qa/visual/jest.config.js   # accept a deliberate design change, then review the diff
```

## What it checks, per mode
| Check | Rule |
|---|---|
| Baseline `baselines/gallery-<mode>.txt` | One line per host node: type, role, label, text, and colours, type size, radius, spacing, hit area. Any design change shows up as a reviewable text diff. Missing baseline fails in CI (`CI=1`). |
| Accessible names | Every button, switch, radio, checkbox, tab, link has a name (label or text). |
| Reachable | No interactive element with `accessible=false`. |
| State | Switches, radios, checkboxes, tabs expose checked/selected. |
| Graphics | Every SVG is `aria-hidden`/`accessibilityElementsHidden` or inside a named element. |
| Headings | Section titles are `header` role. |
| Hit area | Interactive elements ≥ 44 pt tall (DESIGN.md §3). |
| Contrast | WCAG AA: 4.5:1 text, 3:1 large text, computed against the real composited background of each text node, in each mode. |
| No truncation | No `numberOfLines`, also at 200%. |
| Type scale | Every font size is a token size × the font scale; stray sizes fail. |

Accepted product findings go in `KNOWN` in `gallery.test.tsx` (id of the bug in `docs/plan/status/qa.md`). A stale entry fails, so it is removed when the bug is fixed.

## Limits (be honest)
- This is a **structural** baseline: Node has no layout engine, so clipping, overlap, wrapping and real glyph rendering are **not** verified. Pixel screenshots need a simulator: `capture.sh` below.
- The gallery ignores wrappers placed around it (it sets its own scheme/font providers), so the suite flips its **Dark mode** and **Text 200%** switches like a reviewer. OS-level Dynamic Type is not simulated.

## CI
`qa/ci/app.sh` (CI job `app`, every PR) runs this suite and the route-level suite in `qa/a11y/` (every built screen through the real router; see `qa/a11y/README.md`).

## Pixel evidence on a simulator: `capture.sh`
Node cannot see clipping, overlap or real glyphs, so for a design review or a release run take real screenshots:

```bash
bash qa/visual/capture.sh                                    # booted sim, /dev/gallery (needs a development build)
bash qa/visual/capture.sh --udid <UDID> --url 'bonded:///today' --name today --wait 6
```

It switches the simulator through light, dark, light at AX2 text (`accessibility-large`, about 195%, the closest iOS step to 200%) and dark at AX2 (`xcrun simctl ui <udid> appearance|content_size`), re-opens the URL after each switch, and saves `xcrun simctl io <udid> screenshot` to `qa/visual/evidence/<date>-<name>/<mode>.png`. The folder is git-ignored: attach the images to the PR or the run notes. The simulator's appearance and text size are restored on exit. `/dev/gallery` redirects to `/` in a Release build, so use a dev build for the gallery, or pass `--url` for a real screen.
