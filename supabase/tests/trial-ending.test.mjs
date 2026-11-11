// BE-48 / D50 (4): trial metadata from the canonical RevenueCat snapshot and the day-5
// `trial_ending` claim (quiet hours, D24 four/day cap, once per trial), plus the sync rate limit.
import assert from 'node:assert/strict';
import { createDb } from './pglite-supabase.mjs';
const db = await createDb();
const id = (n) => `00000000-0000-4000-a000-0000000048${String(n).padStart(2, '0')}`;
const [A, B, C, D, E, F, G, H, GONE] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => id(10 + n));
let passed = 0;
const ok = (v, label) => { assert.ok(v, label); passed++; console.log('PASS ' + label); };
const denied = async (call, pattern, label) => { await assert.rejects(call, pattern); passed++; console.log('PASS ' + label); };
const hours = (iso, h) => new Date(Date.parse(iso) + h * 3600 * 1000).toISOString();
const trial = (user, start, days = 7, extra = {}) => ({
  user_id: user, is_active: true, product_id: 'yearly_trial', store: 'app_store',
  expires_at: hours(start, days * 24), period_type: 'trial', period_started_at: start, will_renew: true, ...extra,
});
let seq = 0;
const apply = (changes, at) => db.query('select apply_revenuecat_event($1,$2,$3::jsonb)',
  [`evt-${++seq}`, at, JSON.stringify(changes)]);
const due = async (now) => (await db.query('select * from due_trial_endings($1)', [now])).rows;
const mine = async (user, now) => (await due(now)).filter((r) => r.user_id === user);
const trialRow = async (user) => (await db.query('select * from private.subscription_trials where user_id=$1', [user])).rows[0];
const S = '2026-11-01T10:00:00Z'; // trial start (UTC users: 10:00 local)
const DUE = hours(S, 96);         // day 5 = start + 4 days
try {
  await db.query(`insert into auth.users(id) values ${[A, B, C, D, E, F, G, H, GONE].map((_, i) => `($${i + 1})`).join()}`,
    [A, B, C, D, E, F, G, H, GONE]);
  await db.query('delete from auth.users where id=$1', [GONE]);

  // ─── trial state written from the canonical snapshot ───
  await apply([trial(A, S)], S);
  const a = await trialRow(A);
  ok(a && a.started_at.toISOString() === new Date(S).toISOString() && a.ends_at.toISOString() === hours(S, 168)
    && a.will_renew === true, 'trial start/end/renewal stored privately from the change');
  await apply([trial(GONE, S)], S);
  ok(!(await trialRow(GONE)), 'unknown/deleted user gets no trial row (no resurrection)');
  await apply([trial(A, S, 7, { will_renew: false })], '2026-10-31T00:00:00Z');
  ok((await trialRow(A)).will_renew === true, 'an older (stale) event does not touch the trial state');
  await denied(apply([trial(A, S, 7, { period_type: 'TRIAL' })], hours(S, 1)), /INVALID_WEBHOOK/, 'unknown period_type is rejected');
  await denied(apply([trial(A, S, 7, { period_started_at: 'infinity' })], hours(S, 1)), /INVALID_WEBHOOK/, 'non-finite period start is rejected');

  // ─── timing ───
  ok((await mine(A, hours(DUE, -0.25))).length === 0, 'nothing before day 5 (start + 4 days)');
  const [first] = await mine(A, DUE);
  ok(first?.user_id === A && first.days_left === 3, 'day 5 at the trial start time: one claim, days_left 3');
  const log = (await db.query("select * from push_log where user_id=$1 and type='trial_ending'", [A])).rows;
  ok(log.length === 1 && log[0].id === first.claim_id && log[0].status === 'claimed', 'claim recorded in push_log (no text)');
  ok((await mine(A, DUE)).length === 0 && (await mine(A, hours(DUE, 0.25))).length === 0 && (await mine(A, hours(DUE, 12))).length === 0,
    'once per trial: retries and later ticks do not claim again');
  await apply([trial(A, S, 7, { will_renew: true })], hours(S, 100));
  ok((await mine(A, hours(DUE, 5))).length === 0, 'a refreshed snapshot of the same trial does not re-arm the reminder');

  // window end: a trial whose day-5 instant passed more than 24 h ago gets nothing
  await apply([trial(B, S)], S);
  ok((await mine(B, hours(DUE, 24))).length === 0, 'window closes 24 h after day 5 (no late catch-up)');
  ok((await db.query('select count(*)::int n from private.trial_reminders where user_id=$1', [B])).rows[0].n === 0,
    'no ledger row when nothing was sent');

  // quiet hours: Berlin user whose trial started at 23:30 local → day 5 falls inside 23:00–07:00
  await db.query("update profiles set timezone='Europe/Berlin' where id=$1", [C]);
  const late = '2026-11-01T22:30:00Z'; // 23:30 Berlin (UTC+1): inside default quiet hours
  await apply([trial(C, late)], late);
  const cDue = hours(late, 96);
  ok((await mine(C, cDue)).length === 0 && (await mine(C, hours(cDue, 5))).length === 0,
    'inside the recipient\'s quiet hours (23:00–07:00 local) nothing is sent or consumed');
  const morning = '2026-11-06T06:00:00Z'; // 07:00 Berlin
  ok((await mine(C, hours(morning, -0.25))).length === 0 && (await mine(C, morning)).length === 1,
    'sent at the first tick after quiet hours end, still inside the window');

  // custom quiet hours are honoured
  await db.query("update notification_prefs set quiet_start='09:00', quiet_end='12:00' where user_id=$1", [D]);
  await apply([trial(D, S)], S);
  ok((await mine(D, DUE)).length === 0 && (await mine(D, '2026-11-05T12:00:00Z')).length === 1,
    'the recipient\'s own quiet window applies');

  // D24 cap: four pushes already today → released and retried next tick in the window
  await apply([trial(E, '2026-11-01T20:00:00Z')], '2026-11-01T20:00:00Z');
  const eDue = '2026-11-05T20:00:00Z';
  await db.query(`insert into push_log(user_id,type,record_id,local_date,created_at)
    select $1,'nudge',gen_random_uuid(),'2026-11-05',$2 from generate_series(1,4)`, [E, eDue]);
  ok((await mine(E, eDue)).length === 0, 'four pushes already today: the D24 cap blocks the reminder');
  ok((await db.query('select count(*)::int n from private.trial_reminders where user_id=$1', [E])).rows[0].n === 0,
    'a cap-blocked claim releases the ledger row');
  ok((await mine(E, '2026-11-05T22:45:00Z')).length === 0, 'still capped later the same local day');
  ok((await mine(E, '2026-11-06T07:00:00Z')).length === 1, 'next local day (inside the 24 h window) it is sent');
  ok((await db.query("select count(*)::int n from push_log where user_id=$1 and local_date='2026-11-06'", [E])).rows[0].n === 1,
    'the reminder counts toward the next day\'s cap');

  // cancelled trial, expiry, conversion
  await apply([trial(F, S, 7, { will_renew: false })], S);
  ok((await mine(F, DUE)).length === 0, 'a cancelled trial (will not convert) gets no reminder');
  await apply([trial(G, S)], S);
  await apply([{ user_id: G, is_active: false, product_id: null, store: null, expires_at: null }], hours(S, 50));
  ok(!(await trialRow(G)) && (await mine(G, DUE)).length === 0, 'expiration/refund deletes the trial state');
  await apply([trial(H, S)], S);
  await apply([{ ...trial(H, S), period_type: 'normal' }], hours(S, 60));
  ok(!(await trialRow(H)), 'a non-trial period (converted) deletes the trial state');
  await apply([trial(H, S, 3)], hours(S, 80));
  ok((await mine(H, hours(S, 23.75))).length === 0 && (await mine(H, hours(S, 24))).length === 1,
    'a shorter (3-day) trial is reminded 2 days before it ends');

  // the entitlement itself must still be active and unexpired
  await db.query('delete from private.trial_reminders');
  await db.query("update entitlements set expires_at=$2 where user_id=$1", [A, hours(DUE, -1)]);
  ok((await mine(A, DUE)).length === 0, 'an expired entitlement row blocks the reminder');

  // ─── access ───
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    try {
      await denied(db.query('select * from due_trial_endings(now())'), /permission denied/, `${role} cannot claim trial reminders`);
      await denied(db.query('select claim_revenuecat_sync($1)', [A]), /permission denied/, `${role} cannot touch the sync limit`);
      await denied(db.query('select * from private.subscription_trials'), /permission denied/, `${role} cannot read trial state`);
    } finally { await db.exec('reset role'); }
  }

  // ─── sync rate limit ───
  const T = '2026-11-11T12:00:00Z';
  const claim = async (user, at) => (await db.query('select claim_revenuecat_sync($1,$2) ok', [user, at])).rows[0].ok;
  ok(await claim(A, T), 'first sync is allowed');
  ok(!(await claim(A, hours(T, 29 / 3600))), 'a second sync within 30 s is refused');
  ok(await claim(A, hours(T, 30 / 3600)), 'allowed again after 30 s');
  ok(!(await claim(GONE, T)) && !(await claim(null, T)), 'unknown user or null is refused');

  // ─── deletion ───
  await db.query('delete from auth.users where id=$1', [C]);
  ok((await db.query('select count(*)::int n from private.subscription_trials where user_id=$1', [C])).rows[0].n === 0
    && (await db.query('select count(*)::int n from private.trial_reminders where user_id=$1', [C])).rows[0].n === 0,
    'account deletion removes trial state and reminder ledger');
  console.log(`${passed} passed, 0 failed`);
} finally { await db.close(); }
