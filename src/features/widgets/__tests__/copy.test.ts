import en from '@/i18n/locales/en.json';
import { t } from '@/i18n';

/**
 * MOB-77: `widgets.*` copy (spec 38c §7). Widgets show no answer or message text and no note
 * from a little thing (FUN-04), so the only placeholders are the partner's first name, counts,
 * times and badge numbers. The Lock Screen variants (`gotLocked`) never name the partner.
 */

const ALLOWED = new Set(['partner', 'count', 'time', 'badge']);

function leaves(node: unknown, path: string[] = []): [string, string][] {
  if (typeof node === 'string') return [[path.join('.'), node]];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
    leaves(v, [...path, k]),
  );
}

const widgets = leaves(en.widgets, ['widgets']);

it('has every widget name and the shared states', () => {
  for (const kind of [
    'littleThings',
    'thinking',
    'days',
    'streak',
    'question',
    'mood',
    'onThisDay',
    'ritual',
  ]) {
    expect(t(`widgets.${kind}.name` as never)).not.toMatch(/^widgets\./);
  }
  expect(t('widgets.locked.cta')).toBe('See Premium');
  expect(t('widgets.expired')).toBe('Tap to catch up');
  expect(t('widgets.open')).toBe('Open Bonded');
  expect(t('widgets.ended')).toBe('This widget is resting');
});

it.each(widgets)('%s uses only safe placeholders', (_key, text) => {
  for (const [, name] of text.matchAll(/\{\{\s*([a-z]+)/gi)) expect(ALLOWED).toContain(name);
});

it('Lock Screen copy never names the partner', () => {
  for (const [key, text] of widgets.filter(([k]) => k.includes('gotLocked'))) {
    expect([key, text]).not.toEqual([key, expect.stringContaining('{{partner')]);
  }
});

it('plurals and interpolation', () => {
  expect(t('widgets.days.count', { count: 1284 })).toBe('1284 days together');
  expect(t('widgets.thinking.got.kiss', { count: 3, partner: 'sam', time: '9:14' })).toBe(
    'Sam sent 3 kisses · 9:14',
  );
  expect(t('widgets.thinking.gotLocked.hug', { time: '9:14' })).toBe('A hug for you · 9:14');
  expect(t('widgets.littleThings.sent', { partner: 'Sam' })).toBe('Sent to Sam 🤍');
});
