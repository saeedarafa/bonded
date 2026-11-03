// QA-04: read the newest 6-digit sign-in code sent to EMAIL from the local Supabase mail catcher.
// Runs on the host (Maestro CLI, GraalJS), so 127.0.0.1 is the Mac, not the simulator.
// Mailpit (Supabase CLI 2.x) first, then the older Inbucket API. Throws when no code is there yet,
// so the caller wraps it in `retry`. Sets output.otp. Never logs the mail body.
/* global http, json, output, EMAIL, MAILPIT_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY */
const base = (typeof MAILPIT_URL !== 'undefined' && MAILPIT_URL) || 'http://127.0.0.1:54324';
const to = String(EMAIL).toLowerCase();

function sixDigits(text) {
  const m = /\b(\d{6})\b/.exec(String(text || ''));
  return m ? m[1] : null;
}

function fromMailpit() {
  const search = http.get(`${base}/api/v1/search?limit=1&query=${encodeURIComponent(`to:"${to}"`)}`);
  if (search.status !== 200) return undefined; // not Mailpit
  const found = json(search.body).messages || [];
  if (found.length === 0) return null;
  const msg = http.get(`${base}/api/v1/message/${found[0].ID}`);
  if (msg.status !== 200) return null;
  const m = json(msg.body);
  return sixDigits(m.Text) || sixDigits(m.Subject);
}

function fromInbucket() {
  // /api/v1/mailbox/<local-part>, oldest first.
  const box = to.split('@')[0];
  const list = http.get(`${base}/api/v1/mailbox/${box}`);
  if (list.status !== 200) return null;
  const items = json(list.body) || [];
  if (items.length === 0) return null;
  const one = http.get(`${base}/api/v1/mailbox/${box}/${items[items.length - 1].id}`);
  if (one.status !== 200) return null;
  const body = json(one.body).body;
  return sixDigits(body && body.text);
}

// The mail arrived but carries only a link: the local magic-link template has no {{ .Token }} (Supabase CLI
// 3.x default; reported to backend, see docs/plan/status/qa.md). Then mint a fresh 6-digit code with the
// local GoTrue admin API. Local stack only (127.0.0.1 / localhost), never a hosted project.
function mailArrived() {
  const search = http.get(`${base}/api/v1/search?limit=1&query=${encodeURIComponent(`to:"${to}"`)}`);
  return search.status === 200 && (json(search.body).messages || []).length > 0;
}

function fromAdmin() {
  const url = typeof SUPABASE_URL !== 'undefined' ? String(SUPABASE_URL) : '';
  const key = typeof SUPABASE_SERVICE_ROLE_KEY !== 'undefined' ? String(SUPABASE_SERVICE_ROLE_KEY) : '';
  if (!key || !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) return null;
  const res = http.post(`${url}/auth/v1/admin/generate_link`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: to }),
  });
  if (res.status !== 200) return null;
  const body = json(res.body);
  return sixDigits(body.email_otp || (body.properties && body.properties.email_otp));
}

const viaMailpit = fromMailpit();
let code = viaMailpit === undefined ? fromInbucket() : viaMailpit;
if (!code && viaMailpit !== undefined && mailArrived()) code = fromAdmin();
if (!code) throw new Error(`No sign-in code for ${to} yet`);
output.otp = code;
