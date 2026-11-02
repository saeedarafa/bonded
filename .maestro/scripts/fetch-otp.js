// QA-04: read the newest 6-digit sign-in code sent to EMAIL from the local Supabase mail catcher.
// Runs on the host (Maestro CLI), so 127.0.0.1 is the Mac, not the simulator.
// Mailpit (Supabase CLI 2.x) first, then the older Inbucket API. Throws when no code is there yet,
// so the caller wraps it in `retry`. Sets output.otp. Never logs the mail body.
var base = (typeof MAILPIT_URL !== 'undefined' && MAILPIT_URL) || 'http://127.0.0.1:54324';
var to = String(EMAIL).toLowerCase();
var code = null;

function sixDigits(text) {
  var m = /\b(\d{6})\b/.exec(String(text || ''));
  return m ? m[1] : null;
}

var search = http.get(base + '/api/v1/search?limit=1&query=' + encodeURIComponent('to:"' + to + '"'));
if (search.status === 200) {
  var found = json(search.body).messages || [];
  if (found.length > 0) {
    var msg = http.get(base + '/api/v1/message/' + found[0].ID);
    if (msg.status === 200) {
      var m = json(msg.body);
      code = sixDigits(m.Text) || sixDigits(m.Subject);
    }
  }
} else {
  // Inbucket: /api/v1/mailbox/<local-part>, oldest first.
  var box = to.split('@')[0];
  var list = http.get(base + '/api/v1/mailbox/' + box);
  if (list.status === 200) {
    var items = json(list.body) || [];
    if (items.length > 0) {
      var last = items[items.length - 1];
      var one = http.get(base + '/api/v1/mailbox/' + box + '/' + last.id);
      if (one.status === 200) code = sixDigits(json(one.body).body && json(one.body).body.text);
    }
  }
}

if (!code) throw new Error('No sign-in code for ' + to + ' yet');
output.otp = code;
