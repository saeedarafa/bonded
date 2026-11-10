// QA-07: axe-style rules over the rendered host tree (screen.toJSON()). Each rule returns
// findings as "<rule>: <detail>" strings, so a known product bug can be matched by a substring
// (KNOWN in screens.test.tsx) and an unexpected one fails with a readable line.
import {
  childNodes,
  isHidden,
  styleOf,
  textOf,
  walk,
  type Node,
} from '../visual/tree';
import { colors } from '@/ui/theme';

import { LOCKED_Q, PARTNER_ANSWER } from './world';

const SCROLLERS = new Set(['RCTScrollView', 'RCTScrollContentView', 'AndroidHorizontalScrollView']);
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'switch',
  'radio',
  'checkbox',
  'tab',
  'adjustable',
  'menuitem',
  'togglebutton',
  'imagebutton',
  'search',
  'combobox',
]);
const TOGGLES = new Set(['switch', 'radio', 'checkbox', 'tab', 'togglebutton']);
const MIN_TARGET = 44;

export const roleOf = (n: Node) => (n.props?.accessibilityRole ?? n.props?.role) as string | undefined;
const labelOf = (n: Node) =>
  (n.props?.accessibilityLabel ?? n.props?.['aria-label']) as string | undefined;

/** Text a screen reader would read for this element: its label, else its visible descendants. */
export function nameOf(node: Node): string {
  const label = labelOf(node);
  if (label?.trim()) return label.trim();
  // A Text with onPress (inline link) is its own name.
  if (node.type === 'Text') return textOf(node).replace(/\s+/g, ' ').trim();
  const parts: string[] = [];
  walk(childNodes(node), (n, anc) => {
    if (isHidden(n, anc)) return;
    if (n.type === 'Text') parts.push(textOf(n));
    else if (labelOf(n)) parts.push(labelOf(n)!);
  });
  return [...new Set(parts)].join(' ').replace(/\s+/g, ' ').trim();
}

/** Has a press handler: Pressable / Touchable* / Text with onPress (host gets onClick). */
export function isPressable(n: Node): boolean {
  if (SCROLLERS.has(String(n.type))) return false;
  const p = n.props ?? {};
  return typeof p.onClick === 'function' || typeof p.onPress === 'function' || typeof p.onLongPress === 'function';
}

const isGraphic = (n: Node) => n.type === 'RNSVGSvgView' || n.type === 'Image';

/** Every string VoiceOver/TalkBack can reach: visible text and labels, values, hints. */
export function spokenStrings(tree: Node[]): string[] {
  const out: string[] = [];
  walk(tree, (n, anc) => {
    if (isHidden(n, anc)) return;
    const p = n.props ?? {};
    if (n.type === 'Text') out.push(textOf(n));
    for (const k of ['accessibilityLabel', 'aria-label', 'accessibilityHint', 'placeholder'])
      if (typeof p[k] === 'string') out.push(p[k] as string);
    const v = p.accessibilityValue as { text?: string } | undefined;
    if (v?.text) out.push(v.text);
  });
  return out;
}

/** Every string anywhere in the tree, hidden or not (what could be drawn or read). */
export function allStrings(tree: Node[]): string[] {
  const out: string[] = [];
  walk(tree, (n) => {
    const p = n.props ?? {};
    for (const c of n.children ?? []) if (typeof c === 'string') out.push(c);
    for (const k of ['accessibilityLabel', 'aria-label', 'accessibilityHint', 'placeholder', 'value', 'defaultValue'])
      if (typeof p[k] === 'string') out.push(p[k] as string);
  });
  return out;
}

const where = (n: Node) => (n.props?.testID ? `#${String(n.props.testID)}` : `<${String(n.type)}>`);
const short = (s: string) => JSON.stringify(s.length > 48 ? `${s.slice(0, 45)}...` : s);

// Gold is shared by premium and badges (D41): premium must never be told apart by colour alone.
const GOLD = new Set(
  (['light', 'dark'] as const).flatMap((s) => {
    const c = colors[s] as Record<string, string>;
    return ['premium', 'premiumText', 'premiumTint'].map((k) => c[k]?.toUpperCase()).filter(Boolean);
  }),
);
const usesGold = (n: Node) => {
  const s = styleOf(n);
  return ['backgroundColor', 'borderColor', 'color'].some(
    (k) => typeof s[k] === 'string' && GOLD.has((s[k] as string).toUpperCase()),
  );
};

const isBadge = (n: Node) => /badge/i.test(`${labelOf(n) ?? ''} ${String(n.props?.testID ?? '')}`);

/**
 * A press layer that is deliberately not a stop for VoiceOver: accessible=false and it holds the
 * real controls (the keyboard-dismiss layer in DailyFrame/OnboardingFrame, CodeInput's tap area
 * around its labelled TextInput). A press target with accessible=false and nothing focusable
 * inside is still a finding.
 */
function isPassThrough(n: Node): boolean {
  if (n.props?.accessible !== false) return false;
  let inner = false;
  walk(childNodes(n), (c, anc) => {
    if (inner || isHidden(c, anc)) return;
    const r = roleOf(c);
    if (c.type === 'TextInput' || isPressable(c) || (r && (INTERACTIVE_ROLES.has(r) || r === 'header')))
      inner = true;
  });
  return inner;
}

export type RuleOptions = {
  /** The screen shows no heading on purpose (documented in screens.ts). */
  noHeading?: boolean;
};

/**
 * The checks every screen gets. Each finding starts with the rule id:
 * touch-role, touch-name, toggle-state, input-label, graphic, target-size, heading, premium-label.
 */
export function a11yFindings(tree: Node[], opts: RuleOptions = {}): string[] {
  const found: string[] = [];
  let headers = 0;
  let badges = false;
  let premiumLabel = false;
  walk(tree, (n, anc) => {
    if (isHidden(n, anc)) return;
    if (isBadge(n)) badges = true;
    if ((n.type === 'Text' || n.props?.accessible === true) && /^premium\b/i.test(nameOf(n))) premiumLabel = true;
  });
  const screenSaysPremium = premiumLabel && !badges;
  walk(tree, (n, anc) => {
    if (isHidden(n, anc)) return;
    const role = roleOf(n);
    if (role === 'header' || role === 'heading') headers++;

    const pressable = isPressable(n);
    // A pressable inside another accessible element is read as part of it (one stop for VoiceOver).
    const grouped = anc.some((a) => a.props?.accessible === true && isPressable(a));
    if (pressable && !grouped && !isPassThrough(n)) {
      const name = nameOf(n);
      if (!role || role === 'none') found.push(`touch-role: ${where(n)} ${short(name)} has no accessibilityRole`);
      if (!name) found.push(`touch-name: ${where(n)} (${role ?? 'no role'}) has no accessible name`);
      if (n.props?.accessible === false)
        found.push(`touch-role: ${where(n)} ${short(name)} is accessible=false`);
      // Target size where the layout props say it (Node has no layout engine).
      const s = styleOf(n);
      const slop = (n.props?.hitSlop ?? {}) as Record<string, number> | number;
      const pad = (a: 'top' | 'left', b: 'bottom' | 'right') =>
        typeof slop === 'number' ? 2 * slop : (slop[a] ?? 0) + (slop[b] ?? 0);
      const h = (s.minHeight ?? s.height) as unknown;
      const w = (s.minWidth ?? s.width) as unknown;
      if (typeof h === 'number' && h + pad('top', 'bottom') < MIN_TARGET)
        found.push(`target-size: ${where(n)} ${short(name)} is ${h + pad('top', 'bottom')} pt tall`);
      if (typeof w === 'number' && w + pad('left', 'right') < MIN_TARGET)
        found.push(`target-size: ${where(n)} ${short(name)} is ${w + pad('left', 'right')} pt wide`);
    }
    if (role && TOGGLES.has(role)) {
      const st = n.props?.accessibilityState as Record<string, unknown> | undefined;
      const has =
        (st && ('checked' in st || 'selected' in st)) ||
        n.props?.['aria-checked'] !== undefined ||
        n.props?.['aria-selected'] !== undefined;
      if (!has) found.push(`toggle-state: ${where(n)} ${role} ${short(nameOf(n))} exposes no checked/selected`);
    }
    if (role && INTERACTIVE_ROLES.has(role) && !pressable && !grouped && !nameOf(n))
      found.push(`touch-name: ${where(n)} (${role}) has no accessible name`);

    if (n.type === 'TextInput') {
      const p = n.props ?? {};
      const named =
        labelOf(n) || p.accessibilityLabelledBy || p['aria-labelledby'] || (p.placeholder as string | undefined)?.trim();
      if (!named) found.push(`input-label: ${where(n)} text field has no label or placeholder`);
    }

    if (isGraphic(n)) {
      const named = [...anc, n].some((a) => a.props?.accessible === true || labelOf(a));
      if (!named) found.push(`graphic: ${where(n)} ${String(n.type)} is neither labelled nor hidden`);
    }

    // D41: a gold element outside a badge must be told apart as premium by words, not colour:
    // its own accessible element says "Premium", or a gold container it sits in does (the 28
    // saver card with its Premium chip), or the screen shows a Premium label and no badge (14,
    // 15, 33, 36: on such a screen gold can only mean premium).
    if (usesGold(n)) {
      const chain = [...anc, n];
      if (!chain.some(isBadge)) {
        // The element a screen reader stops on; without one, the gold node's own group (parent).
        const scope =
          [...chain].reverse().find((a) => a.props?.accessible === true || labelOf(a)) ??
          anc[anc.length - 1] ??
          n;
        const words = n.type === 'Text' && scope === n ? textOf(n) : nameOf(scope);
        const goldGroupSays = anc.some((a) => usesGold(a) && /premium/i.test(nameOf(a)));
        if (!/premium/i.test(words) && !goldGroupSays && !screenSaysPremium)
          found.push(`premium-label: ${where(scope)} ${short(words)} is gold but does not say Premium`);
      }
    }
  });
  if (!opts.noHeading && headers === 0) found.push('heading: no element with accessibilityRole="header"');
  return found;
}

/** Reveal rule (CONTRACTS §1, D13): the partner's answer is nowhere in the tree before the hold. */
export function revealFindings(tree: Node[]): string[] {
  return allStrings(tree)
    .filter((s) => s.includes('FIXTURE-PARTNER-ANSWER'))
    .map((s) => `reveal-rule: partner answer rendered before reveal: ${short(s)}`);
}

/** MOB-20 / D43: a free couple never gets locked pack question text, in pixels or a11y. */
export function lockedPackFindings(tree: Node[]): string[] {
  return allStrings(tree)
    .filter((s) => s.includes(LOCKED_Q))
    .map((s) => `locked-pack: locked question text rendered: ${short(s)}`);
}

/** Questions, answers and messages are never cut off (DESIGN.md §3, 200% text). */
export function truncationFindings(tree: Node[], longTexts: string[]): string[] {
  const found: string[] = [];
  walk(tree, (n) => {
    if (n.type !== 'Text' || n.props?.numberOfLines === undefined) return;
    const t = textOf(n);
    if (longTexts.some((l) => t.includes(l)))
      found.push(`truncation: numberOfLines=${String(n.props.numberOfLines)} on ${short(t)}`);
  });
  return found;
}

export { PARTNER_ANSWER };
