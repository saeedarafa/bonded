// QA-08 (website part) / QA-54 item 8: PostHog privacy check of the website (ANALYTICS §5,
// SEC-23-replay B). Opens a base URL in headless Chromium (Playwright from qa/web).
//
// The site (LEAD-04) loads PostHog from /assets/analytics.js, which loads the pinned self-hosted SDK
// /assets/vendor/posthog-js-<v>.js and calls posthog.init(KEY, {...}). KEY is injected at deploy time
// (web-deploy.yml); while analytics.js still holds the placeholder `__POSTHOG_PUBLIC_KEY__` the site
// runs WITHOUT analytics ("off"). The check detects the mode from analytics.js:
//   always, /j/ and /j/<code>?t=<token>: no PostHog or analytics.js in the HTML, no request to
//          analytics.js, the SDK or a PostHog host, no window.posthog, no ph_/posthog storage key.
//   / off: no SDK request, no PostHog host request, no window.posthog (and `--require-on` fails).
//   / on : init options (in analytics.js) have disable_session_recording: true, cookieless_mode:
//          'always', no cookie persistence, a before_send hook; runtime config agrees; the SDK sends
//          at least one event (pageview); no Set-Cookie, no ph_/posthog cookie or storage key, no
//          replay request (`/s/`, `$snapshot`); the page is opened with a token, an email and a
//          utm_source in the query and none of the token/email reaches an event body (utm_ may).
// EVERY request to a PostHog host (ingestion and the eu-assets lazy extensions) is recorded and
// ABORTED, and so is any other off-origin request: the check sends nothing to PostHog and needs no
// network for a local served copy.
//
// Usage (qa/web deps installed: npm --prefix qa/web ci && (cd qa/web && npx playwright install chromium)):
//   node qa/web/privacy-check.mjs https://hellobonded.com                 (live: any mode)
//   node qa/web/privacy-check.mjs http://127.0.0.1:4173 --require-on      (CI: key injected copy)
//   node qa/web/privacy-check.mjs <url> --j-only                          (only the /j/* half)
// Exit 0 = all checks pass, 1 = a check failed (each failure printed), 2 = usage / browser error.
import { gunzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';

/** PostHog hosts (EU project, plus the generic ones a misconfigured init would use). */
export const POSTHOG_HOST = /(^|\.)posthog\.com$/i;
/** Same-origin PostHog files: the site loader and the self-hosted SDK. */
export const SITE_PH_FILE = /^\/assets\/(analytics\.js|vendor\/posthog)/i;
/** Lazy SDK assets on a PostHog host (aborted too, but not ingestion). */
const ASSET_PATH = /^\/(static\/|array\/)|\.js$/;
/** Replay ingestion: `/s/` endpoint or a `$snapshot` event in a body or query. */
const REPLAY = (url, body) => /^\/s\/?$/.test(new URL(url).pathname) || /\$snapshot/.test(`${url} ${body ?? ''}`);
/** A storage key or cookie name that PostHog writes (ph_<token>_posthog, ph_*, __ph_opt_in_out_*). */
export const PH_KEY = /^(ph_|__ph_|_ph_)|posthog/i;
/** analytics.js before the deploy step injected a key. */
export const KEY_PLACEHOLDER = '__POSTHOG_PUBLIC_KEY__';
/** Values put in the query of `/` that must never reach PostHog. */
export const SECRET_TOKEN = 'QA08tokenSECRETzz';
export const SECRET_EMAIL = 'qa08.secret@example.com';

/**
 * The PostHog init options as written in a source: the object literal passed to
 * `posthog.init(<key>, { ... })` or `ph.init(KEY, { ... })`. Returns the raw text, or null.
 */
export function initOptionsText(src) {
  const at = src.search(/(posthog|\bph)\.init\s*\(/);
  if (at < 0) return null;
  const open = src.indexOf('{', at);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return src.slice(open, i + 1);
  }
  return null;
}

/** Static checks on the init options text; returns failure strings (empty = ok). */
export function checkInitOptions(text) {
  if (!text) return ['no posthog.init({...}) call found'];
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

/** True when the HTML loads or inlines PostHog (directly or through the site's analytics.js). */
export function htmlHasPostHog(html) {
  const code = html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '');
  return /posthog|\/assets\/analytics\.js/i.test(code);
}

/** Same-origin script srcs of a page. */
export function scriptSrcs(html, base) {
  const out = [];
  for (const m of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    const u = new URL(m[1], base);
    if (u.origin === new URL(base).origin) out.push(u.href);
  }
  return out;
}

/** Text of an ingestion request body: gzip, base64 `data=` form or plain. */
export function bodyText(buf) {
  if (!buf || !buf.length) return '';
  try { return gunzipSync(buf).toString('utf8'); } catch { /* not gzip */ }
  const s = buf.toString('utf8');
  const m = /(?:^|&)data=([^&]*)/.exec(s);
  if (m) {
    try { return Buffer.from(decodeURIComponent(m[1]), 'base64').toString('utf8'); } catch { /* fall through */ }
  }
  return s;
}

async function visit(context, url) {
  const page = await context.newPage();
  const origin = new URL(url).origin;
  const requests = []; // PostHog host requests (all aborted)
  const siteFiles = []; // same-origin analytics.js / SDK requests
  const setCookies = [];
  await page.route('**/*', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (POSTHOG_HOST.test(u.hostname)) {
      requests.push({ url: req.url(), asset: ASSET_PATH.test(u.pathname), body: bodyText(req.postDataBuffer()) });
      return route.abort();
    }
    if (u.origin !== origin) return route.abort(); // nothing else off-origin either
    if (SITE_PH_FILE.test(u.pathname)) siteFiles.push(u.pathname);
    return route.continue();
  });
  page.on('response', async (res) => {
    const h = await res.allHeaders().catch(() => ({}));
    if (h['set-cookie']) setCookies.push(`${res.url().split('?')[0]}: ${h['set-cookie'].split('=')[0]}=…`);
  });
  const res = await page.goto(url, { waitUntil: 'load' });
  const html = res ? await res.text() : '';
  // analytics.js starts PostHog after `load`; give the SDK time to boot and flush (pageview), then
  // scroll (section_viewed, heatmap data) and wait for the next flush.
  await page.waitForTimeout(3000);
  await page.mouse.wheel(0, 2500).catch(() => {});
  await page.waitForTimeout(3500);
  const storage = await page.evaluate(() => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
    config: (() => {
      const c = window.posthog?.config;
      return c
        ? { disable_session_recording: c.disable_session_recording, cookieless_mode: c.cookieless_mode, persistence: c.persistence }
        : null;
    })(),
  }));
  const cookies = (await context.cookies()).map((c) => c.name);
  await page.close();
  return { html, requests, siteFiles, setCookies, storage, cookies };
}

/** Same-origin script sources of a page except the vendored SDK (analytics.js holds the init call). */
async function sources(context, base, html) {
  const out = [];
  for (const src of scriptSrcs(html, base)) {
    if (/\/vendor\//.test(src)) continue;
    const r = await context.request.get(src).catch(() => null);
    if (r && r.ok()) out.push({ src: new URL(src).pathname, text: await r.text() });
  }
  return out;
}

export async function run(base, { jOnly = false, requireOn = false } = {}) {
  const fails = [];
  const notes = [];
  // posthog-js drops events as a bot when navigator.webdriver is true or the user agent says
  // "HeadlessChrome": present as regular Chrome so the SDK really builds and sends its events (which
  // are then aborted and inspected). The site's own config is not touched.
  const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  const probe = await browser.newPage();
  const userAgent = (await probe.evaluate(() => navigator.userAgent)).replace('HeadlessChrome', 'Chrome');
  await probe.close();
  const newContext = async () => {
    const context = await browser.newContext({ userAgent });
    // userAgentData.brands still lists "HeadlessChrome": hide it the same way.
    await context.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
      Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined });
    });
    return context;
  };
  try {
    // /j/*: a fresh context per URL so nothing from / leaks in.
    for (const path of ['/j/', '/j/BND4827?t=QA08tokenXXXXXXXXXXXX']) {
      const context = await newContext();
      const r = await visit(context, new URL(path, base).href);
      if (!r.html) fails.push(`${path}: empty response`);
      if (htmlHasPostHog(r.html)) fails.push(`${path}: the HTML mentions posthog or analytics.js (must never load on /j/*)`);
      for (const f of r.siteFiles) fails.push(`${path}: loads ${f}`);
      for (const q of r.requests) fails.push(`${path}: request to PostHog ${q.url.split('?')[0]}`);
      if (r.storage.config) fails.push(`${path}: window.posthog is initialised`);
      for (const k of [...r.storage.local, ...r.storage.session].filter((k) => PH_KEY.test(k))) {
        fails.push(`${path}: PostHog storage key ${k}`);
      }
      await context.close();
    }
    if (!jOnly) {
      const context = await newContext();
      const query = `/?t=${SECRET_TOKEN}&email=${encodeURIComponent(SECRET_EMAIL)}&utm_source=qa08#${SECRET_TOKEN}`;
      const r = await visit(context, new URL(query, base).href);
      const srcs = await sources(context, base, r.html);
      const loader = srcs.find((s) => /(posthog|\bph)\.init\s*\(/.test(s.text)) ?? srcs.find((s) => /analytics\.js$/.test(s.src));
      const inline = /posthog\.init\s*\(/.test(r.html) ? r.html : null;
      const code = inline ?? loader?.text ?? null;
      const on = Boolean(code) && !code.includes(KEY_PLACEHOLDER);
      const ingest = r.requests.filter((q) => !q.asset);
      if (!htmlHasPostHog(r.html)) {
        notes.push('/: no PostHog loader in the HTML');
        if (requireOn) fails.push('/: PostHog not found in the HTML (site analytics not built?)');
      } else if (!on) {
        notes.push(`/: analytics OFF (${loader?.src ?? 'the loader'} still holds ${KEY_PLACEHOLDER}: no key injected)`);
        if (requireOn) fails.push('/: analytics off but --require-on (key not injected)');
        for (const f of r.siteFiles.filter((f) => /vendor/.test(f))) fails.push(`/: analytics off but the SDK loaded (${f})`);
        for (const q of r.requests) fails.push(`/: analytics off but a request to PostHog ${q.url.split('?')[0]}`);
        if (r.storage.config) fails.push('/: analytics off but window.posthog is initialised');
      } else {
        const opts = initOptionsText(code);
        notes.push(`/: analytics ON (init in ${inline ? 'the HTML' : loader.src})`);
        fails.push(...checkInitOptions(opts).map((f) => `/: ${f}`));
        if (opts && !/before_send|sanitize_properties/.test(opts)) fails.push('/: init has no before_send / sanitize_properties URL strip');
        if (!r.storage.config) fails.push('/: key injected but window.posthog never initialised');
        else {
          if (r.storage.config.disable_session_recording !== true) fails.push('/: runtime config disable_session_recording !== true');
          if (r.storage.config.cookieless_mode !== 'always') fails.push(`/: runtime config cookieless_mode = ${r.storage.config.cookieless_mode}`);
          if (/cookie/.test(String(r.storage.config.persistence))) fails.push(`/: runtime persistence = ${r.storage.config.persistence}`);
        }
        if (!ingest.length) fails.push('/: key injected but no event reached the network layer (nothing to inspect)');
        for (const q of ingest) {
          const all = `${q.url} ${q.body}`;
          for (const s of [SECRET_TOKEN, SECRET_EMAIL, encodeURIComponent(SECRET_EMAIL)]) {
            if (all.includes(s)) fails.push(`/: ${s === SECRET_TOKEN ? 'query token' : 'query email'} sent to PostHog in ${new URL(q.url).pathname}`);
          }
        }
        const bodies = ingest.map((q) => q.body).join('\n');
        if (ingest.length && !/\$pageview/.test(bodies)) notes.push('/: no $pageview seen in the (decoded) bodies');
        if (/\$pageview/.test(bodies) && !/utm_source/.test(bodies)) notes.push('/: utm_source not kept (allowed, but §5 keeps utm_*)');
      }
      for (const c of r.setCookies) fails.push(`/: Set-Cookie on ${c}`);
      for (const c of r.cookies.filter((n) => PH_KEY.test(n))) fails.push(`/: PostHog cookie ${c}`);
      for (const k of [...r.storage.local, ...r.storage.session].filter((k) => PH_KEY.test(k))) {
        fails.push(`/: PostHog storage key ${k}`);
      }
      for (const q of r.requests.filter((q) => REPLAY(q.url, q.body))) fails.push(`/: replay request ${q.url.split('?')[0]}`);
      const paths = [...new Set(r.requests.map((q) => new URL(q.url).host + new URL(q.url).pathname))];
      notes.push(`/: ${ingest.length} PostHog ingestion + ${r.requests.length - ingest.length} asset request(s), all aborted [${paths.join(', ')}]; cookies [${r.cookies.join(', ')}]`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
  return { fails, notes };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const base = args.find((a) => !a.startsWith('--'));
  if (!base || !/^https?:\/\//.test(base)) {
    console.error('usage: node qa/web/privacy-check.mjs <base-url> [--j-only] [--require-on]');
    process.exit(2);
  }
  try {
    const { fails, notes } = await run(base, { jOnly: args.includes('--j-only'), requireOn: args.includes('--require-on') });
    for (const n of notes) console.log(`note ${n}`);
    for (const f of fails) console.log(`FAIL ${f}`);
    console.log(fails.length ? `web privacy: ${fails.length} failure(s)` : 'web privacy: ok');
    process.exit(fails.length ? 1 : 0);
  } catch (e) {
    console.error(`web privacy: error ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  }
}
