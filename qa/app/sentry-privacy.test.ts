// QA-08 (D54, RC PRIV-01), Sentry part: no answer or message text, names, emails, invite codes or
// tokens, key-date titles, feedback, push tokens or voice paths in a crash report.
//
// Every string in qa/fixtures/privacy-strings.json is put into every place a Sentry event or
// breadcrumb can carry it (user, request, message, logentry, exception values the way Postgres /
// PostgREST echo input, stack-frame vars, tags, extra, contexts incl. the device name, and every
// breadcrumb category: console, touch, ui.*, http/fetch/xhr, navigation, custom) and run through
// the app's real scrubbers as the SDK would call them: `crashReportOptions(...).beforeSend` and
// `.beforeBreadcrumb` (src/lib/crashReports.ts, MOB-24 #441). The serialised result must hold none
// of them. The SDK itself is never loaded.
//
// What a scrubber cannot know: plain free text (an answer, a name) under a neutral key or unquoted
// inside an exception message is indistinguishable from code text. Those are covered by the
// free-text key list (the realistic keys below) and by the rule that app code never builds error
// messages from content; strings with a shape (emails, codes, links, tokens, push tokens, paths
// in URLs) must go wherever they appear, so they are also placed under neutral keys.
import type { Breadcrumb, ErrorEvent } from '@sentry/react-native';

import { crashReportOptions } from '@/lib/crashReports';

import strings from '../fixtures/privacy-strings.json';

const { _meta, ...groups } = strings;
void _meta;
type Group = keyof typeof groups;

const CONTENT: { group: Group; text: string }[] = (Object.keys(groups) as Group[]).flatMap((group) =>
  groups[group].map((text) => ({ group, text })),
);

/** The key the app would really store each kind of content under (Supabase rows, RPC params). */
const REAL_KEYS: Record<Group, string[]> = {
  answers: ['answer', 'answer_text', 'body', 'text'],
  messages: ['message', 'body', 'content'],
  names: ['display_name', 'partner_name', 'first_name', 'name', 'couple_name', 'nickname'],
  emails: ['email', 'username'],
  invite_codes: ['code', 'p_code', 'invite_code'],
  invite_links: ['uri', 'query'],
  invite_tokens: ['token', 'p_token'],
  key_date_titles: ['title', 'key_date'],
  feedback: ['feedback', 'comment', 'note'],
  push_tokens: ['push_token', 'expo_push_token', 'token'],
  voice_paths: ['path', 'file', 'filename', 'uri'],
  error_messages: ['message', 'details', 'hint'],
};

const ANSWER = groups.answers[0] as string;

const DSN = 'https://public@o0.ingest.de.sentry.io/0';
const options = crashReportOptions(DSN, 'development');
const beforeSend = options.beforeSend as (e: ErrorEvent, hint: unknown) => ErrorEvent | null;
const beforeBreadcrumb = options.beforeBreadcrumb as (b: Breadcrumb, hint?: unknown) => Breadcrumb | null;

/** Distinctive pieces of a fixture string that must not survive (the whole string and its parts). */
function needles(text: string): string[] {
  const out = new Set<string>([text]);
  // Invite links: the code and the token on their own.
  for (const m of text.matchAll(/BND\d{4}|Qx9-FIXTURE_[A-Za-z0-9_-]+/g)) out.add(m[0]);
  // FIXTURE-tagged free text: the tag plus the next word is enough to identify a leak.
  for (const m of text.matchAll(/FIXTURE[-_A-Za-z0-9]*/g)) out.add(m[0]);
  // Emails also without the domain.
  for (const m of text.matchAll(/([A-Za-z0-9._%+-]+)@bonded\.test/g)) out.add(m[0]);
  return [...out].filter((n) => n.length >= 3);
}

/** The parts of a string that have a shape a scrubber can recognise (email, invite code, token, link). */
function shapedNeedles(text: string): string[] {
  const re = /[A-Za-z0-9._%+-]+@bonded\.test|BND\d{4}|Qx9-FIXTURE_[A-Za-z0-9_-]+|ExponentPushToken\[[^\]]*\]|FIXTURE-pushtoken-\d+/g;
  return [...text.matchAll(re)].map((m) => m[0]);
}

/** Where in a value a needle survives: `path: needle` strings (empty = clean). */
function leaks(value: unknown, texts: string[], pick: (t: string) => string[] = needles): string[] {
  const all = texts.flatMap(pick);
  const out: string[] = [];
  const walk = (v: unknown, path: string, depth: number): void => {
    if (depth > 12) return;
    if (typeof v === 'string') {
      for (const n of all) if (v.includes(n)) out.push(`${path}: ${n}`);
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, depth + 1));
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        for (const n of all) if (k.includes(n)) out.push(`${path}.<key ${k}>: ${n}`);
        walk(x, `${path}.${k}`, depth + 1);
      }
    }
  };
  walk(value, '$', 0);
  return out;
}

/** Postgres and PostgREST put input values into error messages in these shapes. */
function pgErrors(text: string): string[] {
  return [
    `invalid input syntax for type uuid: "${text}"`,
    `new row for relation "answers" violates check constraint "answers_body_check" Failing row contains (00000000-0000-4000-a000-000000000001, ${text}, 2031-03-16).`,
    `duplicate key value violates unique constraint "invites_code_key" Key (code)=(${text}) already exists.`,
    `value too long for type character varying(500): "${text}"`,
  ];
}

function breadcrumbsFor(group: Group, text: string): Breadcrumb[] {
  const data: Record<string, unknown> = {};
  for (const k of REAL_KEYS[group]) data[k] = text;
  const crumbs: Breadcrumb[] = [
    { category: 'console', level: 'log', message: text, data: { arguments: [text, { [REAL_KEYS[group][0] as string]: text }] } },
    { category: 'console', level: 'error', message: `Error: ${text}` },
    { category: 'touch', message: `Touch event within element: Text "${text}"`, data: { path: [{ name: 'Text', label: text }] } },
    { category: 'ui.click', message: text },
    { category: 'ui.input', message: text, data: { value: text } },
    {
      category: 'fetch',
      type: 'http',
      data: {
        method: 'POST',
        status_code: 400,
        url: `https://x.supabase.co/rest/v1/rpc/redeem_invite?p_code=${encodeURIComponent(text)}&t=${encodeURIComponent(text)}`,
        request_body: JSON.stringify(data),
        response_body: JSON.stringify({ code: '23514', details: `Failing row contains (${text}).`, message: text }),
        request_body_size: 120,
        headers: { authorization: `Bearer ${text}` },
      },
    },
    {
      category: 'xhr',
      type: 'http',
      data: { method: 'GET', status_code: 200, url: `https://x.supabase.co/rest/v1/answers?body=eq.${encodeURIComponent(text)}` },
    },
    {
      category: 'navigation',
      message: `Navigation to /j/${text}`,
      data: { from: `/question/1?answer=${encodeURIComponent(text)}`, to: `/j/BND4827?t=${encodeURIComponent(text)}`, params: data },
    },
    { category: 'supabase', message: text, data: { ...data, rpc: 'save_answer' } },
    { category: 'auth', message: `signed in as ${text}`, data: { email: text } },
  ];
  return crumbs;
}

function eventFor(group: Group, text: string): ErrorEvent {
  const data: Record<string, unknown> = {};
  for (const k of REAL_KEYS[group]) data[k] = text;
  const errors = pgErrors(text);
  return {
    type: undefined,
    event_id: 'qa08',
    level: 'error',
    environment: 'development',
    server_name: `${text}s-MacBook`,
    message: errors[0],
    logentry: { message: errors[1], params: [text] },
    transaction: `/j/BND4827?t=${encodeURIComponent(text)}`,
    user: { id: '00000000-0000-4000-a000-000000000001', email: text, username: text, ip_address: '203.0.113.7', name: text } as ErrorEvent['user'],
    request: {
      url: `bonded://j/BND4827?t=${encodeURIComponent(text)}&email=${encodeURIComponent(text)}`,
      method: 'POST',
      data: JSON.stringify(data),
      query_string: `t=${encodeURIComponent(text)}`,
      cookies: { sb: text },
      headers: { Authorization: `Bearer ${text}`, 'x-name': text },
      env: { REMOTE_ADDR: text },
    },
    exception: {
      values: errors.map((value, i) => ({
        type: i === 3 ? 'PostgrestError' : 'Error',
        value,
        stacktrace: {
          frames: [{ filename: 'app:///index.bundle', function: 'saveAnswer', lineno: 1, vars: { ...data, input: text } }],
        },
      })),
    },
    tags: { screen: '20', ...Object.fromEntries(REAL_KEYS[group].map((k) => [k, text])) },
    extra: { ...data, row: { ...data, nested: { ...data } }, list: [data] },
    contexts: {
      device: { name: `${text}'s iPhone`, device_name: text, model: 'iPhone16,2', family: 'iOS' },
      os: { name: 'iOS', version: '18.0' },
      app: { app_name: 'Bonded', app_version: '1.0.0' },
      answer: { text, body: text },
      supabase: { ...data, rpc: 'save_answer' },
    },
    breadcrumbs: breadcrumbsFor(group, text),
  };
}

describe('QA-08 Sentry: crash reports carry no personal content (beforeSend / beforeBreadcrumb)', () => {
  it('the fixture covers every privacy group the analytics suite uses', () => {
    expect(Object.keys(groups).sort()).toEqual(Object.keys(REAL_KEYS).sort());
    expect(CONTENT.length).toBeGreaterThanOrEqual(20);
  });

  it('every event carries the build profile as environment', () => {
    expect(crashReportOptions(DSN, 'production').environment).toBe('production');
    expect(options.environment).toBe('development');
  });

  it('the SDK options wire the scrubbers and drop transactions', () => {
    expect(typeof options.beforeSend).toBe('function');
    expect(typeof options.beforeBreadcrumb).toBe('function');
    expect(options.sendDefaultPii).toBe(false);
    expect(options.attachScreenshot).toBe(false);
    expect(options.attachViewHierarchy).toBe(false);
    expect((options.beforeSendTransaction as (t: unknown) => unknown)({ type: 'transaction' })).toBeNull();
  });

  describe.each(CONTENT)('$group: $text', ({ group, text }) => {
    it('beforeSend: no trace of it anywhere in the event', () => {
      const out = beforeSend(eventFor(group, text), { originalException: new Error(text) });
      expect(leaks(out, [text])).toEqual([]);
      // The event itself still goes out (the scrubber redacts, it does not drop crash reports).
      expect(out).not.toBeNull();
      expect(out?.user).toEqual({ id: '00000000-0000-4000-a000-000000000001' });
      expect(out?.exception?.values).toHaveLength(4);
    });

    it('beforeBreadcrumb: no trace of it in any breadcrumb the SDK would keep', () => {
      const kept = breadcrumbsFor(group, text)
        .map((b) => beforeBreadcrumb(b, { input: [text] }))
        .filter((b): b is Breadcrumb => b !== null);
      expect(leaks(kept, [text])).toEqual([]);
      // http crumbs keep method and status (useful) without the URL's query.
      const http = kept.find((b) => b.category === 'fetch');
      expect(http?.data).toMatchObject({ method: 'POST', status_code: 400 });
    });
  });

  /** The same string under keys a scrubber cannot know (a neutral `info`, a lifecycle message). */
  function neutralEvent(text: string): ErrorEvent {
    return {
      event_id: 'qa08n',
      type: undefined,
      message: `could not open ${text}`,
      exception: { values: [{ type: 'Error', value: `redeem failed for ${text} at ${new Date(0).toISOString()}` }] },
      tags: { last_link: text },
      extra: { info: `failed for ${text}`, raw: text, nested: { reason: text } },
      contexts: { supabase: { rpc: 'redeem_invite', info: text } },
      breadcrumbs: [
        { category: 'app.lifecycle', message: `resumed from ${text}`, data: { reason: text, link: text } },
        { category: 'custom', message: text, data: { info: `opened ${text}` } },
      ],
    };
  }

  it.each(CONTENT)('neutral keys: the email / code / token / link parts of "$text" still go', ({ text }) => {
    const out = beforeSend(neutralEvent(text), {});
    const crumbs = neutralEvent(text).breadcrumbs!.map((b) => beforeBreadcrumb(b));
    expect(leaks([out, crumbs], [text], shapedNeedles)).toEqual([]);
  });

  // Former gaps (issue #444, fixed in #441): JSON-escaped text in exception messages and nested
  // values inside SDK contexts are scrubbed.
  it('a JSON-stringified PostgREST error (escaped quotes) in an exception message is scrubbed', () => {
    const text = ANSWER;
    const value = `save failed: ${JSON.stringify({ code: '22001', message: `value "${text}" too long` })}`;
    const out = beforeSend({ event_id: 'g1', type: undefined, exception: { values: [{ type: 'Error', value }] } }, {});
    expect(leaks(out, [text])).toEqual([]);
  });

  it('nested values inside an SDK context (e.g. the Redux `state` context) are scrubbed', () => {
    const text = ANSWER;
    const out = beforeSend(
      { event_id: 'g2', type: undefined, contexts: { state: { state: { type: 'redux', value: { draft: { answer: text } } } } } },
      {},
    );
    expect(leaks(out, [text])).toEqual([]);
  });

  it('every string at once in one event (as a long session would collect them)', () => {
    const all = CONTENT.map((c) => eventFor(c.group, c.text));
    const merged: ErrorEvent = {
      ...(all[0] as ErrorEvent),
      extra: Object.assign({}, ...all.map((e) => e.extra)),
      breadcrumbs: all.flatMap((e) => e.breadcrumbs ?? []),
      exception: { values: all.flatMap((e) => e.exception?.values ?? []) },
    };
    expect(leaks(beforeSend(merged, {}), CONTENT.map((c) => c.text))).toEqual([]);
  });

  it('the check itself finds a leak (an unscrubbed event fails)', () => {
    const raw = eventFor('answers', ANSWER);
    expect(leaks(raw, [ANSWER]).length).toBeGreaterThan(0);
  });
});
