// BE-48b (SEC-10 optional hardening): global per-minute cap (120 / UTC minute) on
// claim_revenuecat_sync on top of the per-user 30 s limit, and why the webhook now stamps its write
// with max(event time, lookup time).
import assert from 'node:assert/strict';
import { createDb } from './pglite-supabase.mjs';

const db = await createDb();
let passed = 0;
const ok = (v, label) => { assert.ok(v, label); passed++; console.log('PASS ' + label); };
const id = (n) => `00000000-0000-4000-a000-00000148${String(n).padStart(4, '0')}`;
const users = Array.from({ length: 130 }, (_, i) => id(i + 1));
const at = (iso, s) => new Date(Date.parse(iso) + s * 1000).toISOString();
const claim = async (user, time) =>
  (await db.query('select claim_revenuecat_sync($1,$2) ok', [user, time])).rows[0].ok;
const M = '2026-11-11T12:00:00Z';

try {
  await db.query(`insert into auth.users(id) select unnest($1::uuid[])`, [users]);

  // fill 119 of the 120 slots of minute M with distinct users
  let granted = 0;
  for (const u of users.slice(0, 119)) granted += (await claim(u, at(M, 1))) ? 1 : 0;
  ok(granted === 119, '119 different users in one minute are all allowed');
  ok(!(await claim(users[0], at(M, 10))), 'a user refused by its own 30 s limit ...');
  ok(await claim(users[119], at(M, 20)), '... does not use a global slot (the 120th user still gets one)');
  ok(!(await claim(users[120], at(M, 59))), 'the 121st lookup in the same UTC minute is refused');
  ok((await db.query('select calls from private.revenuecat_sync_minutes where minute=$1', [M])).rows[0].calls === 120,
    'the counter stops at the cap');
  ok(await claim(users[120], at(M, 60)),
    'a globally refused user may retry in the next minute (its own 30 s slot was not used)');
  ok(await claim(users[0], at(M, 61)), 'per-user limit unchanged: allowed again after 30 s');

  // pruning: only the last hour of counters is kept; no user ids stored
  await claim(users[121], at(M, 2 * 3600));
  const minutes = (await db.query('select minute from private.revenuecat_sync_minutes order by minute')).rows;
  ok(minutes.length === 1 && minutes[0].minute.toISOString() === at(M, 2 * 3600),
    'counters older than an hour are pruned at the first claim of a new minute');
  const cols = (await db.query(`select column_name from information_schema.columns
    where table_schema='private' and table_name='revenuecat_sync_minutes' order by 1`)).rows.map((r) => r.column_name);
  ok(JSON.stringify(cols) === '["calls","minute"]', 'the global counter stores no user ids');
  ok(!(await claim(null, M)) && !(await claim(users[122], 'infinity')), 'null user or non-finite time is refused');

  // ordering: a sync (stamped with its lookup time) then a late refund webhook
  const U = users[129];
  const apply = (evt, time, active) => db.query('select apply_revenuecat_event($1,$2,$3::jsonb)', [evt, time,
    JSON.stringify([{ user_id: U, is_active: active, product_id: active ? 'yearly' : null,
      store: active ? 'app_store' : null, expires_at: active ? '2027-11-20T12:00:00Z' : null }])]);
  const active = async () => (await db.query('select is_active from entitlements where user_id=$1', [U])).rows[0].is_active;
  const SYNC = '2026-11-20T12:00:00Z';
  await apply(`sync:${U}:1`, SYNC, true);
  await apply('evt-refund-old-stamp', at(SYNC, -10), false);
  ok(await active(), 'stamped with its event time (10 s before the sync), a late refund is dropped as stale');
  await apply('evt-refund', at(SYNC, 60), false);
  ok(!(await active()), 'stamped with its later lookup time (BE-48b webhook), the refund lands');

  // access
  for (const role of ['anon', 'authenticated', 'service_role']) {
    await db.exec(`set role ${role}`);
    try {
      await assert.rejects(db.query('select * from private.revenuecat_sync_minutes'), /permission denied/);
      passed++; console.log(`PASS ${role} cannot read the global counter`);
    } finally { await db.exec('reset role'); }
  }
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    try {
      await assert.rejects(db.query('select claim_revenuecat_sync($1)', [users[0]]), /permission denied/);
      passed++; console.log(`PASS ${role} cannot call claim_revenuecat_sync`);
    } finally { await db.exec('reset role'); }
  }
  console.log(`\n${passed} passed, 0 failed`);
} finally { await db.close(); }
