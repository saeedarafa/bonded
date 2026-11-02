// Helpers over the rendered host tree (`screen.toJSON()`): flatten styles, resolve the colour a
// piece of text actually sits on, contrast maths, and a compact serialisation used as the
// committed baseline.
import { StyleSheet } from 'react-native';
import type { ReactTestRendererJSON } from 'react-test-renderer';

export type Node = ReactTestRendererJSON;
export type Style = Record<string, unknown>;

export const asNodes = (json: unknown): Node[] =>
  json === null || json === undefined ? [] : ((Array.isArray(json) ? json : [json]) as Node[]);

export const styleOf = (node: Node): Style =>
  (StyleSheet.flatten(node.props?.style as never) ?? {}) as Style;

export const childNodes = (node: Node): Node[] =>
  (node.children ?? []).filter((c): c is Node => typeof c !== 'string');

export const textOf = (node: Node): string =>
  (node.children ?? []).map((c) => (typeof c === 'string' ? c : textOf(c))).join('');

export function walk(
  nodes: Node[],
  visit: (node: Node, ancestors: Node[]) => void,
  ancestors: Node[] = [],
) {
  for (const node of nodes) {
    visit(node, ancestors);
    walk(childNodes(node), visit, [...ancestors, node]);
  }
}

/** Accessibility-hidden subtrees are not read by VoiceOver/TalkBack. */
export const isHidden = (node: Node, ancestors: Node[]) =>
  [...ancestors, node].some(
    (n) =>
      n.props?.accessibilityElementsHidden === true ||
      n.props?.importantForAccessibility === 'no-hide-descendants' ||
      n.props?.['aria-hidden'] === true,
  );

// ---- colour -------------------------------------------------------------------------------

export type Rgba = { r: number; g: number; b: number; a: number };

export function parseColor(value: unknown): Rgba | null {
  if (typeof value !== 'string') return null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim());
  if (hex) {
    let h = hex[1]!;
    if (h.length === 3) h = [...h].map((c) => c + c).join('');
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  const rgba = /^rgba?\(([^)]+)\)$/i.exec(value.trim());
  if (rgba) {
    const p = rgba[1]!.split(',').map((s) => parseFloat(s));
    return { r: p[0]!, g: p[1]!, b: p[2]!, a: p[3] ?? 1 };
  }
  return null; // 'transparent', processed colour ints, etc.
}

export const over = (top: Rgba, under: Rgba): Rgba => ({
  r: top.r * top.a + under.r * (1 - top.a),
  g: top.g * top.a + under.g * (1 - top.a),
  b: top.b * top.a + under.b * (1 - top.a),
  a: 1,
});

const lum = ({ r, g, b }: Rgba) => {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

export function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The opaque colour behind a node: nearest ancestors' backgrounds composited, root = `page`. */
export function backdrop(ancestors: Node[], page: Rgba): Rgba {
  let under = page;
  for (const a of ancestors) {
    const bg = parseColor(styleOf(a).backgroundColor);
    if (bg && bg.a > 0) under = over(bg, under);
  }
  return under;
}

export const hex = (c: Rgba) =>
  '#' +
  [c.r, c.g, c.b]
    .map((v) => Math.round(v).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();

// ---- baseline -----------------------------------------------------------------------------

const KEEP = [
  'backgroundColor',
  'color',
  'borderColor',
  'borderWidth',
  'borderRadius',
  'fontFamily',
  'fontSize',
  'lineHeight',
  'minHeight',
  'minWidth',
  'height',
  'width',
  'padding',
  'paddingHorizontal',
  'paddingVertical',
  'gap',
  'flexDirection',
  'opacity',
] as const;

/**
 * One line per node: indentation = depth, then type, role, label and the style facts that make
 * a design change visible (colours, type size, spacing, hit area). Layout-engine output does not
 * exist in Node, so this is the strongest pixel-free baseline; real pixels come from Maestro.
 */
export function serialise(nodes: Node[]): string {
  const lines: string[] = [];
  const emit = (node: Node, depth: number) => {
    const p = node.props ?? {};
    const style = styleOf(node);
    const bits: string[] = [];
    for (const k of KEEP) if (style[k] !== undefined) bits.push(`${k}=${String(style[k])}`);
    const role = (p.accessibilityRole ?? p.role) as string | undefined;
    const label = p.accessibilityLabel as string | undefined;
    const text = node.type === 'Text' ? textOf(node) : undefined;
    const head = [
      node.type,
      role && `role=${role}`,
      label && `label=${JSON.stringify(label)}`,
      p.testID && `id=${String(p.testID)}`,
      text !== undefined && `text=${JSON.stringify(text)}`,
      p.accessibilityElementsHidden && 'hidden',
    ].filter(Boolean);
    lines.push(`${'  '.repeat(depth)}${head.join(' ')} {${bits.join(' ')}}`);
    for (const c of childNodes(node)) emit(c, depth + 1);
  };
  nodes.forEach((n) => emit(n, 0));
  return lines.join('\n') + '\n';
}
