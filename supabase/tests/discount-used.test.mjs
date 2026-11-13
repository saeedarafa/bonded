// BE-63 (SEC-22 Low on #420): D61 "one discount per person". apply_revenuecat_event records
// premium_history.discount_seen_at when a canonical change shows an intro period (a discounted
// first year; no product ids); queue_cancel_offer, due_cancel_offers and
// open_exit_offer_at('cancel') then refuse that person (reason `discount_used`).
import assert from 'node:assert/strict';
import { createDb, defaultMigrations } from './pglite-supabase.mjs';
import { contentSql } from '../scripts/content-sql.mjs';

const db = await createDb(defaultMigrations());
await db.exec(contentSql());
let passed = 0;
const ok = (v, label) => { assert.ok(v, label); passed++; console.log('PASS ' + label); };
const id = (n) => `00000000-0000-4000-a000-0000000064${String(n).padStart(2, '0')}`;
const users = Array.from({ length: 10 }, (_, i) => id(i + 10));
const [A, B, C, D, E, F, G] = users;
const GHOST = id(99); // no profile
const as = async (uid, sql, params = []) => {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  await db.exec('set role authenticated');
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
};
const anon = async (sql, params = []) => {
  await db.exec('set role anon');
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
};
const service = async (sql, params = []) => {
  await db.exec('set role service_role');
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
};
const pair = async (a, b) => {
  const couple = (await as(a, `select create_couple('dating') c`)).rows[0].c;
  const invite = (await as(a, 'select (x).code c, (x).token t from (select create_invite() x) s')).rows[0];
  await as(b, 'select accept_invite($1, $2, true)', [invite.c, invite.t]);
  return couple;
};
let evt = 0;
const change = (uid, period_type, over = {}) => ({
  user_id: uid, is_active: true, product_id: 'any_product', store: 'app_store',
  expires_at: '2027-11-01T00:00:00Z', period_type, period_started_at: '2026-11-01T00:00:00Z',
  will_renew: true, ...over,
});
const apply = (changes, at = '2026-11-02T00:00:00Z', eventId = `evt-${++evt}`) =>
  service('select apply_revenuecat_event($1, $2, $3::jsonb)', [eventId, at, JSON.stringify(changes)]);
const seen = async (uid) =>
  (await db.query('select discount_seen_at from private.premium_history where user_id=$1', [uid])).rows[0]?.discount_seen_at ?? null;
const sub = (uid, expires, store = 'app_store') =>
  db.query(`insert into entitlements(user_id,is_active,product_id,store,expires_at,updated_at)
    values ($1,true,'yearly',$2,$3,'2026-11-01T00:00:00Z')
    on conflict (user_id) do update set is_active=true, store=excluded.store,
      expires_at=excluded.expires_at`, [uid, store, expires]);
const tips = (uid) => db.query('update notification_prefs set tips=true where user_id=$1', [uid]);
const queue = async (uid, cancelled, now) =>
  (await service('select queue_cancel_offer($1, $2, $3) q', [uid, cancelled, now])).rows[0].q;
const due = async (now) => (await service('select * from due_cancel_offers($1)', [now])).rows;
const queued = async (uid) =>
  (await db.query('select count(*)::int n from private.cancel_offer_queue where user_id=$1', [uid])).rows[0].n;
const rowOf = async (uid) =>
  (await db.query(`select * from private.exit_offers where user_id=$1 and trigger='cancel'`, [uid])).rows[0];
const openAt = async (uid, time, client = null, trigger = 'cancel') => {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  return (await db.query(`select private.open_exit_offer_at($3, $1, $2) j`, [client, time, trigger])).rows[0].j;
};
const T0 = '2027-11-20T15:00:00Z'; // second year, outside default quiet hours (profiles in UTC)
const END = '2028-11-01T00:00:00Z';

try {
  await db.query(`insert into auth.users(id) values ${users.map((_, i) => `($${i + 1})`).join()}`, users);

  // ─── grants (SEC-22 Info 2: anon too) ───
  for (const sql of ['select queue_cancel_offer($1, true)', 'select * from due_cancel_offers()']) {
    const params = sql.includes('$1') ? [A] : [];
    await assert.rejects(anon(sql, params), /permission denied/);
    passed++; console.log('PASS anon cannot call ' + sql);
    await assert.rejects(as(A, sql, params), /permission denied/);
    passed++; console.log('PASS authenticated cannot call ' + sql);
  }
  for (const sql of [
    `select private.discount_used('${A}')`,
    `select private.record_discount_seen(now(), '[]'::jsonb)`,
    'select discount_seen_at from private.premium_history',
  ]) {
    await assert.rejects(service(sql), /permission denied/);
    passed++; console.log('PASS service_role cannot run ' + sql.slice(0, 40));
  }
  await assert.rejects(anon(`select apply_revenuecat_event('x', now(), '[]'::jsonb)`), /permission denied/);
  passed++; console.log('PASS anon cannot call apply_revenuecat_event');

  // ─── recording ───
  await apply([change(A, 'intro')], '2026-11-02T00:00:00Z');
  ok(new Date(await seen(A)).toISOString() === '2026-11-02T00:00:00.000Z', 'intro period recorded as discount_seen_at (event time)');
  await apply([change(A, 'normal')], '2027-11-02T00:00:00Z');
  ok(new Date(await seen(A)).toISOString() === '2026-11-02T00:00:00.000Z', 'a later normal (second-year) period never clears it');
  await apply([change(A, 'intro')], '2027-11-03T00:00:00Z');
  ok(new Date(await seen(A)).toISOString() === '2026-11-02T00:00:00.000Z', 'first time seen is kept');
  await apply([change(B, 'trial')]);
  await apply([change(B, 'normal')], '2026-11-03T00:00:00Z');
  await apply([change(B, 'prepaid')], '2026-11-04T00:00:00Z');
  await apply([change(B, null)], '2026-11-05T00:00:00Z');
  ok(await seen(B) === null, 'trial / normal / prepaid / unknown periods are not a discount');
  ok((await db.query('select count(*)::int n from private.premium_history where user_id=$1', [B])).rows[0].n === 1,
    'premium_history row still written for them (intro eligibility unchanged)');
  // Expired intro snapshot and a stale event still prove the discount.
  await apply([change(C, 'normal')], '2026-11-10T00:00:00Z');
  await apply([change(C, 'intro', { is_active: false })], '2026-11-01T00:00:00Z');
  ok(await seen(C) !== null, 'an inactive or stale intro snapshot is recorded too');
  ok((await db.query('select is_active from entitlements where user_id=$1', [C])).rows[0].is_active === true,
    'the stale event still does not overwrite the newer entitlement');
  // Same user twice in one event, plus an unknown user: no error, no ghost row.
  await apply([change(D, 'intro'), change(D, 'intro'), change(GHOST, 'intro')]);
  ok(await seen(D) !== null, 'duplicate user in one event recorded once');
  ok((await db.query('select count(*)::int n from private.premium_history where user_id=$1', [GHOST])).rows[0].n === 0,
    'unknown user skipped');
  // Replay of the same event id: no error, nothing changes.
  await apply([change(D, 'intro')], '2026-11-02T00:00:00Z', 'evt-replay');
  await apply([change(D, 'intro')], '2026-11-02T00:00:00Z', 'evt-replay');
  ok(await seen(D) !== null, 'replayed event id is harmless');
  // Invalid input rolls the whole call back (nothing recorded).
  await assert.rejects(apply([change(E, 'intro', { is_active: null })]), /INVALID_WEBHOOK/);
  await assert.rejects(apply([change(E, 'bogus')]), /INVALID_WEBHOOK/);
  ok(await seen(E) === null && (await db.query('select count(*)::int n from private.premium_history where user_id=$1', [E])).rows[0].n === 0,
    'rejected webhook records nothing');

  // ─── refusals ───
  // A: discounted first year, now in a full-price second year with a running App Store plan.
  await pair(A, E);
  await sub(A, END);
  await tips(A);
  ok(await queue(A, true, T0) === false && await queued(A) === 0, 'queue_cancel_offer refuses a person who used a discount');
  const refused = await openAt(A, T0);
  ok(refused.eligible === false && refused.reason === 'discount_used' && refused.first_shown_at === null,
    `open_exit_offer('cancel') → discount_used (${JSON.stringify(refused)})`);
  ok(await rowOf(A) === undefined, 'refusal writes no exit-offer row');
  ok((await openAt(A, T0)).reason === 'discount_used', 'still refused on the next call');

  // Precedence: no running App Store plan → no_subscription first.
  await db.query(`update entitlements set store='play_store' where user_id=$1`, [D]);
  ok((await openAt(D, T0)).reason === 'no_subscription', 'no_subscription comes before discount_used');

  // Per person: the partner (no discount) is unaffected.
  await sub(E, END);
  await tips(E);
  ok(await queue(E, true, T0) === true, 'partner without a discount is still queued');
  const sent = await due(T0);
  ok(sent.length === 1 && sent[0].user_id === E, 'partner gets the push (per person, not per couple)');

  // Queued before the discount became known, then the intro snapshot arrives: dropped, never sent.
  await sub(F, END);
  await tips(F);
  ok(await queue(F, true, T0) === true, 'F queued (no discount known yet)');
  await apply([change(F, 'intro', { expires_at: END })], '2027-11-20T15:00:00Z');
  ok((await due(T0)).length === 0 && await queued(F) === 0, 'due_cancel_offers drops a queued person who used a discount');
  ok(await rowOf(F) === undefined, 'no push row recorded for F');

  // A push row sent before the discount was recorded stays unopened and is refused in-app.
  await sub(G, END);
  await tips(G);
  await queue(G, true, T0);
  ok((await due(T0)).length === 1, 'G got the push');
  await db.query(`insert into private.premium_history(user_id, first_seen_at, discount_seen_at)
    values ($1, $2, $2) on conflict (user_id) do update set discount_seen_at = excluded.discount_seen_at`, [G, T0]);
  const g = await openAt(G, '2027-11-20T16:00:00Z');
  ok(g.eligible === false && g.reason === 'discount_used', 'unopened push row + discount → discount_used');
  ok((await rowOf(G)).opened_at === null, 'push row stays unopened');

  // paywall_close (private path) is unchanged by the discount fact: premium wins.
  ok((await openAt(A, T0, null, 'paywall_close')).reason === 'premium', 'paywall_close reasons unchanged');

  // Unqueue still works for everyone.
  await sub(B, END);
  await tips(B);
  ok(await queue(B, true, T0) === true && await queue(B, false, T0) === false && await queued(B) === 0,
    'p_cancelled false still drops a pending row');

  console.log(`\n${passed} passed`);
} finally {
  await db.close();
}
