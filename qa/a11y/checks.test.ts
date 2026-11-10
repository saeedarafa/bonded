// QA-07: the rules in checks.ts on hand-built host trees, so every exemption has a negative
// control: a pass-through layer, an inline link and a premium context must not hide a real bug.
import { colors } from '@/ui/theme';

import type { Node } from '../visual/tree';
import { a11yFindings } from './checks';

const el = (type: string, props: Record<string, unknown> = {}, ...children: (Node | string)[]): Node =>
  ({ type, props, children: children.length ? children : null }) as Node;
const press = () => undefined;
const header = el('Text', { accessibilityRole: 'header' }, 'Title');
const rules = (...nodes: Node[]) => a11yFindings([el('View', {}, header, ...nodes)]);
const gold = { backgroundColor: colors.light.premium };

describe('touch-role / touch-name', () => {
  it('a press target without a role is a finding', () => {
    expect(rules(el('View', { onClick: press }, el('Text', {}, 'Go')))).toEqual([
      'touch-role: <View> "Go" has no accessibilityRole',
    ]);
  });

  it('accessible=false around the real controls (keyboard-dismiss layer) is not', () => {
    const button = el('View', { onClick: press, accessible: true, accessibilityRole: 'button' }, el('Text', {}, 'Next'));
    expect(rules(el('View', { onClick: press, accessible: false, testID: 'x-dismiss' }, button))).toEqual([]);
  });

  it('accessible=false around a labelled text field (CodeInput) is not', () => {
    const input = el('TextInput', { accessibilityLabel: 'Invite code' });
    expect(rules(el('View', { onClick: press, accessible: false }, input))).toEqual([]);
  });

  it('accessible=false with only text inside is still a finding', () => {
    expect(rules(el('View', { onClick: press, accessible: false }, el('Text', {}, 'Open')))).toEqual([
      'touch-role: <View> "Open" has no accessibilityRole',
      'touch-role: <View> "Open" is accessible=false',
    ]);
  });

  it('an inline link is named by its own text; an empty one is a finding', () => {
    expect(rules(el('Text', { onClick: press, accessibilityRole: 'link' }, 'Terms'))).toEqual([]);
    expect(rules(el('Text', { onClick: press, accessibilityRole: 'link' }, ' '))).toEqual([
      'touch-name: <Text> (link) has no accessible name',
    ]);
  });
});

describe('premium-label (D41)', () => {
  const cta = el('View', { accessible: true, accessibilityRole: 'button', style: gold }, el('Text', {}, 'Use it'));

  it('a gold control on a screen with no Premium label is a finding', () => {
    expect(rules(cta)).toEqual(['premium-label: <View> "Use it" is gold but does not say Premium']);
  });

  it('a gold card that carries a Premium chip covers the gold control inside it', () => {
    const chip = el('View', { accessible: true, accessibilityLabel: 'Premium' });
    expect(rules(el('View', { style: { borderColor: colors.light.premium } }, chip, cta))).toEqual([]);
  });

  it('a Premium chip on a screen without badges covers the gold controls', () => {
    expect(rules(el('View', { accessible: true, accessibilityLabel: 'Premium' }), cta)).toEqual([]);
  });

  it('a Premium chip does not cover gold on a screen that also shows a badge', () => {
    const badge = el('View', { accessible: true, accessibilityLabel: '7-day badge, earned', style: gold });
    expect(rules(el('View', { accessible: true, accessibilityLabel: 'Premium' }), badge, cta)).toEqual([
      'premium-label: <View> "Use it" is gold but does not say Premium',
    ]);
  });
});
