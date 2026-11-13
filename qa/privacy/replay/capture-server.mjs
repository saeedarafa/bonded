// QA-54 (D63): a local stand-in for the PostHog host, so a dev build with session replay on sends
// its events and `$snapshot` uploads here instead of to PostHog. Nothing leaves the Mac.
//
// The app only accepts `EXPO_PUBLIC_POSTHOG_HOST` matching ^https://[a-z0-9.-]+$ (no port), so this
// listens with TLS on 443 (macOS lets a normal user bind it) and the build uses
// `https://localhost`. The certificate is made here with openssl (CA:TRUE, serverAuth, 30 days) in
// the capture dir; trust it on the simulator with `xcrun simctl keychain <udid> add-root-cert`.
// Nothing secret is written to the repo.
//
// Remote config answers the WORST case: replay on, console logs on, network timing and payload
// capture on, sample rate 1. The app's own config (REPLAY_CONFIG) must still win.
//
// Every request: raw body -> <dir>/bodies/<n>.bin, one line in <dir>/requests.ndjson
// ({ n, at, method, path, headers: content-type/-encoding only, body }). Marks for the scanner's
// windows: POST /__mark?kind=quiet|masked&edge=start|end&label=<text> (from the Mac, with curl).
// Stop: POST /__quit.
//
// Usage: node qa/privacy/replay/capture-server.mjs [--dir <capture-dir>] [--port 443]
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const DIR = arg('--dir', join(process.env.TMPDIR || tmpdir(), 'qa54-capture'));
const PORT = Number(arg('--port', 443));
mkdirSync(join(DIR, 'bodies'), { recursive: true });

export const REMOTE_CONFIG = {
  sessionRecording: {
    endpoint: '/s/',
    consoleLogRecordingEnabled: true,
    recorderVersion: 'v2',
    sampleRate: '1.00',
    networkPayloadCapture: { recordBody: true, recordHeaders: true },
  },
  capturePerformance: { network_timing: true, web_vitals: false },
  autocapture_opt_out: false,
  surveys: false,
  heatmaps: true,
  supportedCompression: ['gzip', 'gzip-js'],
};

function cert() {
  const key = join(DIR, 'qa54-key.pem');
  const crt = join(DIR, 'qa54-cert.pem');
  if (!existsSync(crt)) {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30', '-sha256',
      '-keyout', key, '-out', crt, '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
      '-addext', 'basicConstraints=critical,CA:TRUE',
      '-addext', 'extendedKeyUsage=serverAuth',
      '-addext', 'keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign',
    ], { stdio: 'ignore' });
  }
  return { key: readFileSync(key), cert: readFileSync(crt), crt };
}

let n = 0;
const log = (o) => appendFileSync(join(DIR, 'requests.ndjson'), `${JSON.stringify(o)}\n`);
const tls = cert();

const server = createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const at = Date.now();
    const url = new URL(req.url, 'https://localhost');
    if (url.pathname === '/__quit') {
      res.writeHead(204).end();
      server.close();
      setImmediate(() => process.exit(0));
      return;
    }
    if (url.pathname === '/__mark') {
      const mark = { kind: url.searchParams.get('kind'), edge: url.searchParams.get('edge'), label: url.searchParams.get('label') ?? '', at };
      log({ at, mark });
      console.log(`mark ${mark.kind} ${mark.edge} ${mark.label}`);
      res.writeHead(204).end();
      return;
    }
    const body = Buffer.concat(chunks);
    const id = ++n;
    const entry = {
      n: id, at, method: req.method, path: req.url,
      headers: { 'content-type': req.headers['content-type'] ?? '', 'content-encoding': req.headers['content-encoding'] ?? '' },
    };
    if (body.length) {
      entry.body = join('bodies', `${String(id).padStart(5, '0')}.bin`);
      writeFileSync(join(DIR, entry.body), body);
    }
    log(entry);
    console.log(`${req.method} ${url.pathname} ${body.length}B`);
    let out = { status: 1 };
    if (/^\/(flags|decide)\/?$/.test(url.pathname)) {
      out = { featureFlags: {}, featureFlagPayloads: {}, errorsWhileComputingFlags: false, quotaLimited: [], ...REMOTE_CONFIG };
    } else if (/^\/array\/[^/]+\/config/.test(url.pathname)) {
      out = REMOTE_CONFIG;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
  });
});
// Loopback only: the simulator reaches the Mac's localhost. macOS lets a normal user bind a port
// below 1024 only on all interfaces, so then connections from anything but loopback are dropped.
const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/;
server.on('connection', (sock) => { if (!LOOPBACK.test(sock.remoteAddress ?? '')) sock.destroy(); });
server.listen(PORT, PORT < 1024 ? '0.0.0.0' : '127.0.0.1', () => console.log(`QA-54 capture on https://localhost:${PORT}, dir ${DIR}, cert ${tls.crt}`));
