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
- This is a **structural** baseline: Node has no layout engine, so clipping, overlap, wrapping and real glyph rendering are **not** verified. Pixel screenshots (Maestro `takeScreenshot` or `xcrun simctl io booted screenshot` of `/dev/gallery` in each mode) need a simulator and come with the E2E runner; the baselines here are what makes that comparison cheap to add later.
- The gallery ignores wrappers placed around it (it sets its own scheme/font providers), so the suite flips its **Dark mode** and **Text 200%** switches like a reviewer. OS-level Dynamic Type is not simulated.

## CI wiring (needs the `workflow` scope; not pushed)
Add to `.github/workflows/ci.yml`, next to the `app` job, and add `visual` to `ci-ok` `needs`:

```yaml
  visual:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: bash qa/ci/visual.sh
```
Run it on every PR (about 20 s). Nightly screenshots are a separate later job.
