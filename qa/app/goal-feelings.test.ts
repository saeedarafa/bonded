// QA-48 (D58, MOB-75): P3 "goal feelings" copy and line choice, across the boundaries mobile's own
// tests do not cross:
// - every goal on 06 (`GOALS`) has its P3 line in en.json (COPY_GUIDE: a new 06 goal is not done
//   without it), the three general lines exist, and en.json has no line for a goal 06 no longer has;
// - the lines say what D58 in docs/plan/DESIGN_DELTA.md approved (read from the row, so a PO copy
//   change there and in en.json is one edit each, not a test edit);
// - no feature list, pack name or Premium jargon in the block (D58, store rules);
// - `goalFeelingLines` over every subset of goals and several tap orders: 06 board order, at most 3,
//   general lines when nothing (or nothing known) was picked, keys only (no copy) in `key`.
// Until MOB-75 is on the branch (no `premium.goalFeelings` in en.json) the suite is skipped.
import fs from 'node:fs';
import path from 'node:path';

import { GOALS } from '@/features/onboarding/store';

const root = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

type Copy = Record<string, string> & { general?: Record<string, string> };
const en = JSON.parse(read('src/i18n/locales/en.json')) as { premium?: { goalFeelings?: Copy } };
const copy = en.premium?.goalFeelings;
const GENERAL = ['closeness', 'laughter', 'curiosity'];
const FRAME = ['title', 'titleSolo', 'label', 'closing', 'closingSolo'];

type Line = { key: string; i18nKey: string; icon: string };
const helperFile = path.join(root, 'src/features/onboarding/goalFeelings.ts');
const helper: { goalFeelingLines: (picked: readonly string[]) => Line[] } | null =
  copy && fs.existsSync(helperFile) ? require('@/features/onboarding/goalFeelings') : null;

/** D58's approved copy, from its DESIGN_DELTA row: `goal` "line", and general `name "line"`. */
function d58(): { goals: Record<string, string>; general: Record<string, string>; frame: string[] } | null {
  const row = read('docs/plan/DESIGN_DELTA.md')
    .split('\n')
    .find((l) => l.startsWith('| D58 |'));
  if (!row) return null;
  const goals: Record<string, string> = {};
  for (const m of row.matchAll(/`([a-z_]+)` "([^"]+)"/g)) goals[m[1]!] = m[2]!;
  const general: Record<string, string> = {};
  for (const m of row.matchAll(/\b(closeness|laughter|curiosity) "([^"]+)"/g)) general[m[1]!] = m[2]!;
  const frame = [...row.matchAll(/(?:headline|closing line) "([^"]+)"/g)].map((m) => m[1]!);
  return { goals, general, frame };
}

/** Compare copy without the board's markdown emphasis and with i18next's {{partner}} as {partner}. */
const norm = (s: string) => s.replace(/\*/g, '').replace(/\{\{(\w+)\}\}/g, '{$1}').trim();

const suite = copy ? describe : describe.skip;

suite('QA-48 P3 goal feelings copy (D58)', () => {
  const c = copy!;

  test('every 06 goal has its P3 line (COPY_GUIDE: a new goal needs one)', () => {
    const missing = GOALS.filter((g) => !(typeof c[g] === 'string' && c[g].trim().length > 0));
    expect(missing).toEqual([]);
  });

  test('the three general lines exist', () => {
    expect(Object.keys(c.general ?? {}).sort()).toEqual([...GENERAL].sort());
    for (const k of GENERAL) expect(c.general?.[k]?.trim()).toBeTruthy();
  });

  test('no line for a goal 06 does not have', () => {
    const extra = Object.keys(c).filter(
      (k) => k !== 'general' && !FRAME.includes(k) && !(GOALS as readonly string[]).includes(k),
    );
    expect(extra).toEqual([]);
  });

  test('only {{partner}} is interpolated, and the solo variants have no name slot', () => {
    const all = [
      ...FRAME.map((k) => [k, c[k]] as const),
      ...GOALS.map((g) => [g, c[g]] as const),
      ...GENERAL.map((k) => [`general.${k}`, c.general?.[k]] as const),
    ];
    for (const [k, s] of all) {
      const vars = [...String(s).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]);
      expect({ k, vars: vars.filter((v) => v !== 'partner') }).toEqual({ k, vars: [] });
    }
    for (const k of ['titleSolo', 'closingSolo', ...GENERAL.map((g) => `general.${g}`)]) {
      const s = k.startsWith('general.') ? c.general?.[k.slice(8)] : c[k];
      expect({ k, slot: /\{\{/.test(String(s)) }).toEqual({ k, slot: false });
    }
  });

  test('no feature list, pack name or Premium jargon in the block', () => {
    const packs = read('supabase/content/packs.csv')
      .trim()
      .split('\n')
      .slice(1)
      .map((l) => l.split(',')[1]!.trim())
      .filter(Boolean);
    const jargon =
      /\b(premium|unlock\w*|unlimited|pack|packs|feature\w*|subscri\w*|trial|history|voice note\w*|ad-free)\b/i;
    const lines = [
      ...FRAME.map((k) => c[k]!),
      ...GOALS.map((g) => c[g]!),
      ...GENERAL.map((k) => c.general![k]!),
    ];
    for (const s of lines) {
      expect({ s, jargon: jargon.test(s) }).toEqual({ s, jargon: false });
      for (const p of packs) expect({ s, pack: s.toLowerCase().includes(p.toLowerCase()) }).toEqual({ s, pack: false });
    }
  });

  const approved = d58();
  (approved ? test : test.skip)('lines match the copy D58 approved (DESIGN_DELTA)', () => {
    const a = approved!;
    expect(Object.keys(a.goals).sort()).toEqual([...GOALS].sort());
    for (const g of GOALS) expect({ g, line: norm(c[g]!) }).toEqual({ g, line: norm(a.goals[g]!) });
    for (const k of GENERAL) expect({ k, line: norm(c.general![k]!) }).toEqual({ k, line: norm(a.general[k]!) });
    expect(a.frame.map(norm)).toEqual(expect.arrayContaining([norm(c.title!), norm(c.closing!)]));
  });
});

(helper ? describe : describe.skip)('QA-48 P3 line choice: goalFeelingLines (D58)', () => {
  const lines = (picked: readonly string[]) => helper!.goalFeelingLines(picked);
  const generalKeys = GENERAL.map((g) => `general.${g}`);

  /** Every subset of GOALS, each in board order, reversed and rotated (tap orders). */
  function* pickings(): Generator<string[]> {
    for (let mask = 0; mask < 1 << GOALS.length; mask++) {
      const set = GOALS.filter((_, i) => mask & (1 << i));
      yield [...set];
      yield [...set].reverse();
      if (set.length > 1) yield [...set.slice(1), set[0]!];
    }
  }

  test('board order, at most 3, general lines when nothing was picked', () => {
    let n = 0;
    for (const picked of pickings()) {
      n++;
      const got = lines(picked).map((l) => l.key);
      const want = picked.length === 0 ? generalKeys : GOALS.filter((g) => picked.includes(g)).slice(0, 3);
      expect({ picked, got }).toEqual({ picked, got: want });
    }
    expect(n).toBeGreaterThan(1 << GOALS.length);
  });

  test('unknown or duplicate keys (older build, double tap) change nothing', () => {
    expect(lines(['not_a_goal']).map((l) => l.key)).toEqual(generalKeys);
    expect(lines(['not_a_goal', GOALS[1]!]).map((l) => l.key)).toEqual([GOALS[1]]);
    expect(lines([GOALS[2]!, GOALS[2]!, GOALS[0]!]).map((l) => l.key)).toEqual([GOALS[0], GOALS[2]]);
  });

  test('each line points at existing copy and has an icon; `key` is a key, never copy', () => {
    const en2 = JSON.parse(read('src/i18n/locales/en.json')) as Record<string, unknown>;
    const at = (k: string) => k.split('.').reduce<unknown>((o, p) => (o as Record<string, unknown>)?.[p], en2);
    for (const picked of [[], [...GOALS], [GOALS[0]!]]) {
      for (const l of lines(picked)) {
        expect(typeof at(l.i18nKey)).toBe('string');
        expect(l.icon).toBeTruthy();
        expect(l.key).toMatch(/^(general\.)?[a-z_]+$/);
      }
    }
  });
});
