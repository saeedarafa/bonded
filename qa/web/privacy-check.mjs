// QA-08 (website part) / QA-54 item 8: PostHog privacy check of the website (ANALYTICS §5,
// SEC-23-replay B). Opens a base URL in headless Chromium (Playwright from qa/web) and asserts:
//   /j/* (invite links carry tokens): no PostHog script in the HTML, no request to a PostHog host;
//   /    : PostHog is there, its init config has `disable_session_recording: true` and
//          `cookieless_mode: 'always'` (in the HTML source and, when readable, in window.posthog.config);
//          no Set-Cookie on any response, no `ph_` / posthog cookie, no `ph_` / posthog key in
//          localStorage or sessionStorage; no replay request (`/s/` or a `$snapshot` event).
// PostHog ingestion requests (events, flags, replay) are recorded and then ABORTED, so a run against
// production sends nothing to the shared project; only the SDK script itself loads.
//
// Usage (qa/web deps installed: npm --prefix qa/web ci && (cd qa/web && npx playwright install chromium)):
//   node qa/web/privacy-check.mjs https://hellobonded.com
//   node qa/web/serve.mjs 4173 & node qa/web/privacy-check.mjs http://127.0.0.1:4173
//   node qa/web/privacy-check.mjs <url> --j-only     (only the /j/* half, e.g. before the site PR)
// Exit 0 = all checks pass, 1 = a check failed (each failure printed), 2 = usage / browser error.
// Not wired into CI yet: the site PostHog PR (LEAD-04 site analytics) is not on main. Written against
// ANALYTICS §5 and SEC-23-replay B; re-read the parsing below against web/ when that PR lands.
import { chromium } from '@playwright/test';

/** PostHog hosts (EU project, plus the generic ones a misconfigured init would use). */
export const POSTHOG_HOST = /(^|\.)posthog\.com$/i;
/** SDK asset paths that may load on `/` (everything else on a PostHog host is ingestion). */
const ASSET_PATH = /^\/(static\/|array\/|.*\.js$)/;
/** Replay ingestion: `/s/` endpoint or a `$snapshot` event in a body or query. */
const REPLAY = (url, body) => /^\/s\/?$/.test(new URL(url).pathname) || /\$snapshot/.test(`${url} ${body ?? ''}`);
/** A storage key or cookie name that PostHog writes (ph_<token>_posthog, ph_*, __ph_opt_in_out_*). */
export const PH_KEY = /^(ph_|__ph_|_ph_)|posthog/i;

/**
 * The PostHog init options as written in the page source: the object literal passed to
 * `posthog.init('<key>', { ... })`. Returns the raw text, or null when there is no init call.
 */
export function initOptionsText(html) {
  const at = html.search(/posthog\.init\s*\(/);
  if (at < 0) return null;
  const open = html.indexOf('{', at);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < html.length; i++) {
    const ch = html[i];
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return html.slice(open, i + 1);
  }
  return null;
}

/** Static checks on the init options text; returns failure strings (empty = ok). */
export function checkInitOptions(text) {
  if (!text) return ['no posthog.init({...}) call found in the HTML of /'];
  const fails = [];
  const opt = (name, value) => new RegExp(`["']?${name}["']?\\s*:\\s*${value}`).test(text);
  if (!opt('disable_session_recording', 'true')) fails.push('init: disable_session_recording is not `true`');
  if (!opt('cookieless_mode', `["']always["']`)) fails.push("init: cookieless_mode is not 'always'");
  if (opt('disable_session_recording', 'false')) fails.push('init: disable_session_recording: false present');
  if (/["']?persistence["']?\s*:\s*["'](cookie|localStorage\+cookie)["']/.test(text)) {
    fails.push('init: persistence uses cookies');
  }
  return fails;
}

/** True when the HTML loads or inlines PostHog. */
export function htmlHasPostHog(html) {
  return /posthog/i.test(html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, ''));
}

async function visit(context, url) {
  const page = await context.newPage();
  const requests = [];
  const setCookies = [];
  await page.route('**/*', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (POSTHOG_HOST.test(u.hostname)) {
      requests.push({ url: req.url(), body: req.postData() ?? '' });
      if (!ASSET_PATH.test(u.pathname)) return route.abort();
    }
    return route.continue();
  });
  page.on('response', async (res) => {
    const h = await res.allHeaders().catch(() => ({}));
    if (h['set-cookie']) setCookies.push(`${res.url()}: ${h['set-cookie'].split('=')[0]}=…`);
  });
  const res = await page.goto(url, { waitUntil: 'load' });
  const html = res ? await res.text() : '';
  // Give the SDK time to boot and flush its first batch (pageview), then scroll for page leave/heatmap.
  await page.waitForTimeout(2500);
  await page.mouse.wheel(0, 2000).catch(() => {});
  await page.waitForTimeout(1500);
  const storage = await page.evaluate(() => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
    config: (() => {
      const c = window.posthog?.config;
      return c ? { disable_session_recording: c.disable_session_recording, cookieless_mode: c.cookieless_mode } : null;
    })(),
  }));
  const cookies = (await context.cookies()).map((c) => c.name);
  await page.close();
  return { html, requests, setCookies, storage, cookies };
}

export async function run(base, { jOnly = false } = {}) {
  const fails = [];
  const browser = await chromium.launch();
  try {
    // /j/*: a fresh context per URL so nothing from / leaks in.
    for (const path of ['/j/', '/j/BND4827?t=QA08tokenXXXXXXXXXXXX']) {
      const context = await browser.newContext();
      const r = await visit(context, new URL(path, base).href);
      if (htmlHasPostHog(r.html)) fails.push(`${path}: the HTML mentions posthog (must never load on /j/*)`);
      for (const q of r.requests) fails.push(`${path}: request to PostHog ${q.url.split('?')[0]}`);
      if (r.storage.config) fails.push(`${path}: window.posthog is initialised`);
      for (const k of [...r.storage.local, ...r.storage.session].filter((k) => PH_KEY.test(k))) {
        fails.push(`${path}: PostHog storage key ${k}`);
      }
      await context.close();
    }
    if (!jOnly) {
      const context = await browser.newContext();
      const r = await visit(context, new URL('/', base).href);
      if (!htmlHasPostHog(r.html)) fails.push('/: PostHog not found in the HTML (site analytics not deployed?)');
      else fails.push(...checkInitOptions(initOptionsText(r.html)).map((f) => `/: ${f}`));
      if (r.storage.config) {
        if (r.storage.config.disable_session_recording !== true) fails.push('/: runtime config disable_session_recording !== true');
        if (r.storage.config.cookieless_mode !== 'always') fails.push(`/: runtime config cookieless_mode = ${r.storage.config.cookieless_mode}`);
      }
      for (const c of r.setCookies) fails.push(`/: Set-Cookie on ${c}`);
      for (const c of r.cookies.filter((n) => PH_KEY.test(n))) fails.push(`/: PostHog cookie ${c}`);
      for (const k of [...r.storage.local, ...r.storage.session].filter((k) => PH_KEY.test(k))) {
        fails.push(`/: PostHog storage key ${k}`);
      }
      for (const q of r.requests.filter((q) => REPLAY(q.url, q.body))) fails.push(`/: replay request ${q.url.split('?')[0]}`);
      console.log(`/: ${r.requests.length} PostHog request(s) seen (ingestion aborted), cookies [${r.cookies.join(', ')}]`);
    }
  } finally {
    await browser.close();
  }
  return fails;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const base = args.find((a) => !a.startsWith('--'));
  if (!base || !/^https?:\/\//.test(base)) {
    console.error('usage: node qa/web/privacy-check.mjs <base-url> [--j-only]');
    process.exit(2);
  }
  try {
    const fails = await run(base, { jOnly: args.includes('--j-only') });
    for (const f of fails) console.log(`FAIL ${f}`);
    console.log(fails.length ? `web privacy: ${fails.length} failure(s)` : 'web privacy: ok');
    process.exit(fails.length ? 1 : 0);
  } catch (e) {
    console.error(`web privacy: error ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  }
}
