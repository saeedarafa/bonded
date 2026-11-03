// QA-04 / QA-11: read the newest 6-digit sign-in code sent to EMAIL from the local Supabase mail catcher.
// Runs on the host (Maestro CLI, GraalJS), so 127.0.0.1 is the Mac, not the simulator.
// Mailpit (Supabase CLI 2.x+) first, then the older Inbucket API. The code comes from the email only
// (D35, CONTRACTS §10: the magic_link and confirmation templates carry {{ .Token }}); there is no admin
// fallback. Throws when no code is there yet, so the caller wraps it in `retry`. Sets output.otp.
// Never logs the mail body.
/* global http, json, output, EMAIL, MAILPIT_URL */
const base = (typeof MAILPIT_URL !== 'undefined' && MAILPIT_URL) || 'http://127.0.0.1:54324';
const to = String(EMAIL).toLowerCase();

// The link's token is a long hash, but drop URLs first so no digit run inside a link can match.
function sixDigits(text) {
  const plain = String(text || '').replace(/https?:\/\/\S+/g, ' ').replace(/<[^>]*>/g, ' ');
  const m = /(?:^|[^\d])(\d{6})(?![\d])/.exec(plain);
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
  return sixDigits(m.Text) || sixDigits(m.HTML);
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
  return sixDigits(body && body.text) || sixDigits(body && body.html);
}

const viaMailpit = fromMailpit();
const code = viaMailpit === undefined ? fromInbucket() : viaMailpit;
if (!code) throw new Error(`No sign-in code in the mail for ${to} yet`);
output.otp = code;
