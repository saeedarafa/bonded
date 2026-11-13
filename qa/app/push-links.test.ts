// QA-05: push and deep-link fixtures against CONTRACTS §5, notifications.json and the app's routes.
// - every push in qa/fixtures/push-payloads.json has the §5 data shape and one of its five link
//   shapes, and the app turns it into a screen that exists (an Expo Router file in app/);
// - every url notifications.json gives a push type routes the same way;
// - every link in qa/fixtures/deeplinks.json opens an existing route (or is marked later);
// - each §5 link shape has a deeplinks.json row (the cold/warm/signed-out expectations live there).
// No device: the route table is read from app/ the way Expo Router builds it (groups dropped,
// index files, [param] segments).
import fs from 'node:fs';
import path from 'node:path';

import { hrefForPush, hrefFromUrl, parsePushData, PUSH_TYPES } from '@/features/push/links';

const root = path.resolve(__dirname, '..', '..');
const read = <T>(rel: string): T => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')) as T;

type Payload = { case: string; type: string; data: Record<string, unknown> };
const pushFixture = read<{ messages: Payload[]; more_messages: Payload[] }>(
  'qa/fixtures/push-payloads.json',
);
// QA-05b: `more_messages` holds the scheduled, little-thing and voice cases (kept apart because
// src/features/push/__tests__/links.test.ts pins the `messages` case names).
const payloads = [...pushFixture.messages, ...pushFixture.more_messages];
/** §5 `data` keys: little_thing adds gesture, gestures and silent (BE-45); every other type has two. */
const DATA_KEYS: Record<string, string[]> = {
  little_thing: ['gesture', 'gestures', 'silent', 'type', 'url'],
};
type Link = { url: string } & Record<string, string>;
const deeplinks = read<{ links: Link[] }>('qa/fixtures/deeplinks.json').links;
type CopyType = { url?: string; pref?: string | null };
const copy = read<{ types: Record<string, CopyType> }>('supabase/content/notifications.json').types;

const CQ = '00000000-0000-4000-c000-000000000001';

/** CONTRACTS §5 `data.url` shapes. */
const SHAPES: [string, RegExp][] = [
  ['bonded://today', /^bonded:\/\/today$/],
  ['bonded://question/{id}', /^bonded:\/\/question\/[0-9a-f-]{36}$/i],
  ['bonded://question/{id}/thread', /^bonded:\/\/question\/[0-9a-f-]{36}\/thread$/i],
  ['bonded://packs', /^bonded:\/\/packs$/],
  ['bonded://history/recap', /^bonded:\/\/history\/recap$/],
  // QA-52 (D61, BE-62 (c), MOB-84): the `cancel_offer` push opens the cancel offer screen.
  ['bonded://subscription/offer', /^bonded:\/\/subscription\/offer$/],
];
const shapeOf = (url: string) => SHAPES.find(([, re]) => re.test(url))?.[0] ?? null;

/** Expo Router's table: one pattern per screen file in app/ (no layouts, groups dropped). */
function routes(): { file: string; segments: string[] }[] {
  const out: { file: string; segments: string[] }[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.startsWith('_') && !entry.name.startsWith('+')) {
        const rel = path.relative(path.join(root, 'app'), full).replace(/\.tsx?$/, '');
        const segments = rel
          .split(path.sep)
          .filter((s) => !/^\(.*\)$/.test(s))
          .filter((s, i, all) => !(s === 'index' && i === all.length - 1));
        out.push({ file: `app/${rel}`, segments });
      }
    }
  };
  walk(path.join(root, 'app'));
  return out;
}
const ROUTES = routes();

/** The app file a path opens, or null (Expo Router's unmatched screen). Static before dynamic. */
function routeFor(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  const matches = ROUTES.filter(
    (r) =>
      r.segments.length === parts.length &&
      r.segments.every((s, i) => /^\[[^.\]]+\]$/.test(s) || s === parts[i]),
  );
  matches.sort(
    (a, b) =>
      a.segments.filter((s) => s.startsWith('[')).length -
      b.segments.filter((s) => s.startsWith('[')).length,
  );
  return matches[0]?.file ?? null;
}
/** The path a link opens in the app: `bonded://a/b?x` → `/a/b`; `https://<domain>/j/…` → `/j/…`. */
function pathOf(url: string): string {
  if (url.startsWith('bonded://')) return `/${url.slice('bonded://'.length).split(/[?#]/)[0]}`;
  return new URL(url.replace('{valid_token}', 'token')).pathname;
}

/** Rows for screens that ship later (SCOPE.md), with the task that adds the route. */
const LATER: Record<string, string> = {
  'bonded://us/milestones': 'MOB-28 (48 Our milestones, later)',
};

describe('push-payloads.json follows CONTRACTS §5', () => {
  it.each(payloads.map((p) => [p.case, p] as const))('%s', (_name, p) => {
    expect(PUSH_TYPES).toContain(p.type);
    expect(p.data.type).toBe(p.type);
    expect(Object.keys(p.data).sort()).toEqual(DATA_KEYS[p.type] ?? ['type', 'url']);
    const url = p.data.url as string;
    expect(shapeOf(url)).not.toBeNull();
    const href = hrefFromUrl(url);
    expect(href).not.toBeNull();
    expect(hrefForPush(parsePushData(p.data))).toBe(href);
    expect(routeFor(href!)).not.toBeNull();
  });

  it('the fixture has a case for every BE-08 notify type', () => {
    const notifyTypes = [
      'partner_answered',
      'both_answered',
      'thread_activity',
      'nudge',
      'partner_joined',
      'partner_premium',
    ];
    expect(notifyTypes.filter((t) => !payloads.some((p) => p.type === t))).toEqual([]);
  });

  it('the fixture has a case for every §5 push type the app knows (QA-05b)', () => {
    expect(PUSH_TYPES.filter((t) => !payloads.some((p) => p.type === t))).toEqual([]);
  });
});

describe('notifications.json urls route to a screen', () => {
  const sent = Object.entries(copy).filter(([type]) =>
    (PUSH_TYPES as readonly string[]).includes(type),
  );

  it('every push type the app knows has copy with a url', () => {
    expect(PUSH_TYPES.filter((t) => !copy[t]?.url)).toEqual([]);
  });

  it.each(sent.map(([type, c]) => [type, c.url!] as const))('%s: %s', (_type, url) => {
    const concrete = url.replace('{couple_question_id}', CQ);
    expect(shapeOf(concrete)).not.toBeNull();
    const href = hrefFromUrl(concrete);
    expect(href).not.toBeNull();
    expect(routeFor(href!)).not.toBeNull();
  });

  it('types not sent yet are listed, so a new one gets a route check', () => {
    // QA-52: `cancel_offer` (BE-62 (c)) joined PUSH_TYPES with MOB-84, so it gets the route checks above.
    expect(
      Object.keys(copy)
        .filter((t) => !(PUSH_TYPES as readonly string[]).includes(t))
        .sort(),
    ).toEqual(['celebration', 'tips']);
  });
});

describe('deeplinks.json: every link opens an existing route', () => {
  it.each(deeplinks.map((l) => [l.url, l] as const))('%s', (url, l) => {
    // Each row says what must show, in at least one state.
    expect(Object.keys(l).filter((k) => k !== 'url').length).toBeGreaterThan(0);
    if (LATER[url]) return;
    expect(routeFor(pathOf(url))).not.toBeNull();
  });

  it.todo(`bonded://us/milestones opens 48 once its route exists (${LATER['bonded://us/milestones']})`);

  it('each §5 push link shape has a row', () => {
    const covered = new Set(deeplinks.map((l) => shapeOf(l.url)).filter(Boolean));
    expect(SHAPES.map(([s]) => s).filter((s) => !covered.has(s))).toEqual([]);
  });

  it('the push link shapes open these files', () => {
    expect(
      Object.fromEntries(
        SHAPES.map(([s]) => [s, routeFor(hrefFromUrl(s.replace('{id}', CQ))!)]),
      ),
    ).toEqual({
      'bonded://today': 'app/(tabs)/today/index',
      'bonded://question/{id}': 'app/question/[id]/index',
      'bonded://question/{id}/thread': 'app/question/[id]/thread',
      'bonded://packs': 'app/(tabs)/packs/index',
      'bonded://history/recap': 'app/(tabs)/history/recap',
      'bonded://subscription/offer': 'app/(offer)/subscription/offer',
    });
  });

  it('an unknown or foreign link never routes from a push', () => {
    for (const url of [
      'bonded://us/delete',
      'bonded://question/not-a-uuid',
      'https://example.com/today',
      'bonded://dev/gallery',
    ]) {
      expect(hrefFromUrl(url)).toBeNull();
    }
  });
});
