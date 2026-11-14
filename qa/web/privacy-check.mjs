// QA-08 (website part) / QA-54 item 8: PostHog privacy check of the website with the cookie banner
// (ANALYTICS §5, PO 2026-11-14 decision D64, SEC-23 B). Opens a base URL in headless Chromium (Playwright from qa/web).
//
// The site (LEAD-04) loads PostHog from /assets/analytics.js, which loads the pinned self-hosted SDK
// /assets/vendor/posthog-js-<v>.js and calls posthog.init(KEY, {...}). KEY is injected at deploy time
// (web-deploy.yml); while analytics.js still holds the placeholder `__POSTHOG_PUBLIC_KEY__` the site
// runs WITHOUT analytics ("off"). The check detects the mode from analytics.js:
//   always, /j/ and /j/<code>?t=<token>: no PostHog or analytics.js in the HTML, no request to
//          analytics.js, the SDK or a PostHog host, no window.posthog, no PostHog storage, no banner.
//   / off: no SDK, no PostHog request, no window.posthog, no banner (and `--require-on` fails).
//   / on : static init options (cookieless_mode 'on_reject', opt-out by default, consent kept in
//          `bonded_consent`, replay with maskAllInputs, no console logs, no headers/bodies, no network
//          timing, a before_send URL strip), then three visits, each in a fresh browser context, opened
//          with a token, an email and a utm_source in the query:
//     1. before a choice: the banner shows; no cookie, no storage key at all, no recorder
//        (lazy-recorder.js / posthog-recorder.js) and no replay request (`/s/`, `$snapshot`); events
//        still go out (cookieless). Reject: `bonded_consent` = 0 is the only storage, nothing else
//        changes; after a reload the banner stays hidden and the same holds.
//     2. Accept: `bonded_consent` = 1, PostHog persistence (ph_*_posthog cookie or localStorage),
//        the recorder loads and replay snapshots are sent; runtime config has maskAllInputs, no console
//        log recording and no headers/bodies; a control string in page text IS found in the decoded
//        snapshots (proves the decoder sees them) while a fixture string typed into an <input> and a
//        <textarea>, a console.log line and a fetch URL marker never appear in any request; no
//        rrweb console or network plugin data. Reload: still accepted, still recording.
//     3. Accept, then Reject from "Cookie settings": PostHog cookie/storage gone, recording stops
//        (no snapshot after the reject), and a reload keeps it rejected.
//   In every visit: the query token and email never reach an event (only utm_* may stay); replay
//   snapshots keep the page URL as PostHog records it (ANALYTICS §5 note): a token there is a note.
// EVERY request to a PostHog host is recorded and answered locally (never forwarded): ingestion gets
// `{"status":1}`, the lazy SDK extensions (static/<v>/*.js) come from the posthog-js package pinned in
// qa/web/package.json (same version as web/assets/vendor), and the remote config (array/<key>/config.js)
// is a stub that turns replay on and *asks* for console logs and network bodies, so the site's own
// config has to win. Any other off-origin request is aborted. Nothing reaches PostHog.
//
// Usage (qa/web deps installed: npm --prefix qa/web ci && (cd qa/web && npx playwright install chromium)):
//   node qa/web/privacy-check.mjs https://hellobonded.com                 (live: any mode)
//   node qa/web/privacy-check.mjs http://127.0.0.1:4173 --require-on      (CI: key injected copy)
//   node qa/web/privacy-check.mjs <url> --j-only                          (only the /j/* half)
// Exit 0 = all checks pass, 1 = a check failed (each failure printed), 2 = usage / browser error.
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';

/** PostHog hosts (EU project, plus the generic ones a misconfigured init would use). */
export const POSTHOG_HOST = /(^|\.)posthog\.com$/i;
/** Same-origin PostHog files: the site loader and the self-hosted SDK. */
export const SITE_PH_FILE = /^\/assets\/(analytics\.js|vendor\/posthog)/i;
/** Lazy SDK assets and remote config on a PostHog host (not ingestion). */
const ASSET_PATH = /^\/(static\/|array\/)|\.js$/;
/** The session recorder bundle. */
export const isRecorder = (url) => /\/(lazy-recorder|posthog-recorder|recorder(-v2)?)\.js$/.test(new URL(url).pathname);
/** Replay ingestion: `/s/` endpoint or a `$snapshot` event in a body or query. */
export const isReplay = (url, body) => /^\/s\/?$/.test(new URL(url).pathname) || /\$snapshot/.test(`${url} ${body ?? ''}`);
/** A storage key or cookie name that PostHog writes (ph_<token>_posthog, ph_*, __ph_opt_in_out_*). */
export const PH_KEY = /^(ph_|__ph_|_ph_)|posthog/i;
/** The consent choice (strictly necessary, ANALYTICS §5): 1 accepted, 0 rejected. */
export const CONSENT_KEY = 'bonded_consent';
/** analytics.js before the deploy step injected a key. */
export const KEY_PLACEHOLDER = '__POSTHOG_PUBLIC_KEY__';
/** Values put in the query of `/` that must never reach a PostHog event. */
export const SECRET_TOKEN = 'QA08tokenSECRETzz';
export const SECRET_EMAIL = 'qa08.secret@example.com';
/** Typed into inputs; must never appear in any request (replay masks all inputs). */
export const TYPED = 'QA08typedFIXTUREzz';
/** Page text (not an input): mask_all_text is off, so replay must contain it (decoder control). */
export const CONTROL = 'QA08visibleCONTROLzz';
const CONSOLE = 'QA08consoleFIXTUREzz';
const NET = 'QA08networkFIXTUREzz';

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

/** Static checks of the init options text against ANALYTICS §5 (consent banner); returns failures. */
export function checkInitOptions(text, src = text) {
  if (!text) return ['no posthog.init({...}) call found'];
  const fails = [];
  const opt = (name, value) => new RegExp(`["']?${name}["']?\\s*:\\s*${value}`).test(text);
  const str = (v) => `["']${v}["']`;
  if (!opt('cookieless_mode', str('on_reject'))) fails.push("init: cookieless_mode is not 'on_reject'");
  if (!opt('opt_out_capturing_by_default', 'true')) fails.push('init: opt_out_capturing_by_default is not `true`');
  const id = /["']?consent_persistence_name["']?\s*:\s*([A-Za-z_$][\w$]*)/.exec(text)?.[1];
  const viaConst = id && new RegExp(`\\b(const|let|var)\\s+${id.replace(/\$/g, '\\$')}\\s*=\\s*["']${CONSENT_KEY}["']`).test(src);
  if (!opt('consent_persistence_name', str(CONSENT_KEY)) && !viaConst) fails.push(`init: consent_persistence_name is not '${CONSENT_KEY}'`);
  if (!opt('person_profiles', str('never'))) fails.push("init: person_profiles is not 'never'");
  if (!opt('maskAllInputs', 'true')) fails.push('init: session_recording.maskAllInputs is not `true`');
  if (opt('maskAllInputs', 'false')) fails.push('init: maskAllInputs: false present');
  if (!opt('enable_recording_console_log', 'false')) fails.push('init: enable_recording_console_log is not `false`');
  if (!opt('recordHeaders', 'false')) fails.push('init: session_recording.recordHeaders is not `false`');
  if (!opt('recordBody', 'false')) fails.push('init: session_recording.recordBody is not `false`');
  if (opt('network_timing', 'true') || !opt('network_timing', 'false')) fails.push('init: capture_performance.network_timing is not `false`');
  if (opt('capture_copied_text', 'true')) fails.push('init: capture_copied_text: true');
  if (!/["']?(before_send|sanitize_properties)["']?\s*:/.test(text)) fails.push('init: no before_send / sanitize_properties URL strip');
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

/**
 * Replay payloads compress rrweb full snapshots and mutations into gzip strings inside the JSON
 * (posthog-js `cv: "2024-10"`, bytes as latin1 chars starting with \x1f\x8b). Returns the body with
 * every such string expanded (recursively), so a plain text search sees what was recorded.
 */
export function expandText(text) {
  let json;
  try { json = JSON.parse(text); } catch { return text; }
  const parts = [text];
  const walk = (v, depth) => {
    if (depth > 40) return;
    if (typeof v === 'string') {
      if (v.charCodeAt(0) === 0x1f && v.charCodeAt(1) === 0x8b) {
        try { parts.push(expandText(gunzipSync(Buffer.from(v, 'latin1')).toString('utf8'))); } catch { /* not gzip */ }
      }
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, depth + 1));
    else if (v && typeof v === 'object') Object.values(v).forEach((x) => walk(x, depth + 1));
  };
  walk(json, 0);
  return parts.join('\n');
}

/**
 * rrweb plugin events in a (decoded) replay body. Network events (`rrweb/network@1`) must never be
 * there; console events (`rrweb/console@1`) only as the SDK's own warnings, which the recorder logs
 * into the recording even with console capture off (e.g. "[SessionRecording] Too many mutations").
 * Returns { bad: [descriptions], sdk: count of SDK-own console events }.
 */
export function pluginEvents(body) {
  const bad = [];
  let sdk = 0;
  const re = /"plugin":"rrweb\/(console|network)@\d+","payload":/g;
  for (let m; (m = re.exec(body));) {
    const start = m.index + m[0].length;
    if (m[1] === 'network') { bad.push('network plugin event'); continue; }
    // the payload object: balanced braces, strings skipped
    let depth = 0, i = start, inStr = false;
    for (; i < body.length; i++) {
      const ch = body[i];
      if (inStr) { if (ch === '\\') i++; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) break;
    }
    let lines = [];
    try { lines = JSON.parse(body.slice(start, i + 1)).payload ?? []; } catch { bad.push('unparsable console plugin event'); continue; }
    if (lines.length && lines.every((l) => /^"?\[(SessionRecording|PostHog)[^\]]*\]/.test(String(l)))) sdk++;
    else bad.push(`console plugin event (${String(lines[0]).slice(0, 40)}…)`);
  }
  return { bad, sdk };
}

/** The posthog-js package pinned in qa/web (serves the lazy extensions locally), or null. */
function localSdk() {
  try {
    const dir = new URL('./node_modules/posthog-js/', import.meta.url);
    const { version } = JSON.parse(readFileSync(new URL('package.json', dir), 'utf8'));
    return { version, dist: new URL('dist/', dir) };
  } catch { return null; }
}

/** Remote config stub: replay on, and it asks for console logs and network payloads (the site must say no). */
const remoteConfig = (token) => `(function(){window._POSTHOG_REMOTE_CONFIG=window._POSTHOG_REMOTE_CONFIG||{};window._POSTHOG_REMOTE_CONFIG[${JSON.stringify(token)}]={config:${JSON.stringify({
  token, supportedCompression: ['gzip', 'gzip-js'], hasFeatureFlags: false, captureDeadClicks: true, heatmaps: true, surveys: false,
  capturePerformance: { network_timing: true, web_vitals: true }, autocapture_opt_out: false, autocaptureExceptions: true,
  sessionRecording: { endpoint: '/s/', consoleLogRecordingEnabled: true, recorderVersion: 'v2', networkPayloadCapture: { recordHeaders: true, recordBody: true }, masking: null },
})},siteApps:[]}})();`;

/** A browser context whose PostHog traffic is recorded in `log` and answered locally. */
async function stubbedContext(newContext, origin, log, notes) {
  const context = await newContext();
  const sdk = localSdk();
  await context.route('**/*', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (POSTHOG_HOST.test(u.hostname)) {
      const asset = ASSET_PATH.test(u.pathname);
      log.push({ url: req.url(), at: Date.now(), asset, recorder: isRecorder(req.url()), body: asset ? '' : expandText(bodyText(req.postDataBuffer())) });
      const st = /^\/static\/([^/]+)\/([\w-]+\.js)$/.exec(u.pathname);
      if (st) {
        const file = sdk && new URL(st[2], sdk.dist);
        if (file && sdk.version === st[1] && existsSync(file)) return route.fulfill({ contentType: 'text/javascript', body: readFileSync(file) });
        notes.add(`/: lazy asset ${u.pathname} not served (qa/web posthog-js ${sdk?.version ?? 'missing'}): aborted`);
        return route.abort();
      }
      const cfg = /^\/array\/([^/]+)\/config\.js$/.exec(u.pathname);
      if (cfg) return route.fulfill({ contentType: 'text/javascript', body: remoteConfig(cfg[1]) });
      if (asset) return route.abort();
      return route.fulfill({ contentType: 'application/json', body: '{"status":1}' });
    }
    if (u.origin !== origin) return route.abort(); // nothing else off-origin either
    return route.continue();
  });
  return context;
}

/** Cookies, storage, banner and runtime config of a page. */
async function state(page) {
  const s = await page.evaluate((consentKey) => {
    const c = window.posthog?.config;
    const b = document.getElementById('cookie-banner');
    return {
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
      consent: localStorage.getItem(consentKey),
      banner: Boolean(b && !b.hidden && (typeof b.checkVisibility === 'function' ? b.checkVisibility() : true)),
      recording: typeof window.posthog?.sessionRecordingStarted === 'function' ? window.posthog.sessionRecordingStarted() : null,
      config: c ? {
        persistence: c.persistence, cookieless_mode: c.cookieless_mode,
        maskAllInputs: c.session_recording?.maskAllInputs, recordHeaders: c.session_recording?.recordHeaders,
        recordBody: c.session_recording?.recordBody, console: c.enable_recording_console_log,
      } : null,
    };
  }, CONSENT_KEY);
  s.cookies = (await page.context().cookies()).map((c) => c.name);
  return s;
}

async function settle(page, ms = 3000) { await page.waitForTimeout(ms); }

/** Scroll and type, so autocapture, heatmaps and replay have something to send. */
async function interact(page) {
  await page.evaluate((control) => {
    const host = document.querySelector('main') || document.body;
    const box = document.createElement('div');
    box.id = 'qa08';
    box.innerHTML = `<p>${control}</p><label>Name <input id="qa08-in" type="text" name="qa08"></label><textarea id="qa08-ta"></textarea>`;
    host.prepend(box);
  }, CONTROL);
  await page.fill('#qa08-in', TYPED);
  await page.fill('#qa08-ta', TYPED);
  await page.click('#qa08-in');
  await page.evaluate(({ c, n }) => { console.log(c); fetch(`/?${n}`).catch(() => {}); }, { c: CONSOLE, n: NET });
  await page.mouse.wheel(0, 2500).catch(() => {});
}

/** Checks that apply to every PostHog request of a visit. */
function checkRequests(tag, log, fails, notes) {
  for (const q of log.filter((x) => !x.asset)) {
    const all = `${q.url} ${q.body}`;
    const path = new URL(q.url).pathname;
    const replay = isReplay(q.url, q.body);
    for (const [s, what] of [[TYPED, 'typed input text'], [CONSOLE, 'a console log line'], [NET, 'a fetch URL (network capture)']]) {
      if (all.includes(s)) fails.push(`${tag}: ${what} sent to PostHog in ${path}`);
    }
    const plugins = pluginEvents(q.body);
    for (const p of plugins.bad) fails.push(`${tag}: rrweb ${p} in ${path}`);
    if (plugins.sdk) notes.add(`${tag}: ${plugins.sdk} console event(s) in replay come from the PostHog SDK itself ([SessionRecording] warnings), not from the page`);
    for (const s of [SECRET_TOKEN, SECRET_EMAIL, encodeURIComponent(SECRET_EMAIL)]) {
      if (!all.includes(s)) continue;
      const what = s === SECRET_TOKEN ? 'query token' : 'query email';
      if (replay) notes.add(`${tag}: ${what} in a replay snapshot (page URL as recorded; ANALYTICS §5 "SEC to confirm")`);
      else fails.push(`${tag}: ${what} sent to PostHog in ${path}`);
    }
  }
}

/** Cookieless state (before a choice, after Reject): only `bonded_consent` may be stored, no cookie. */
function checkCookieless(tag, s, fails, { consent }) {
  for (const c of s.cookies) fails.push(`${tag}: cookie ${c}`);
  for (const k of [...s.local, ...s.session].filter((k) => k !== CONSENT_KEY)) fails.push(`${tag}: storage key ${k}`);
  if (s.consent !== consent) fails.push(`${tag}: ${CONSENT_KEY} = ${s.consent} (expected ${consent})`);
  if (s.recording) fails.push(`${tag}: session recording started`);
}

async function visit(context, url) {
  const page = await context.newPage();
  const origin = new URL(url).origin;
  const siteFiles = [];
  const setCookies = [];
  page.on('request', (req) => { const u = new URL(req.url()); if (u.origin === origin && SITE_PH_FILE.test(u.pathname)) siteFiles.push(u.pathname); });
  page.on('response', async (res) => {
    const h = await res.allHeaders().catch(() => ({}));
    if (h['set-cookie']) setCookies.push(`${res.url().split('?')[0]}: ${h['set-cookie'].split('=')[0]}=…`);
  });
  const res = await page.goto(url, { waitUntil: 'load' });
  const html = res ? await res.text() : '';
  // analytics.js starts PostHog after `load`; give the SDK time to boot and flush (pageview).
  await settle(page);
  return { page, html, siteFiles, setCookies };
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

const replayOrRecorder = (q) => q.recorder || (!q.asset && isReplay(q.url, q.body));

export async function run(base, { jOnly = false, requireOn = false } = {}) {
  const fails = [];
  const notes = new Set();
  const origin = new URL(base).origin;
  const query = `/?t=${SECRET_TOKEN}&email=${encodeURIComponent(SECRET_EMAIL)}&utm_source=qa08#${SECRET_TOKEN}`;
  // posthog-js drops events as a bot when navigator.webdriver is true or the user agent says
  // "HeadlessChrome": present as regular Chrome so the SDK really builds and sends its events (which
  // are then answered locally and inspected). The site's own config is not touched.
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
      const log = [];
      const context = await stubbedContext(newContext, origin, log, notes);
      const r = await visit(context, new URL(path, base).href);
      const s = await state(r.page);
      if (!r.html) fails.push(`${path}: empty response`);
      if (htmlHasPostHog(r.html)) fails.push(`${path}: the HTML mentions posthog or analytics.js (must never load on /j/*)`);
      for (const f of r.siteFiles) fails.push(`${path}: loads ${f}`);
      for (const q of log) fails.push(`${path}: request to PostHog ${q.url.split('?')[0]}`);
      if (s.config) fails.push(`${path}: window.posthog is initialised`);
      if (s.banner || (await r.page.$('#cookie-banner'))) fails.push(`${path}: cookie banner present`);
      for (const k of [...s.local, ...s.session].filter((k) => PH_KEY.test(k) || k === CONSENT_KEY)) fails.push(`${path}: storage key ${k}`);
      for (const c of s.cookies) fails.push(`${path}: cookie ${c}`);
      await context.close();
    }
    if (jOnly) return { fails, notes: [...notes] };

    // Mode detection on a plain visit (this visit is also step 1, before a choice).
    const log0 = [];
    const ctx0 = await stubbedContext(newContext, origin, log0, notes);
    const r0 = await visit(ctx0, new URL(query, base).href);
    const srcs = await sources(ctx0, base, r0.html);
    const loader = srcs.find((s) => /(posthog|\bph)\.init\s*\(/.test(s.text)) ?? srcs.find((s) => /analytics\.js$/.test(s.src));
    const inline = /posthog\.init\s*\(/.test(r0.html) ? r0.html : null;
    const code = inline ?? loader?.text ?? null;
    const on = Boolean(code) && !code.includes(KEY_PLACEHOLDER);
    const s0 = await state(r0.page);
    for (const c of r0.setCookies) fails.push(`/: Set-Cookie on ${c}`);
    if (!htmlHasPostHog(r0.html)) {
      notes.add('/: no PostHog loader in the HTML');
      if (requireOn) fails.push('/: PostHog not found in the HTML (site analytics not built?)');
    }
    if (!on) {
      if (htmlHasPostHog(r0.html)) notes.add(`/: analytics OFF (${loader?.src ?? 'the loader'} still holds ${KEY_PLACEHOLDER}: no key injected)`);
      if (requireOn && htmlHasPostHog(r0.html)) fails.push('/: analytics off but --require-on (key not injected)');
      for (const f of r0.siteFiles.filter((f) => /vendor/.test(f))) fails.push(`/: analytics off but the SDK loaded (${f})`);
      for (const q of log0) fails.push(`/: analytics off but a request to PostHog ${q.url.split('?')[0]}`);
      if (s0.config) fails.push('/: analytics off but window.posthog is initialised');
      if (s0.banner) fails.push('/: analytics off but the cookie banner shows');
      for (const c of s0.cookies) fails.push(`/: cookie ${c}`);
      for (const k of [...s0.local, ...s0.session]) fails.push(`/: storage key ${k}`);
      await ctx0.close();
      return { fails, notes: [...notes] };
    }

    notes.add(`/: analytics ON (init in ${inline ? 'the HTML' : loader.src})`);
    fails.push(...checkInitOptions(initOptionsText(code), code).map((f) => `/: ${f}`));
    if (!s0.config) fails.push('/: key injected but window.posthog never initialised');
    else if (s0.config.cookieless_mode !== 'on_reject') fails.push(`/: runtime cookieless_mode = ${s0.config.cookieless_mode}`);

    // 1. Before a choice, then Reject, then reload.
    {
      const tag = '/ before a choice';
      const { page } = r0;
      if (!s0.banner) fails.push(`${tag}: the cookie banner is not shown`);
      await interact(page);
      await settle(page, 4000);
      checkCookieless(tag, await state(page), fails, { consent: null });
      if (!log0.some((q) => !q.asset)) fails.push(`${tag}: no event reached the network layer (cookieless counting broken, or nothing to inspect)`);
      for (const q of log0.filter(replayOrRecorder)) fails.push(`${tag}: replay/recorder request ${new URL(q.url).pathname}`);
      const bodies = log0.filter((q) => !q.asset).map((q) => q.body).join('\n');
      if (/\$pageview/.test(bodies) && !/utm_source/.test(bodies)) notes.add('/: utm_source not kept (allowed, but §5 keeps utm_*)');

      const tagR = '/ after Reject';
      const n = log0.length;
      await page.click('[data-consent=reject]');
      await page.mouse.wheel(0, -1500).catch(() => {});
      await settle(page);
      const sr = await state(page);
      checkCookieless(tagR, sr, fails, { consent: '0' });
      if (sr.banner) fails.push(`${tagR}: the banner is still shown`);
      for (const q of log0.slice(n).filter(replayOrRecorder)) fails.push(`${tagR}: replay/recorder request ${new URL(q.url).pathname}`);

      const tagRR = '/ Reject, reloaded';
      const m = log0.length;
      await page.reload({ waitUntil: 'load' });
      await settle(page);
      await interact(page);
      await settle(page, 4000);
      const srr = await state(page);
      checkCookieless(tagRR, srr, fails, { consent: '0' });
      if (srr.banner) fails.push(`${tagRR}: the banner shows again (choice not kept)`);
      const re = log0.slice(m);
      if (!re.some((q) => !q.asset)) fails.push(`${tagRR}: no event sent (cookieless counting should continue after Reject)`);
      for (const q of re.filter(replayOrRecorder)) fails.push(`${tagRR}: replay/recorder request ${new URL(q.url).pathname}`);
      checkRequests('/ before a choice, Reject', log0, fails, notes);
      notes.add(`/ before a choice + Reject: ${log0.filter((q) => !q.asset).length} event request(s), ${log0.filter((q) => q.asset).length} asset request(s), all answered locally`);
      await ctx0.close();
    }

    // 2. Accept, then reload.
    {
      const tag = '/ after Accept';
      const log = [];
      const ctx = await stubbedContext(newContext, origin, log, notes);
      const { page } = await visit(ctx, new URL(query, base).href);
      await page.click('[data-consent=accept]');
      await settle(page, 2000);
      await interact(page);
      await settle(page, 7000);
      const s = await state(page);
      if (s.consent !== '1') fails.push(`${tag}: ${CONSENT_KEY} = ${s.consent} (expected 1)`);
      if (s.banner) fails.push(`${tag}: the banner is still shown`);
      const persisted = [...s.local, ...s.cookies].filter((k) => /^ph_.*_posthog$/.test(k));
      if (!persisted.length) fails.push(`${tag}: no PostHog persistence (ph_<key>_posthog cookie or localStorage)`);
      if (!s.config) fails.push(`${tag}: window.posthog not initialised`);
      else {
        if (!/cookie|localStorage/.test(String(s.config.persistence))) fails.push(`${tag}: runtime persistence = ${s.config.persistence}`);
        if (s.config.maskAllInputs !== true) fails.push(`${tag}: runtime session_recording.maskAllInputs = ${s.config.maskAllInputs}`);
        if (s.config.console !== false) fails.push(`${tag}: runtime enable_recording_console_log = ${s.config.console}`);
        if (s.config.recordHeaders || s.config.recordBody) fails.push(`${tag}: runtime recordHeaders/recordBody on`);
      }
      if (!log.some((q) => q.recorder)) fails.push(`${tag}: the recorder never loaded (replay after Accept broken, or nothing to inspect)`);
      const snaps = log.filter((q) => !q.asset && isReplay(q.url, q.body));
      if (!snaps.length) fails.push(`${tag}: no replay snapshot sent (nothing to inspect)`);
      else if (!snaps.some((q) => q.body.includes(CONTROL))) fails.push(`${tag}: page text not found in the decoded snapshots (decoder blind: the typed-text check proves nothing)`);
      notes.add(`/ after Accept: ${snaps.length} snapshot request(s), recorder ${s.recording ? 'on' : 'off'}, persistence [${persisted.join(', ')}]`);

      const tagA = '/ Accept, reloaded';
      const n = log.length;
      await page.reload({ waitUntil: 'load' });
      await settle(page);
      await interact(page);
      await settle(page, 6000);
      const sa = await state(page);
      if (sa.consent !== '1') fails.push(`${tagA}: ${CONSENT_KEY} = ${sa.consent} (expected 1)`);
      if (sa.banner) fails.push(`${tagA}: the banner shows again (choice not kept)`);
      if (!log.slice(n).some((q) => !q.asset && isReplay(q.url, q.body))) fails.push(`${tagA}: no replay snapshot after the reload`);
      checkRequests('/ Accept', log, fails, notes);
      await ctx.close();
    }

    // 3. Accept, then Reject from "Cookie settings", then reload.
    {
      const tag = '/ Accept then Reject';
      const log = [];
      const ctx = await stubbedContext(newContext, origin, log, notes);
      const { page } = await visit(ctx, new URL(query, base).href);
      await page.click('[data-consent=accept]');
      await settle(page, 2000);
      await interact(page);
      await settle(page, 6000);
      const link = page.locator('[data-cookie-settings]').first();
      await link.scrollIntoViewIfNeeded().catch(() => {});
      await link.click();
      if (!(await state(page)).banner) fails.push(`${tag}: "Cookie settings" does not reopen the banner`);
      await page.click('[data-consent=reject]');
      const at = Date.now();
      await settle(page, 1000);
      await page.fill('#qa08-in', 'more typing after reject');
      await page.mouse.wheel(0, 1500).catch(() => {});
      await settle(page, 6000);
      checkCookieless(tag, await state(page), fails, { consent: '0' });
      for (const q of log.filter((x) => x.at > at + 500 && !x.asset && isReplay(x.url, x.body))) fails.push(`${tag}: replay snapshot after Reject ${new URL(q.url).pathname}`);
      const n = log.length;
      await page.reload({ waitUntil: 'load' });
      await settle(page);
      await interact(page);
      await settle(page, 4000);
      checkCookieless(`${tag}, reloaded`, await state(page), fails, { consent: '0' });
      for (const q of log.slice(n).filter(replayOrRecorder)) fails.push(`${tag}, reloaded: replay/recorder request ${new URL(q.url).pathname}`);
      checkRequests(tag, log, fails, notes);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  return { fails, notes: [...notes] };
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
    console.error(`web privacy: error ${e instanceof Error ? e.stack : e}`);
    process.exit(2);
  }
}
