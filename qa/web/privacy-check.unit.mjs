// QA-08: unit checks of the privacy-check parsing (no browser). Run: node --test qa/web/privacy-check.unit.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import { gzipSync } from 'node:zlib';

import { bodyText, checkInitOptions, expandText, htmlHasPostHog, initOptionsText, isRecorder, isReplay, PH_KEY, pluginEvents, scriptSrcs } from './privacy-check.mjs';

const page = (opts) => `<html><script>!function(t,e){/* snippet */}(document,window.posthog||[]);
posthog.init('phc_xxxxxxxxxx', ${opts});</script></html>`;
// ANALYTICS §5 with the cookie banner (PO 2026-11-14, D64).
const GOOD = `{ api_host: 'https://eu.i.posthog.com', cookieless_mode: 'on_reject', opt_out_capturing_by_default: true,
  consent_persistence_name: 'bonded_consent', persistence: 'localStorage+cookie', person_profiles: 'never',
  autocapture: { capture_copied_text: false }, capture_performance: { web_vitals: true, network_timing: false },
  disable_session_recording: false, enable_recording_console_log: false,
  session_recording: { maskAllInputs: true, recordHeaders: false, recordBody: false },
  before_send: (e) => { if (e) { e.properties = { ...e.properties }; } return e; }, save_referrer: true }`;
const without = (re, by = '') => GOOD.replace(re, by);

test('a spec-conform init passes', () => {
  assert.deepEqual(checkInitOptions(initOptionsText(page(GOOD))), []);
});

test('nested braces in before_send do not cut the options short', () => {
  assert.match(initOptionsText(page(GOOD)), /save_referrer: true }$/);
});

test('each missing or wrong consent / replay option fails on its own', () => {
  const one = (opts, re) => {
    const f = checkInitOptions(initOptionsText(page(opts)));
    assert.equal(f.length >= 1, true, opts);
    assert.ok(f.some((x) => re.test(x)), f.join('; '));
  };
  one(without("cookieless_mode: 'on_reject'", "cookieless_mode: 'always'"), /cookieless_mode/);
  one(without('opt_out_capturing_by_default: true', 'opt_out_capturing_by_default: false'), /opt_out_capturing_by_default/);
  one(without("consent_persistence_name: 'bonded_consent',"), /consent_persistence_name/);
  one(without("person_profiles: 'never'", "person_profiles: 'identified_only'"), /person_profiles/);
  one(without('maskAllInputs: true', 'maskAllInputs: false'), /maskAllInputs/);
  one(without('enable_recording_console_log: false', 'enable_recording_console_log: true'), /console_log/);
  one(without('recordHeaders: false', 'recordHeaders: true'), /recordHeaders/);
  one(without('recordBody: false', 'recordBody: true'), /recordBody/);
  one(without('network_timing: false', 'network_timing: true'), /network_timing/);
  one(without('capture_copied_text: false', 'capture_copied_text: true'), /capture_copied_text/);
  one(without(/before_send: \(e\) => \{.*?return e; \},/s), /before_send/);
  assert.deepEqual(checkInitOptions(null), ['no posthog.init({...}) call found']);
});

test('the old cookieless-only config (no banner) fails', () => {
  const old = `{ cookieless_mode: 'always', disable_session_recording: true, before_send: sanitize }`;
  assert.ok(checkInitOptions(initOptionsText(page(old))).length >= 5);
});

test('quoted keys (JSON-style config) pass', () => {
  const json = `{"cookieless_mode":"on_reject","opt_out_capturing_by_default":true,"consent_persistence_name":"bonded_consent",
    "person_profiles":"never","enable_recording_console_log":false,"capture_performance":{"network_timing":false},
    "session_recording":{"maskAllInputs":true,"recordHeaders":false,"recordBody":false},"before_send":null}`;
  assert.deepEqual(checkInitOptions(initOptionsText(page(json))), []);
});

test('ld+json mentioning posthog is not a PostHog load; a script is', () => {
  assert.equal(htmlHasPostHog('<script type="application/ld+json">{"x":"posthog"}</script>'), false);
  assert.equal(htmlHasPostHog('<script src="https://eu-assets.i.posthog.com/static/array.js"></script>'), true);
});

test('PostHog storage/cookie names', () => {
  for (const k of ['ph_phc_xxx_posthog', '__ph_opt_in_out_phc_x', 'ph_primary_window_exists']) assert.ok(PH_KEY.test(k), k);
  for (const k of ['theme', 'bonded_seen']) assert.ok(!PH_KEY.test(k), k);
});

test("the site's loader (window.posthog.init in analytics.js, consent key in a const) is parsed", () => {
  const opts = GOOD.replace("consent_persistence_name: 'bonded_consent'", 'consent_persistence_name: CONSENT_KEY');
  const js = `const KEY = 'phc_x'; const CONSENT_KEY = 'bonded_consent'; window.posthog.init(KEY, ${opts});`;
  assert.deepEqual(checkInitOptions(initOptionsText(js), js), []);
  const wrong = js.replace("CONSENT_KEY = 'bonded_consent'", "CONSENT_KEY = 'other'");
  assert.equal(checkInitOptions(initOptionsText(wrong), wrong).length, 1);
});

test('a script tag for /assets/analytics.js counts as PostHog; same-origin srcs are listed', () => {
  const html = '<script src="/assets/site.js" defer></script><script src="/assets/analytics.js" defer></script><script src="https://cdn.example/x.js"></script>';
  assert.equal(htmlHasPostHog(html), true);
  assert.equal(htmlHasPostHog('<script src="/assets/invite.js"></script>'), false);
  assert.deepEqual(scriptSrcs(html, 'http://127.0.0.1:1/'), ['http://127.0.0.1:1/assets/site.js', 'http://127.0.0.1:1/assets/analytics.js']);
});

test('event bodies are decoded: gzip, base64 data= form and plain JSON', () => {
  const json = '{"event":"$pageview","properties":{"$current_url":"https://x/?t=abc"}}';
  assert.equal(bodyText(gzipSync(json)), json);
  assert.equal(bodyText(Buffer.from(`data=${encodeURIComponent(Buffer.from(json).toString('base64'))}&compression=base64`)), json);
  assert.equal(bodyText(Buffer.from(json)), json);
  assert.equal(bodyText(null), '');
});

test('recorder bundles and replay requests are recognised', () => {
  for (const f of ['lazy-recorder.js', 'posthog-recorder.js', 'recorder.js', 'recorder-v2.js']) {
    assert.ok(isRecorder(`https://eu-assets.i.posthog.com/static/1.448.0/${f}`), f);
  }
  assert.ok(!isRecorder('https://eu-assets.i.posthog.com/static/1.448.0/dead-clicks-autocapture.js'));
  assert.ok(isReplay('https://eu.i.posthog.com/s/?ver=1', ''));
  assert.ok(isReplay('https://eu.i.posthog.com/e/', '[{"event":"$snapshot"}]'));
  assert.ok(!isReplay('https://eu.i.posthog.com/e/', '[{"event":"$pageview"}]'));
});

test('gzip strings inside replay JSON (cv 2024-10) are expanded', () => {
  const inner = JSON.stringify({ texts: [{ value: 'QA08visibleCONTROLzz' }] });
  const packed = gzipSync(inner).toString('latin1');
  const body = JSON.stringify([{ event: '$snapshot', properties: { $snapshot_data: [{ type: 3, cv: '2024-10', data: { texts: packed } }] } }]);
  assert.ok(!body.includes('QA08visibleCONTROLzz'));
  assert.ok(expandText(body).includes('QA08visibleCONTROLzz'));
  assert.equal(expandText('not json'), 'not json');
});

test('rrweb plugin events: SDK warnings allowed, page console and network not', () => {
  const ev = (plugin, payload) => `{"type":6,"data":{"plugin":"${plugin}","payload":${JSON.stringify(payload)}},"timestamp":1}`;
  const sdk = ev('rrweb/console@1', { level: 'warn', trace: [], payload: ['"[SessionRecording] Too many mutations on node \'255\'. Rate limiting."'] });
  assert.deepEqual(pluginEvents(`[${sdk}]`), { bad: [], sdk: 1 });
  const page = ev('rrweb/console@1', { level: 'log', trace: [], payload: ['"QA08consoleFIXTUREzz {}"'] });
  assert.equal(pluginEvents(`[${sdk},${page}]`).bad.length, 1);
  const net = ev('rrweb/network@1', { requests: [{ name: 'https://x/' }] });
  assert.deepEqual(pluginEvents(`[${net}]`).bad, ['network plugin event']);
  assert.deepEqual(pluginEvents('[]'), { bad: [], sdk: 0 });
});
