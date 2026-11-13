// BE-62 (a) / D61: `open_exit_offer('paywall_close')` is retired (raises OFFER_RETIRED, writes
// nothing, keeps old rows); `cancel` still works.
import assert from 'node:assert/strict';
import { createDb, defaultMigrations } from './pglite-supabase.mjs';
import { contentSql } from '../scripts/content-sql.mjs';

const db = await createDb(defaultMigrations());
await db.exec(contentSql());
let passed = 0;
const ok = (v, label) => { assert.ok(v, label); passed++; console.log('PASS ' + label); };
const A = '00000000-0000-4000-a000-000000006201';
const B = '00000000-0000-4000-a000-000000006202';
const run = async (uid, sql, params = []) => {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
  await db.exec('set role authenticated');
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
};
const fails = async (uid, sql, params) => {
  try { await run(uid, sql, params); return ''; } catch (e) { return e.message; }
};
const rows = async (uid) =>
  (await db.query(`select trigger from private.exit_offers where user_id=$1 order by trigger`, [uid])).rows.map(r => r.trigger);

try {
  await db.query(`insert into auth.users(id) values ($1), ($2)`, [A, B]);
  ok(await fails(A, `select open_exit_offer('paywall_close')`) === 'OFFER_RETIRED',
    'paywall_close raises OFFER_RETIRED');
  ok(await fails(A, `select open_exit_offer('paywall_close', '11111111-1111-4111-8111-111111111111')`) === 'OFFER_RETIRED',
    'paywall_close with a client id raises OFFER_RETIRED too');
  ok((await rows(A)).length === 0, 'a refused paywall_close writes no exit_offers row');
  ok((await db.query(`select count(*)::int n from private.offer_screens where user_id=$1`, [A])).rows[0].n === 0,
    'a refused paywall_close takes no daily offer slot');
  ok(await fails(null, `select open_exit_offer('paywall_close')`) === 'NOT_AUTHENTICATED',
    'no session: NOT_AUTHENTICATED first');
  // Old history rows stay valid (the constraint keeps the value).
  await db.query(`insert into private.exit_offers(user_id, trigger, first_shown_at) values ($1, 'paywall_close', '2026-11-12T10:00:00Z')`, [B]);
  ok((await rows(B)).join() === 'paywall_close', 'existing paywall_close history rows are kept');
  const c = (await run(A, `select open_exit_offer('cancel') j`)).rows[0].j;
  ok(c.eligible === false && c.reason === 'no_subscription', 'cancel trigger still works (no_subscription without an App Store entitlement)');
  const u = (await run(A, `select open_exit_offer('other') j`)).rows[0].j;
  ok(u.eligible === false && u.reason === 'unknown_trigger', 'unknown trigger still returns unknown_trigger');
  console.log(`\n${passed} passed`);
} finally {
  await db.close();
}
