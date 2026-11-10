// QA-07: the a11y suite covers every screen, and says so. Static (reads files, renders nothing):
//   1. every screen id in qa/release/screen-requirements.csv is a CASE, a PLACEHOLDER or in
//      NOT_RENDERED with a reason (a new CSV id fails until someone decides);
//   2. every screen the source marks as built ("<id>-screen" testID, or a frame's screenId="<id>")
//      has a CASE or a NOT_RENDERED reason (a newly built screen fails until it gets a case);
//   3. every PLACEHOLDER still renders PlaceholderScreen with that id, and every PlaceholderScreen
//      in app/ is listed (a placeholder that got built fails: move it to CASES).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { CASES, NOT_RENDERED, PLACEHOLDERS } from './screens';

const ROOT = join(__dirname, '..', '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === '__tests__' ? [] : files(p);
    return /\.tsx?$/.test(name) ? [p] : [];
  });
}

/** Screen ids from the release CSV (column screen_id). */
function csvIds(): string[] {
  const rows = readFileSync(join(ROOT, 'qa/release/screen-requirements.csv'), 'utf8').trim().split('\n');
  const header = rows[0]!.split(',');
  const col = header.indexOf('screen_id');
  return [...new Set(rows.slice(1).map((r) => r.match(/^"[^"]*","([^"]+)"/)?.[1] ?? r.split(',')[col]!))];
}

const SOURCES = [...files(join(ROOT, 'src')), ...files(join(ROOT, 'app'))].map((p) => ({
  path: relative(ROOT, p),
  text: readFileSync(p, 'utf8'),
}));
const ID = '(J?\\d+b?)';
const PLACEHOLDER_USE = new RegExp(`<PlaceholderScreen\\s+screenId=["']${ID}["']`, 'g');

/** id -> files that mark it as a built screen. */
function builtIds(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (id: string, path: string) => out.set(id, [...(out.get(id) ?? []), path]);
  for (const { path, text } of SOURCES) {
    if (path.startsWith('src/dev/')) continue;
    for (const m of text.matchAll(new RegExp(`testID=\\{?["'\`]${ID}-screen["'\`]`, 'g'))) add(m[1]!, path);
    for (const m of text.matchAll(new RegExp(`<(\\w+)[^>]*?\\sscreenId=["']${ID}["']`, 'g')))
      if (m[1] !== 'PlaceholderScreen') add(m[2]!, path);
  }
  return out;
}

const caseIds = new Set(CASES.map((c) => c.id));
const placeholderIds = new Set(Object.keys(PLACEHOLDERS));
const notRendered = new Set(Object.keys(NOT_RENDERED));

describe('qa/a11y coverage', () => {
  it('every CSV screen id is a case, a placeholder or not-rendered with a reason', () => {
    const missing = csvIds().filter((id) => !caseIds.has(id) && !placeholderIds.has(id) && !notRendered.has(id));
    expect(missing).toEqual([]);
  });

  it('every id in the registry is a real CSV screen id (no typos, no leftovers)', () => {
    const csv = new Set(csvIds());
    const unknown = [...caseIds, ...placeholderIds, ...notRendered].filter((id) => !csv.has(id));
    expect([...new Set(unknown)]).toEqual([]);
  });

  it('an id is in exactly one list', () => {
    const both = [...caseIds].filter((id) => placeholderIds.has(id) || notRendered.has(id));
    const pn = [...placeholderIds].filter((id) => notRendered.has(id));
    expect([...both, ...pn]).toEqual([]);
  });

  it('every built screen in src/ and app/ has a case', () => {
    const built = builtIds();
    // Guard against a pattern that silently stops matching (there are 30+ built screens).
    expect(built.size).toBeGreaterThan(25);
    const missing = [...built]
      .filter(([id]) => !caseIds.has(id) && !notRendered.has(id))
      .map(([id, where]) => `${id} (${[...new Set(where)].join(', ')})`);
    expect(missing).toEqual([]);
  });

  it('every placeholder still renders PlaceholderScreen, and every PlaceholderScreen is listed', () => {
    const used = new Map<string, string>();
    for (const { path, text } of SOURCES)
      for (const m of text.matchAll(PLACEHOLDER_USE)) if (path.startsWith('app/')) used.set(m[1]!, path);
    const built = [...placeholderIds].filter((id) => !used.has(id)).map((id) => `${id} ${PLACEHOLDERS[id]} was built: move it to CASES`);
    const unlisted = [...used].filter(([id]) => !placeholderIds.has(id)).map(([id, p]) => `${id} (${p}) is a placeholder: add it to PLACEHOLDERS`);
    expect([...built, ...unlisted]).toEqual([]);
  });

  it('a placeholder route is where PLACEHOLDERS says', () => {
    const wrong = Object.entries(PLACEHOLDERS).flatMap(([id, url]) => {
      const file = SOURCES.find((s) => s.path.startsWith('app/') && new RegExp(`screenId=["']${id}["']`).test(s.text));
      if (!file) return [];
      const route = `/${file.path.replace(/^app\//, '').replace(/\([^)]+\)\//g, '').replace(/(\/index)?\.tsx$/, '')}`;
      return route === url ? [] : [`${id}: PLACEHOLDERS says ${url}, the route is ${route}`];
    });
    expect(wrong).toEqual([]);
  });
});

describe('coverage summary', () => {
  it('prints screens x checks', () => {
    const rows = CASES.length;
    const screens = caseIds.size;
    // Rules in light + light-200 for every case; snapshots in 3 modes for the `snapshot` cases.
    const snaps = CASES.filter((c) => c.snapshot).length;
    console.log(
      `qa/a11y: ${screens} screens, ${rows} states; ${rows * 2} rule runs, ${snaps * 3} snapshots; ` +
        `${placeholderIds.size} placeholders, ${notRendered.size} not rendered (with reasons).`,
    );
    expect(screens).toBeGreaterThan(0);
  });
});
