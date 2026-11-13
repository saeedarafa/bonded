// QA-08: unit checks of the privacy-check parsing (no browser). Run: node --test qa/web/privacy-check.unit.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import { gzipSync } from 'node:zlib';

import { bodyText, checkInitOptions, htmlHasPostHog, initOptionsText, PH_KEY, scriptSrcs } from './privacy-check.mjs';

const page = (opts) => `<html><script>!function(t,e){/* snippet */}(document,window.posthog||[]);
posthog.init('phc_xxxxxxxxxx', ${opts});</script></html>`;
const GOOD = `{ api_host: 'https://eu.i.posthog.com', cookieless_mode: 'always', disable_session_recording: true,
  before_send: (e) => { if (e) { e.properties = { ...e.properties }; } return e; }, person_profiles: 'never' }`;

test('a spec-conform init passes', () => {
  assert.deepEqual(checkInitOptions(initOptionsText(page(GOOD))), []);
});

test('nested braces in before_send do not cut the options short', () => {
  assert.match(initOptionsText(page(GOOD)), /person_profiles: 'never' }$/);
});

test('missing or wrong options fail', () => {
  assert.equal(checkInitOptions(initOptionsText(page(`{ cookieless_mode: 'always' }`))).length, 1);
  assert.equal(checkInitOptions(initOptionsText(page(`{ disable_session_recording: true }`))).length, 1);
  assert.equal(checkInitOptions(initOptionsText(page(`{ cookieless_mode: "on_reject", disable_session_recording: true }`))).length, 1);
  assert.ok(checkInitOptions(initOptionsText(page(`{ cookieless_mode: 'always', disable_session_recording: true, persistence: 'cookie' }`))).length);
  assert.deepEqual(checkInitOptions(null), ['no posthog.init({...}) call found']);
});

test('quoted keys (JSON-style config) pass', () => {
  assert.deepEqual(checkInitOptions(initOptionsText(page(`{"cookieless_mode":"always","disable_session_recording":true}`))), []);
});

test('ld+json mentioning posthog is not a PostHog load; a script is', () => {
  assert.equal(htmlHasPostHog('<script type="application/ld+json">{"x":"posthog"}</script>'), false);
  assert.equal(htmlHasPostHog('<script src="https://eu-assets.i.posthog.com/static/array.js"></script>'), true);
});

test('PostHog storage/cookie names', () => {
  for (const k of ['ph_phc_xxx_posthog', '__ph_opt_in_out_phc_x', 'ph_primary_window_exists']) assert.ok(PH_KEY.test(k), k);
  for (const k of ['theme', 'bonded_seen']) assert.ok(!PH_KEY.test(k), k);
});

test("the site's loader (ph.init in analytics.js) is parsed", () => {
  const js = `const KEY = 'phc_x'; ph = window.posthog; ph.init(KEY, { cookieless_mode: 'always', persistence: 'memory',
    disable_session_recording: true, before_send: sanitize, });`;
  assert.deepEqual(checkInitOptions(initOptionsText(js)), []);
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
