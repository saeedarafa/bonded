// BE-48d / D50: the day-5 trial reminder email ledger. Same trial window and quiet hours as the
// `trial_ending` push, its own once-per-trial ledger, confirmed email only, service role only.
import assert from 'node:assert/strict';
import { createDb } from './pglite-supabase.mjs';
const db = await createDb();
const id = (n) => `00000000-0000-4000-a000-0000000049${String(n).padStart(2, '0')}`;
const [A, B, C, D, E, F, G, H] = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => id(10 + n));
let passed = 0;
const ok = (v, label) => { assert.ok(v, label); passed++; console.log('PASS ' + label); };
const denied = async (call, pattern, label) => { await assert.rejects(call, pattern); passed++; console.log('PASS ' + label); };
const hours = (iso, h) => new Date(Date.parse(iso) + h * 3600 * 1000).toISOString();
const trial = (user, start, days = 7, extra = {}) => ({
  user_id: user, is_active: true, product_id: 'yearly_v2', store: 'app_store',
  expires_at: hours(start, days * 24), period_type: 'trial', period_started_at: start, will_renew: true, ...extra,
});
let seq = 0;
const apply = (changes, at) => db.query('select apply_revenuecat_event($1,$2,$3::jsonb)',
  [`evt-${++seq}`, at, JSON.stringify(changes)]);
const claim = async (now, limit) => (await db.query(
  limit === undefined ? 'select * from claim_trial_emails($1)' : 'select * from claim_trial_emails($1,$2)',
  limit === undefined ? [now] : [now, limit])).rows;
const mine = async (user, now) => {
  const rows = await claim(now);
  const ids = (await db.query('select id from private.trial_emails where user_id=$1', [user])).rows.map((r) => r.id);
  return rows.filter((r) => ids.includes(r.claim_id));
};
const result = async (claimId, outcome, now) =>
  (await db.query('select trial_email_result($1,$2,$3) r', [claimId, outcome, now])).rows[0].r;
const ledger = async (user) => (await db.query('select * from private.trial_emails where user_id=$1', [user])).rows;
const S = '2026-11-01T10:00:00Z';
const DUE = hours(S, 96);
try {
  const users = [A, B, C, D, E, F, G, H];
  await db.query(`insert into auth.users(id, email, email_confirmed_at) values ${users.map((_, i) => `($${i + 1}, 'u${i}@example.test', '2026-10-01T00:00:00Z')`).join()}`, users);
  await db.query("update profiles set display_name='Alex Rivera' where id=$1", [A]);

  // ─── timing and payload ───
  await apply([trial(A, S)], S);
  ok((await mine(A, hours(DUE, -0.25))).length === 0, 'nothing before day 5 (start + 4 days)');
  const [first] = await mine(A, DUE);
  ok(first && first.email === 'u0@example.test' && first.first_name === 'Alex' && first.timezone === 'UTC'
    && first.ends_at.toISOString() === hours(S, 168), 'day 5: one claim with the confirmed email, first name, end and timezone');
  ok(!('answer' in first) && Object.keys(first).sort().join() === 'claim_id,email,ends_at,first_name,timezone',
    'claim rows carry only the five delivery fields');
  ok((await mine(A, DUE)).length === 0 && (await mine(A, hours(DUE, 6))).length === 0,
    'while claimed (unknown outcome) it is never handed out again');
  ok(await result(first.claim_id, 'sent', hours(DUE, 0.01)) === true, 'sent result recorded');
  ok((await ledger(A))[0].status === 'sent', 'ledger row is sent');
  ok(await result(first.claim_id, 'sent', hours(DUE, 0.02)) === false
    && await result(first.claim_id, 'retry', hours(DUE, 0.02)) === false,
    'a replayed or late result does not change a finished row');
  ok((await ledger(A)).length === 1, 'a late retry does not release a sent email');
  await apply([trial(A, S, 7, { will_renew: true })], hours(S, 100));
  ok((await mine(A, hours(DUE, 5))).length === 0, 'once per trial: a refreshed snapshot does not re-arm the email');
  ok(await result(first.claim_id, 'bogus', hours(DUE, 1)) === false, 'unknown outcome is a no-op');

  // independent of the push: the push claim for the same trial does not consume the email
  await apply([trial(B, S)], S);
  const push = (await db.query('select * from due_trial_endings($1)', [DUE])).rows.filter((r) => r.user_id === B);
  ok(push.length === 1, 'push claimed for B');
  const [bMail] = await mine(B, DUE);
  ok(bMail, 'email still claimed after the push (own ledger)');
  ok((await db.query("select count(*)::int n from push_log where user_id=$1", [B])).rows[0].n === 1,
    'the email does not add to push_log (D24 cap untouched)');

  // retry: a transient failure releases the claim, a later tick in the window claims again
  ok(await result(bMail.claim_id, 'retry', hours(DUE, 0.01)) === true && (await ledger(B)).length === 0,
    'retry releases the claim');
  const [bAgain] = await mine(B, hours(DUE, 0.25));
  ok(bAgain && bAgain.claim_id !== bMail.claim_id, 'next tick claims again after a retry');
  ok(await result(bAgain.claim_id, 'rejected', hours(DUE, 0.3)) === true && (await ledger(B))[0].status === 'rejected',
    'a rejected email is final');
  ok((await mine(B, hours(DUE, 1))).length === 0, 'a rejected email is never retried');

  // window
  await apply([trial(C, S)], S);
  ok((await mine(C, hours(DUE, 24))).length === 0 && (await ledger(C)).length === 0,
    'window closes 24 h after day 5 (no late catch-up, no ledger row)');

  // quiet hours (recipient local time)
  await db.query("update profiles set timezone='Europe/Berlin' where id=$1", [D]);
  const late = '2026-11-01T22:30:00Z';
  await apply([trial(D, late)], late);
  ok((await mine(D, hours(late, 96))).length === 0, 'inside quiet hours nothing is claimed');
  const [dRow] = await mine(D, '2026-11-06T06:00:00Z');
  ok(dRow && dRow.timezone === 'Europe/Berlin', 'claimed at the first tick after quiet hours, with the profile timezone');

  // eligibility
  await apply([trial(E, S, 7, { will_renew: false })], S);
  ok((await mine(E, DUE)).length === 0, 'cancelled trial: no email');
  await apply([trial(F, S)], S);
  await db.query('update auth.users set email_confirmed_at=null where id=$1', [F]);
  ok((await mine(F, DUE)).length === 0, 'unconfirmed email: no email');
  await apply([trial(G, S)], S);
  await db.query('update auth.users set email=null where id=$1', [G]);
  ok((await mine(G, DUE)).length === 0, 'no email address: no email');
  await db.query('update auth.users set email=$2 where id=$1', [G, 'u6@example.test']);
  await apply([trial(G, S, 7, { is_active: false, expires_at: hours(S, 1) })], hours(S, 50));
  ok((await mine(G, DUE)).length === 0, 'inactive entitlement: no email');

  // limit
  await apply([trial(H, S)], S);
  await db.query('update auth.users set email_confirmed_at=now() where id=$1', [F]);
  const capped = await claim(DUE, 1);
  ok(capped.length === 1, 'p_limit caps one tick');
  ok((await claim(DUE, 0)).length === 0, 'p_limit 0 claims nothing');
  ok((await claim('infinity')).length === 0 && (await claim(null)).length === 0, 'non-finite or null clock claims nothing');

  // access
  const asRole = async (role, sql) => {
    await db.exec(`set role ${role}`);
    try { return await db.query(sql); } finally { await db.exec('reset role'); }
  };
  for (const role of ['anon', 'authenticated']) {
    await denied(asRole(role, `select * from claim_trial_emails('${DUE}')`), /permission denied/, `${role} cannot claim emails`);
    await denied(asRole(role, "select trial_email_result(gen_random_uuid(),'sent')"), /permission denied/, `${role} cannot record results`);
    await denied(asRole(role, 'select * from private.trial_emails'), /permission denied/, `${role} cannot read the ledger`);
  }
  await denied(asRole('service_role', 'select * from private.trial_emails'), /permission denied/, 'service_role cannot read the ledger directly');
  ok((await asRole('service_role', "select * from claim_trial_emails('2026-01-01T00:00:00Z')")).rows.length === 0,
    'service_role can call the claim RPC');

  // deleting the user removes their ledger rows
  await db.query('delete from auth.users where id=$1', [A]);
  ok((await ledger(A)).length === 0, 'account deletion cascades the ledger');
  console.log(`\n${passed} passed`);
} catch (e) {
  console.error('FAIL', e.message);
  process.exit(1);
}
