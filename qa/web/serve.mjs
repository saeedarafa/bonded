// QA-47: tiny static server for web/ that behaves like Cloudflare Pages for what the site uses:
// directory -> index.html, the _redirects rule "/j/:code /j/ 200" (rewrite, not redirect),
// unknown paths -> 404.html with status 404. No dependencies.
// Usage: node qa/web/serve.mjs [port]   (default 4173, env PORT wins; env WEB_ROOT = another site dir)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// WEB_ROOT: serve another copy of the site (e.g. an old commit, to prove the checks catch a bug)
const ROOT = resolve(process.env.WEB_ROOT || fileURLToPath(new URL('../../web/', import.meta.url)));
const PORT = Number(process.env.PORT || process.argv[2] || 4173);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.json': 'application/json',
};

async function file(p) {
  try {
    const s = await stat(p);
    if (s.isDirectory()) return file(join(p, 'index.html'));
    return s.isFile() ? p : null;
  } catch { return null; }
}

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  // _redirects: /j/:code  /j/  200
  if (/^\/j\/[^/]+\/?$/.test(path)) path = '/j/';
  const full = normalize(join(ROOT, path));
  if (!full.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  let hit = await file(full);
  let status = 200;
  if (!hit) { hit = join(ROOT, '404.html'); status = 404; }
  res.writeHead(status, { 'content-type': TYPES[extname(hit)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(await readFile(hit));
}).listen(PORT, '127.0.0.1', () => console.log(`web/ on http://127.0.0.1:${PORT}`));
