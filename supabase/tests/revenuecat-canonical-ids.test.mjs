// BE-48c (#167): apply_revenuecat_event only accepts canonical lower-case uid text, so an
// upper-case (or otherwise non-canonical) spelling can never overwrite a real account's row.
import assert from 'node:assert/strict';
import { createDb } from './pglite-supabase.mjs';

const db = await createDb();
let passed = 0;
const ok = (v, label) => { assert.ok(v, label); passed++; console.log('PASS ' + label); };
const A = '00000000-0000-4000-a000-0000000ca5e1';
const B = '00000000-0000-4000-a000-0000000ca5e2';
const paid = (id) => ({ user_id: id, is_active: true, product_id: 'yearly', store: 'app_store',
  expires_at: '2099-01-01T00:00:00Z' });
const empty = (id) => ({ user_id: id, is_active: false, product_id: null, store: null, expires_at: null });
const apply = (evt, time, changes) =>
  db.query('select apply_revenuecat_event($1,$2,$3::jsonb)', [evt, time, JSON.stringify(changes)]);
const row = async (id) => (await db.query('select * from entitlements where user_id=$1', [id])).rows[0];
const events = async (evt) =>
  (await db.query('select count(*)::int n from private.revenuecat_events where event_id=$1', [evt])).rows[0].n;

try {
  await db.query('insert into auth.users(id) values($1),($2)', [A, B]);
  await apply('paid', '2026-11-11T10:00:00Z', [paid(A), paid(B)]);
  ok((await row(A)).is_active && (await row(B)).is_active, 'canonical lower-case ids are written');
  const before = await row(A);

  const variants = [
    ['upper case', A.toUpperCase()],
    ['mixed case', A.slice(0, 30) + A.slice(30).toUpperCase()],
    ['braces', `{${A}}`],
    ['no hyphens', A.replaceAll('-', '')],
    ['surrounding space', ` ${A}`],
  ];
  for (const [label, id] of variants) {
    const evt = `variant-${label}`;
    await assert.rejects(apply(evt, '2026-11-11T11:00:00Z', [empty(id)]), /INVALID_WEBHOOK/);
    assert.deepEqual(await row(A), before);
    ok((await events(evt)) === 0, `${label} spelling is rejected: no write, event id not consumed`);
  }
  // A TRANSFER-shaped batch with one non-canonical id is rejected as a whole (nothing partial).
  await assert.rejects(apply('transfer-mixed', '2026-11-11T11:00:00Z',
    [empty(B), empty(A.toUpperCase())]), /INVALID_WEBHOOK/);
  ok((await row(B)).is_active && (await row(A)).is_active,
    'a batch with one non-canonical id writes nothing, not even the canonical one');
  for (const bad of [[{ user_id: 42, is_active: false }], [null], ['x']]) {
    await assert.rejects(apply('bad-' + JSON.stringify(bad), '2026-11-11T11:00:00Z', bad), /INVALID_WEBHOOK/);
    passed++; console.log('PASS non-string user_id / non-object change rejected: ' + JSON.stringify(bad));
  }
  await apply('expire', '2026-11-11T12:00:00Z', [empty(A)]);
  ok(!(await row(A)).is_active && (await row(B)).is_active, 'the canonical spelling still applies normally');

  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    try {
      await assert.rejects(apply('denied-' + role, '2026-11-11T13:00:00Z', [paid(A)]), /permission denied/);
      passed++; console.log(`PASS ${role} cannot call apply_revenuecat_event`);
    } finally { await db.exec('reset role'); }
  }
  const def = (await db.query(`select p.prosecdef, p.proconfig from pg_proc p join pg_namespace n
    on n.oid=p.pronamespace where n.nspname='public' and p.proname='apply_revenuecat_event'`)).rows[0];
  ok(def.prosecdef && def.proconfig.some((c) => c.startsWith('search_path=')),
    'wrapper is security definer with a fixed search_path');
  console.log(`\n${passed} passed, 0 failed`);
} finally { await db.close(); }
