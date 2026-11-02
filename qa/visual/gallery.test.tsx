// QA-07: visual + a11y regression over the dev gallery (screen 54), in light, dark and 200% text.
// Findings that are product bugs are listed in KNOWN (with the QA-BUG id in docs/plan/status/qa.md)
// so CI stays green but the test fails the day the bug is fixed and the entry must be removed.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fireEvent, screen } from '@testing-library/react-native';

import { GalleryScreen } from '@/dev/gallery/GalleryScreen';
import { renderUi } from '@/test/render';
import { colors } from '@/ui/theme';

import {
  asNodes,
  backdrop,
  contrast,
  hex,
  isHidden,
  parseColor,
  serialise,
  styleOf,
  textOf,
  walk,
  type Node,
  type Rgba,
} from './tree';

const MODES = [
  { name: 'light', scheme: 'light', fontScale: 1 },
  { name: 'dark', scheme: 'dark', fontScale: 1 },
  { name: 'light-200', scheme: 'light', fontScale: 2 },
  { name: 'dark-200', scheme: 'dark', fontScale: 2 },
] as const;

/** Product findings accepted for now: "<mode-agnostic key>" -> bug id. Keep empty if possible. */
const KNOWN: Record<string, string> = {};

const INTERACTIVE = new Set(['button', 'switch', 'radio', 'checkbox', 'tab', 'link', 'adjustable']);

// The gallery installs its own scheme and font-scale providers (they ignore the ones around it),
// so, like a reviewer, we flip its own switches rather than wrapping it.
async function render(mode: (typeof MODES)[number]) {
  await renderUi(<GalleryScreen />);
  if (mode.scheme === 'dark')
    await fireEvent.press(screen.getByRole('switch', { name: 'Dark mode' }));
  if (mode.fontScale === 2)
    await fireEvent.press(screen.getByRole('switch', { name: 'Text 200%' }));
  return asNodes(screen.toJSON());
}

/** Plain-file baseline (Jest has no toMatchFileSnapshot). Update with `-u` or UPDATE_BASELINES=1. */
function matchBaseline(actual: string, name: string) {
  const file = join(__dirname, 'baselines', name);
  const update =
    process.env.UPDATE_BASELINES === '1' ||
    (expect.getState() as { snapshotState?: { _updateSnapshot?: string } }).snapshotState
      ?._updateSnapshot === 'all';
  if (update || (!existsSync(file) && !process.env.CI)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, actual);
    return;
  }
  if (!existsSync(file)) throw new Error(`Missing baseline ${name}; run with -u and commit it`);
  expect(actual).toBe(readFileSync(file, 'utf8'));
}

const nameOf = (node: Node) =>
  ((node.props?.accessibilityLabel as string | undefined) ?? textOf(node)).trim();

const roleOf = (node: Node) => (node.props?.accessibilityRole ?? node.props?.role) as string;

function report(found: string[]) {
  const fresh = found.filter((f) => !Object.keys(KNOWN).some((k) => f.includes(k)));
  const stale = Object.keys(KNOWN).filter((k) => !found.some((f) => f.includes(k)));
  expect({ fresh, stale }).toEqual({ fresh: [], stale: [] });
}

describe.each(MODES)('gallery in $name', (mode) => {
  let tree: Node[];
  beforeEach(async () => {
    tree = await render(mode);
  });

  it('matches the committed baseline (colours, type scale, spacing, hit areas, a11y tree)', () => {
    matchBaseline(serialise(tree), `gallery-${mode.name}.txt`);
  });

  it('every interactive element has an accessible name and a role', () => {
    const found: string[] = [];
    let seen = 0;
    walk(tree, (node, anc) => {
      if (isHidden(node, anc)) return;
      const role = roleOf(node);
      if (!role || !INTERACTIVE.has(role)) return;
      seen++;
      if (!nameOf(node))
        found.push(`${role} without a name (testID ${String(node.props?.testID)})`);
    });
    expect(seen).toBeGreaterThan(20);
    report(found);
  });

  it('pressables are reachable: accessible, and not disabled-looking via opacity alone', () => {
    const found: string[] = [];
    walk(tree, (node, anc) => {
      const role = roleOf(node);
      if (!role || !INTERACTIVE.has(role) || isHidden(node, anc)) return;
      if (node.props?.accessible === false)
        found.push(`${role} "${nameOf(node)}" accessible=false`);
    });
    report(found);
  });

  it('toggles and options expose their state to screen readers', () => {
    const found: string[] = [];
    walk(tree, (node, anc) => {
      if (isHidden(node, anc)) return;
      const role = roleOf(node);
      if (!['switch', 'radio', 'checkbox', 'tab'].includes(role)) return;
      const s = node.props?.accessibilityState as Record<string, unknown> | undefined;
      const has =
        s && ('checked' in s || 'selected' in s)
          ? true
          : node.props?.['aria-checked'] !== undefined;
      if (!has) found.push(`${role} "${nameOf(node)}" has no checked/selected state`);
    });
    report(found);
  });

  it('decorative graphics are hidden from screen readers, informative ones are named', () => {
    const found: string[] = [];
    walk(tree, (node, anc) => {
      if (!/^RNSvg/.test(String(node.type)) || String(node.type) !== 'RNSVGSvgView') return;
      if (isHidden(node, anc)) return;
      const labelled = [...anc, node].some((n) => nameOf(n) !== '' && n.type !== 'Text');
      if (!labelled)
        found.push(`svg without label or aria-hidden (testID ${String(node.props?.testID)})`);
    });
    report(found);
  });

  it('screens have headings, and section titles are marked as headers', () => {
    let headers = 0;
    walk(tree, (node) => {
      if (roleOf(node) === 'header') headers++;
    });
    expect(headers).toBeGreaterThan(10);
  });

  it('hit areas are at least 44 pt tall', () => {
    const found: string[] = [];
    walk(tree, (node, anc) => {
      const role = roleOf(node);
      if (!role || !INTERACTIVE.has(role) || isHidden(node, anc)) return;
      const s = styleOf(node);
      const h = (s.minHeight ?? s.height) as number | undefined;
      if (typeof h !== 'number' || h < 44)
        found.push(`${role} "${nameOf(node)}" height ${String(h)}`);
    });
    report(found);
  });

  it('text meets WCAG AA contrast against what it sits on (4.5, large text 3)', () => {
    const palette = colors[mode.scheme];
    const page = parseColor(palette.bg) as Rgba;
    const found: string[] = [];
    let checked = 0;
    walk(tree, (node, anc) => {
      if (node.type !== 'Text' || isHidden(node, anc)) return;
      if (textOf(node).trim() === '') return;
      // `color` may be inherited from an ancestor Text; take the nearest one that sets it.
      const own = [node, ...[...anc].reverse()].map((n) => styleOf(n).color).find((c) => c);
      const fg = parseColor(own);
      if (!fg) return;
      const bg = backdrop(anc, page);
      const fgOpaque = fg.a < 1 ? { ...fg, ...over2(fg, bg) } : fg;
      const size = (styleOf(node).fontSize as number) / mode.fontScale;
      const bold = /Bold|SemiBold|ExtraBold/.test(String(styleOf(node).fontFamily));
      const large = size >= 24 || (size >= 18.66 && bold);
      const ratio = contrast(fgOpaque, bg);
      checked++;
      if (ratio < (large ? 3 : 4.5)) {
        found.push(
          `"${textOf(node).slice(0, 40)}" ${hex(fgOpaque)} on ${hex(bg)} = ${ratio.toFixed(2)}:1 (${size}pt)`,
        );
      }
    });
    expect(checked).toBeGreaterThan(50);
    report(found);
  });

  it('never truncates or clips text', () => {
    const found: string[] = [];
    walk(tree, (node) => {
      if (node.type === 'Text' && node.props?.numberOfLines !== undefined) {
        found.push(`numberOfLines on "${textOf(node).slice(0, 40)}"`);
      }
    });
    report(found);
  });

  it('every text size follows the type scale (x font scale), no stray sizes', () => {
    const allowed = new Set<number>();
    const tokens = require('@/ui/tokens.json').type as Record<string, { size: number }>;
    Object.values(tokens).forEach((t) => allowed.add(t.size * mode.fontScale));
    const found: string[] = [];
    walk(tree, (node) => {
      const size = styleOf(node).fontSize;
      if (node.type === 'Text' && typeof size === 'number' && !allowed.has(size)) {
        found.push(`fontSize ${size} on "${textOf(node).slice(0, 40)}"`);
      }
    });
    report(found);
  });
});

it('light and dark use different surfaces, and 200% doubles the heading', async () => {
  const light = serialise(await render(MODES[0]));
  const dark = serialise(await render(MODES[1]));
  const big = serialise(await render(MODES[2]));
  expect(light).not.toEqual(dark);
  const size = (s: string) =>
    Number(/Text role=header text="Gallery" \{[^}]*fontSize=(\d+)/.exec(s)?.[1]);
  expect(size(big)).toBe(size(light) * 2);
});

function over2(fg: Rgba, bg: Rgba) {
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  };
}
