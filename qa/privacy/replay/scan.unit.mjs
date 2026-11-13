// QA-54: unit checks of the replay payload scanner (no device). Run: node --test qa/privacy/replay/scan.unit.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

import { checkOcr, decodeBody, eventsOf, fixtureStrings, scan, windowsFrom } from './scan.mjs';

const T0 = Date.parse('2031-03-16T10:00:00Z');
const PNG = `data:image/png;base64,${Buffer.alloc(3000, 7).toString('base64')}`;
const rr = (type, data, at = T0) => ({ type, data, timestamp: at });
const snap = (data, session = 's1') => ({ event: '$snapshot', properties: { $session_id: session, $snapshot_data: data } });
const frame = (at = T0, href = 'question/[id]') => [
  rr(4, { href, width: 430, height: 932 }, at),
  rr(2, { wireframes: [{ id: 1, type: 'screenshot', base64: PNG, width: 430, height: 932 }] }, at),
];
const req = (events, path = '/s/') => ({ path, text: JSON.stringify(events) });

test('fixture file loads every list, not _meta', () => {
  const s = fixtureStrings();
  assert.ok(s.includes('Maya') && s.some((x) => x.startsWith('FIXTURE-ANSWER')));
  assert.ok(!s.some((x) => x.includes('privacy-strings')));
});

test('decodes gzip by header and by magic bytes, and data=<base64> forms', () => {
  const json = '[{"event":"x"}]';
  assert.equal(decodeBody(gzipSync(json), { 'content-encoding': 'gzip' }), json);
  assert.equal(decodeBody(gzipSync(json), {}), json);
  assert.equal(decodeBody(`data=${encodeURIComponent(Buffer.from(json).toString('base64'))}`), json);
  assert.equal(decodeBody(`data=${encodeURIComponent(gzipSync(json).toString('base64'))}&compression=gzip-js`), json);
  assert.deepEqual(eventsOf('{"batch":[{"event":"a"},{"event":"b"}]}').map((e) => e.event), ['a', 'b']);
  assert.deepEqual(eventsOf('not json'), []);
});

test('a clean screenshot-only replay passes and its frames are extracted', () => {
  const res = scan([req([snap(frame())])]);
  assert.deepEqual(res.violations, []);
  assert.equal(res.frames.length, 1);
  assert.equal(res.frames[0].screen, 'question/[id]');
  assert.deepEqual(res.stats.screens, ['question/[id]']);
});

test('image data is not grepped (random base64 may contain "Sam")', () => {
  const fake = `data:image/jpeg;base64,${'AAAASamAAAA'.repeat(400)}`;
  const res = scan([req([snap([rr(2, { wireframes: [{ type: 'screenshot', base64: fake }] })])])]);
  assert.deepEqual(res.violations, []);
});

test('fixture text in a wireframe, an event property or a URL fails', () => {
  const wf = snap([rr(2, { wireframes: [{ type: 'text', text: 'FIXTURE-ANSWER I felt closest to you on the night train to Vienna' }] })]);
  const ev = { event: 'answer_submitted', properties: { note: 'hi Maya' } };
  const res = scan([req([wf, ev]), { path: '/batch/?code=BND4827', text: '' }]);
  assert.deepEqual(res.violations.map((v) => v.fixture).sort(), ['BND4827', 'FIXTURE-ANSWER I felt closest to you on the night train to Vienna', 'Maya']);
});

test('short names only match as whole words', () => {
  const ev = { event: 'x', properties: { a: 'Samsung Mayan sample' } };
  assert.deepEqual(scan([req([ev])]).violations, []);
});

test('console and network plugin events, $network_requests and captured bodies fail', () => {
  const res = scan([req([
    snap([rr(6, { plugin: 'rrweb/console@1', payload: { level: 'log', payload: ['x'] } })]),
    snap([rr(6, { plugin: 'rrweb/network@1', payload: { requests: [{ name: 'https://x', responseBody: '{}' }] } })]),
    { event: '$screen', properties: { $network_requests: [] } },
  ])]);
  assert.deepEqual(res.violations.map((v) => v.check).sort(), ['console', 'network', 'network', 'network']);
});

test('quiet window ("Share usage data" off): any replay event inside fails, outside passes', () => {
  const marks = [
    { kind: 'quiet', edge: 'start', label: 'opted out', at: T0 },
    { kind: 'quiet', edge: 'end', label: 'opted out', at: T0 + 60_000 },
  ];
  assert.deepEqual(scan([req([snap(frame(T0 + 1000))])], { marks }).violations, [], 'inside the 2 s grace');
  assert.deepEqual(scan([req([snap(frame(T0 + 61_000))])], { marks }).violations, []);
  const bad = scan([req([snap(frame(T0 + 30_000))])], { marks }).violations;
  assert.equal(bad.length, 2);
  assert.ok(bad.every((v) => v.check === 'quiet'));
});

test('masked window tags frames; OCR text there fails, fixture OCR fails anywhere', () => {
  const marks = [
    { kind: 'masked', edge: 'start', label: '21 reveal', at: T0 },
    { kind: 'masked', edge: 'end', label: '21 reveal', at: T0 + 10_000 },
  ];
  assert.equal(windowsFrom(marks)[0].from, T0 + 2000);
  const res = scan([req([snap(frame(T0 + 5000)), snap(frame(T0 + 20_000, '(auth)/sign-in'))])], { marks });
  assert.deepEqual(res.frames.map((f) => f.window), ['21 reveal', null]);
  res.frames.forEach((f, i) => { f.file = `${i}.png`; });
  assert.deepEqual(checkOcr(res.frames, { '0.png': [], '1.png': ['Sign in', 'Email'] }), []);
  const v = checkOcr(res.frames, { '0.png': ['9:41'], '1.png': ['Hi Sam'] });
  assert.deepEqual(v.map((x) => x.fixture ?? x.text), ['1 line(s) recognised', 'Sam']);
  // Fails closed: a frame OCR could not read, or did not see, is a violation, not a pass.
  assert.equal(checkOcr(res.frames, { '0.png': ['<ocr error: x>'], '1.png': [] }).length, 1);
  assert.equal(checkOcr(res.frames, { '1.png': [] }).length, 1);
});
