// QA-54 (D63, extends QA-08): scan what a dev build with session replay on sent to the local
// capture server (capture-server.mjs) and fail on anything the replay must never carry.
//
// Checks, over every captured request (events, batches, `$snapshot` uploads):
//   fixture   a qa/fixtures/privacy-strings.json string in any text (not in image data);
//   console   an rrweb plugin event for console logs (`rrweb/console@1`);
//   network   an rrweb plugin event or property for network requests (`rrweb/network@1`,
//             `$network_requests`), or any captured request/response body or headers;
//   quiet     a replay event timed inside a `quiet` window (e.g. "Share usage data" off);
//   ocr       (with --ocr) recognised text in a frame: a fixture string anywhere, or any text at all
//             in a frame timed inside a `masked` window (a never-recorded screen).
// Windows come from marks the tester posts while driving the device (README.md).
//
// Usage: node qa/privacy/replay/scan.mjs <capture-dir> [--ocr] [--json]
// Exit 1 on any violation, 2 when nothing was captured (no false pass on an empty run).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const FIXTURES = resolve(HERE, '../../fixtures/privacy-strings.json');

/** Every fixture string, flattened (the `_meta` block is documentation). */
export function fixtureStrings(path = FIXTURES) {
  const j = JSON.parse(readFileSync(path, 'utf8'));
  return Object.entries(j)
    .filter(([k]) => k !== '_meta')
    .flatMap(([, v]) => (Array.isArray(v) ? v : []))
    .filter((s) => typeof s === 'string' && s.length > 0);
}

/** A matcher per fixture string: short single words ("Sam") only as whole words. */
export function matchers(strings) {
  return strings.map((s) => {
    const esc = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return { s, re: /^\w{1,6}$/.test(s) ? new RegExp(`\\b${esc}\\b`) : new RegExp(esc) };
  });
}

/** Raw request body -> text: gzip (header or magic bytes), `data=<base64>` forms, else utf8. */
export function decodeBody(buf, headers = {}) {
  let b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf ?? '');
  const enc = String(headers['content-encoding'] ?? '').toLowerCase();
  if (enc.includes('gzip') || (b[0] === 0x1f && b[1] === 0x8b)) b = gunzipSync(b);
  let text = b.toString('utf8');
  if (/^(data|compression)=/.test(text)) {
    const p = new URLSearchParams(text);
    const d = p.get('data') ?? '';
    const raw = Buffer.from(d, 'base64');
    text = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  }
  return text;
}

/** Events in a decoded body: a list, `{ batch: [...] }`, or one event. */
export function eventsOf(text) {
  let j;
  try { j = JSON.parse(text); } catch { return []; }
  if (Array.isArray(j)) return j;
  if (j && Array.isArray(j.batch)) return j.batch;
  return j && typeof j === 'object' && j.event ? [j] : [];
}

const isImage = (key, v) =>
  key === 'base64' || /^data:image\/[a-z+]+;base64,/i.test(v) || (v.length > 2000 && /^[A-Za-z0-9+/=]+$/.test(v));

/** Walk a value; call onText(path, string) for every non-image string, onImage for image data. */
export function walk(v, onText, onImage, path = '') {
  if (typeof v === 'string') {
    const key = path.split('.').pop();
    if (isImage(key, v)) onImage(path, v);
    else onText(path, v);
  } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, onText, onImage, `${path}[${i}]`));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      onText(`${path}.${k}#key`, k);
      walk(x, onText, onImage, path ? `${path}.${k}` : k);
    }
  }
}

const inWindow = (t, wins) => wins.find((w) => t >= w.from && t <= w.to);

/** Windows from marks: `{ kind: 'quiet'|'masked', label, at }` pairs `start`/`end` by label. */
export function windowsFrom(marks, graceMs = 2000) {
  const open = new Map();
  const out = [];
  for (const m of marks) {
    const key = `${m.kind}:${m.label ?? ''}`;
    if (m.edge === 'start') open.set(key, m.at);
    if (m.edge === 'end' && open.has(key)) {
      // Grace after the start: a frame taken just before the switch may be stamped a moment later.
      out.push({ kind: m.kind, label: m.label ?? '', from: open.get(key) + graceMs, to: m.at });
      open.delete(key);
    }
  }
  return out;
}

/**
 * Scan decoded requests. `requests` = [{ path, text }], `marks` as in windowsFrom.
 * Returns { violations, frames: [{ file?, data, at, session, screen, window }], stats }.
 */
export function scan(requests, { strings = fixtureStrings(), marks = [] } = {}) {
  const ms = matchers(strings);
  const wins = windowsFrom(marks);
  const violations = [];
  const frames = [];
  const stats = { requests: requests.length, events: 0, snapshots: 0, rrweb: 0, frames: 0, screens: new Set() };
  const textHit = (where, s) => {
    for (const m of ms) if (m.re.test(s)) violations.push({ check: 'fixture', where, fixture: m.s });
  };

  for (const r of requests) {
    textHit(`${r.path} (url)`, r.path);
    const events = eventsOf(r.text);
    if (events.length === 0) walk(r.text, (p, s) => textHit(`${r.path} ${p}`, s), () => {});
    for (const e of events) {
      stats.events++;
      const props = e.properties ?? {};
      const session = props.$session_id ?? '';
      if ('$network_requests' in props) violations.push({ check: 'network', where: `${e.event} $network_requests` });
      walk(e, (p, s) => textHit(`${r.path} ${e.event} ${p}`, s), () => {});
      if (e.event !== '$snapshot') continue;
      stats.snapshots++;
      let screen = props.$screen_name ?? '';
      for (const rr of props.$snapshot_data ?? []) {
        stats.rrweb++;
        const at = Number(rr.timestamp ?? 0);
        if (rr.type === 4 && rr.data?.href) screen = String(rr.data.href);
        if (screen) stats.screens.add(screen);
        const plugin = String(rr.data?.plugin ?? '');
        if (rr.type === 6 && /console/i.test(plugin)) violations.push({ check: 'console', where: `${session} ${plugin}` });
        if (rr.type === 6 && /network/i.test(plugin)) violations.push({ check: 'network', where: `${session} ${plugin}` });
        walk(rr.data ?? {}, (p, s) => {
          if (p.endsWith('#key') && /^(request|response)_?(body|headers)$/i.test(s))
            violations.push({ check: 'network', where: `${session} ${p.replace(/#key$/, '')}` });
        }, (p, data) => {
          stats.frames++;
          frames.push({ data, at, session, screen, path: p, window: inWindow(at, wins.filter((w) => w.kind === 'masked'))?.label ?? null });
        });
        const q = inWindow(at, wins.filter((w) => w.kind === 'quiet'));
        if (q) violations.push({ check: 'quiet', where: `${session} rrweb type ${rr.type} at ${new Date(at).toISOString()} in "${q.label}"` });
      }
    }
  }
  return { violations, frames, stats: { ...stats, screens: [...stats.screens] } };
}

/** OCR results ({ file: [lines] }) against the frames: fixtures anywhere, any text when masked. */
export function checkOcr(frames, ocr, strings = fixtureStrings()) {
  const ms = matchers(strings);
  const out = [];
  for (const f of frames) {
    if (!(f.file in ocr)) { out.push({ check: 'ocr', where: f.file, text: 'not OCRed' }); continue; }
    const lines = ocr[f.file];
    if (lines.some((l) => l.startsWith('<ocr error'))) { out.push({ check: 'ocr', where: f.file, text: lines.join(' ') }); continue; }
    for (const line of lines) for (const m of ms) if (m.re.test(line)) out.push({ check: 'ocr', where: `${f.file} (${f.screen})`, fixture: m.s });
    if (f.window && lines.length > 0) out.push({ check: 'ocr', where: `${f.file} in masked "${f.window}"`, text: `${lines.length} line(s) recognised` });
  }
  return out;
}

/** Read a capture dir written by capture-server.mjs. */
export function readCapture(dir) {
  const log = readFileSync(join(dir, 'requests.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const marks = log.filter((l) => l.mark).map((l) => l.mark);
  const requests = log.filter((l) => l.body).map((l) => ({
    path: l.path,
    text: decodeBody(readFileSync(join(dir, l.body)), l.headers),
  }));
  return { requests, marks };
}

function writeFrames(dir, frames) {
  const out = join(dir, 'frames');
  mkdirSync(out, { recursive: true });
  frames.forEach((f, i) => {
    const m = /^data:image\/([a-z+]+);base64,(.*)$/is.exec(f.data);
    const ext = m ? m[1].replace('jpeg', 'jpg') : 'bin';
    f.file = `${String(i).padStart(4, '0')}-${(f.screen || 'unknown').replace(/[^\w.-]+/g, '_')}.${ext}`;
    writeFileSync(join(out, f.file), Buffer.from(m ? m[2] : f.data, 'base64'));
  });
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [dir, ...flags] = process.argv.slice(2);
  if (!dir) { console.error('usage: node qa/privacy/replay/scan.mjs <capture-dir> [--ocr] [--json]'); process.exit(64); }
  const { requests, marks } = readCapture(dir);
  const res = scan(requests, { marks });
  const framesDir = writeFrames(dir, res.frames);
  if (flags.includes('--ocr') && res.frames.length) {
    const ocr = JSON.parse(execFileSync('swift', [join(HERE, 'ocr.swift'), framesDir], { maxBuffer: 1 << 28 }).toString());
    res.violations.push(...checkOcr(res.frames, ocr));
    writeFileSync(join(dir, 'ocr.json'), JSON.stringify(ocr, null, 1));
  }
  const report = { stats: res.stats, marks, violations: res.violations, frames: res.frames.map(({ data, ...f }) => f) };
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 1));
  if (flags.includes('--json')) console.log(JSON.stringify(report, null, 1));
  console.log(`requests ${res.stats.requests}, events ${res.stats.events}, $snapshot ${res.stats.snapshots}, rrweb ${res.stats.rrweb}, frames ${res.stats.frames} -> ${framesDir}`);
  console.log(`screens: ${res.stats.screens.join(', ') || '(none)'}`);
  for (const v of res.violations) console.log(`FAIL ${v.check}: ${v.where}${v.fixture ? ` contains fixture "${v.fixture}"` : ''}${v.text ? ` ${v.text}` : ''}`);
  if (res.stats.snapshots === 0) { console.log('NOTHING RECORDED: no $snapshot captured (replay off, wrong host, or not trusted TLS)'); process.exit(2); }
  console.log(res.violations.length ? `${res.violations.length} violation(s)` : 'ok: no violations');
  process.exit(res.violations.length ? 1 : 0);
}
