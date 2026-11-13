// BE-62 (c) / D61 (3): the `cancel_offer` push after a store-side cancellation, and BE-59 (c):
// `due_offer_endings` names the partner. queue_cancel_offer (webhook) → due_cancel_offers (cron)
// → open_exit_offer('cancel') (app). Once per person ever, never after the period ended, tips
// opt-in, quiet hours, D24 cap; the push-offered row bars the day-3 gift and opens the offer once.
import assert from 'node:assert/strict';
import { createDb, defaultMigrations } from './pglite-supabase.mjs';
import { contentSql } from '../scripts/content-sql.mjs';

const db = await createDb(defaultMigrations());
await db.exec(contentSql());
let passed = 0;
const ok = (v, label) => { assert.ok(v, label); passed++; console.log('PASS ' + label); };
const id = (n) => `00000000-0000-4000-a000-0000000063${String(n).padStart(2, '0')}`;
const users = Array.from({ length: 14 }, (_, i) => id(i + 10));
const [A, B, C, D, E, F, G, H, I, J, K, L, M, N] = users;
const hours = (iso, h) => new Date(Date.parse(iso) + h * 3600 * 1000).toISOString();
const as = async (uid, sql, params = []) => {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  await db.exec('set role authenticated');
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
const sub = (uid, expires, store = 'app_store', active = true) =>
  db.query(`insert into entitlements(user_id,is_active,product_id,store,expires_at,updated_at)
    values ($1,$2,'yearly',$3,$4,'2026-11-01T00:00:00Z')
    on conflict (user_id) do update set is_active=excluded.is_active, store=excluded.store,
      expires_at=excluded.expires_at`, [uid, active, store, expires]);
const tips = (uid, on = true) => db.query('update notification_prefs set tips=$2 where user_id=$1', [uid, on]);
const name = (uid, n) => db.query('update profiles set display_name=$2 where id=$1', [uid, n]);
const queue = async (uid, cancelled, now) =>
  (await service('select queue_cancel_offer($1, $2, $3) q', [uid, cancelled, now])).rows[0].q;
const due = async (now) => (await service('select * from due_cancel_offers($1)', [now])).rows;
const rowOf = async (uid) =>
  (await db.query(`select * from private.exit_offers where user_id=$1 and trigger='cancel'`, [uid])).rows[0];
const queued = async (uid) =>
  (await db.query('select count(*)::int n from private.cancel_offer_queue where user_id=$1', [uid])).rows[0].n;
const openAt = async (uid, time, client = null) => {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  return (await db.query(`select private.open_exit_offer_at('cancel', $1, $2) j`, [client, time])).rows[0].j;
};
const T0 = '2026-11-20T15:00:00Z'; // 15:00 UTC: outside default quiet hours (profiles in UTC)
const END = '2026-11-27T15:00:00Z';

try {
  await db.query(`insert into auth.users(id) values ${users.map((_, i) => `($${i + 1})`).join()}`, users);

  // ─── grants ───
  for (const sql of ['select queue_cancel_offer($1, true)', 'select * from due_cancel_offers()']) {
    const params = sql.includes('$1') ? [A] : [];
    await assert.rejects(as(A, sql, params), /permission denied/);
    passed++; console.log('PASS authenticated cannot call ' + sql);
  }
  await assert.rejects(service('select * from private.cancel_offer_queue'), /permission denied/);
  passed++; console.log('PASS service_role has no table access to the queue');

  // ─── happy path: queued, sent once, partner named, row bars repeat ───
  await pair(A, B);
  await name(B, 'Maya Rose');
  await sub(A, END);
  await tips(A);
  ok(await queue(A, true, T0) === true, 'store cancel with a running App Store subscription is queued');
  ok(await queue(A, true, T0) === false && await queued(A) === 1, 'webhook replay: still one queued row');
  const sent = await due(T0);
  ok(sent.length === 1 && sent[0].user_id === A && sent[0].partner_name === 'Maya', 'one cancel_offer claim with the partner first name');
  ok((await db.query(`select count(*)::int n from push_log where user_id=$1 and type='cancel_offer' and status='claimed'`, [A])).rows[0].n === 1,
    'push_log claim of type cancel_offer');
  const r = await rowOf(A);
  ok(r && r.source === 'push' && r.opened_at === null, 'offer recorded as push-offered, not opened yet');
  ok(await queued(A) === 0 && (await due(hours(T0, 1))).length === 0, 'never sent twice');
  ok(await queue(A, true, hours(T0, 2)) === false && await queued(A) === 0, 'a later cancel after the push is never queued again');

  // ─── app opens the screen from the push: eligible once, then ordinary rules ───
  const o1 = await openAt(A, hours(T0, 1), '00000000-0000-4000-b000-000000000001');
  ok(o1.eligible === true && o1.reason === null, 'open_exit_offer(cancel) after the push: eligible');
  ok((await rowOf(A)).opened_at !== null, 'opened_at recorded');
  const o2 = await openAt(A, hours(T0, 1), '00000000-0000-4000-b000-000000000001');
  ok(o2.eligible === true, 'same client_id retry: eligible');
  const o3 = await openAt(A, hours(T0, 30), '00000000-0000-4000-b000-000000000002');
  ok(o3.eligible === false && o3.reason === 'shown_before', 'other call later: shown_before');

  // ─── solo person: partner_name empty (function fills a fallback) ───
  await sub(C, END);
  await tips(C);
  await queue(C, true, T0);
  const solo = (await due(T0)).find((x) => x.user_id === C);
  ok(solo && solo.partner_name === '', 'solo: partner_name is empty');

  // ─── refusals ───
  await sub(D, END, 'play_store');
  await tips(D);
  ok(await queue(D, true, T0) === false, 'Play Store subscription: not queued (no Android mechanism in v1)');
  await sub(E, hours(T0, 0.5));
  await tips(E);
  ok(await queue(E, true, T0) === false, 'period ends within the hour: not queued');
  await sub(F, END, 'app_store', false);
  ok(await queue(F, true, T0) === false, 'inactive entitlement: not queued');
  ok(await queue(G, true, T0) === false, 'no entitlement: not queued');
  // In-app offer already shown: no push.
  await sub(H, END);
  await tips(H);
  ok((await openAt(H, T0)).eligible === true, 'H saw the in-app offer');
  ok(await queue(H, true, hours(T0, 1)) === false, 'in-app offer shown before: no push queued');

  // ─── tips off: kept in the queue, sent once tips are on ───
  await sub(I, END);
  ok(await queue(I, true, T0) === true, 'tips off: still queued');
  ok(!(await due(T0)).some((x) => x.user_id === I) && await queued(I) === 1, 'tips off: not sent, kept');
  await tips(I);
  ok((await due(hours(T0, 1))).some((x) => x.user_id === I), 'tips on later: sent');

  // ─── quiet hours ───
  await sub(J, END);
  await tips(J);
  await queue(J, true, T0);
  ok(!(await due('2026-11-20T23:30:00Z')).some((x) => x.user_id === J) && await queued(J) === 1, 'quiet hours: not sent, kept');
  ok((await due('2026-11-21T08:00:00Z')).some((x) => x.user_id === J), 'after quiet hours: sent');

  // ─── never after the period ended ───
  await sub(K, hours(T0, 3));
  await tips(K);
  await queue(K, true, T0);
  await db.query('update notification_prefs set tips=false where user_id=$1', [K]);
  await due(T0);
  await tips(K);
  ok((await due(hours(T0, 2.5))).every((x) => x.user_id !== K) && await queued(K) === 0, 'period about to end: dropped, never sent');
  ok(!(await rowOf(K)), 'dropped: no offer recorded');

  // ─── auto-renew back on: unqueued ───
  await sub(L, END);
  await queue(L, true, T0);
  ok(await queue(L, false, hours(T0, 1)) === false && await queued(L) === 0, 'UNCANCELLATION unqueues');

  // ─── D24 cap: released and retried ───
  await sub(M, END);
  await tips(M);
  await queue(M, true, T0);
  for (let i = 0; i < 4; i++) {
    await db.query(`insert into push_log(user_id,type,record_id,local_date,status,created_at) values ($1,'nudge',gen_random_uuid(),'2026-11-20','sent',$2)`, [M, T0]);
  }
  ok(!(await due(T0)).some((x) => x.user_id === M) && !(await rowOf(M)) && await queued(M) === 1, 'daily cap: not offered, kept for later');
  ok((await due('2026-11-21T09:00:00Z')).some((x) => x.user_id === M), 'next day: sent');

  // ─── push-offered row bars the day-3 gift (BE-62 (b)) ───
  const cp = (await db.query(`select couple_id from couple_members where user_id=$1 and left_at is null`, [A])).rows[0].couple_id;
  ok((await db.query('select private.couple_ever_premium($1) b', [cp])).rows[0].b === true, 'couple of a push-offered person counts as barred');

  // ─── account deletion cascades ───
  await sub(N, END);
  ok(await queue(N, true, T0) === true, 'N queued');
  await db.query('delete from profiles where id=$1', [N]);
  ok(await queued(N) === 0, 'queue row removed with the account');

  // ─── BE-59 (c): offer_ending names the partner ───
  const [P, Q, R2, S2] = Array.from({ length: 4 }, (_, i) => id(i + 40));
  await db.query('insert into auth.users(id) values ($1),($2),($3),($4)', [P, Q, R2, S2]);
  const giftEnding = async (a, b) => {
    const couple = await pair(a, b);
    await tips(a); await tips(b);
    await db.query(`insert into badge_awards(badge_slug, couple_id, awarded_at) values ('streak-3',$1,'2026-11-25T10:00:00Z')`, [couple]);
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [a]);
    const end = (await db.query(`select private.open_offer_at('day3', '2026-11-25T12:00:00Z') j`)).rows[0].j.expires_at;
    return (await service('select * from due_offer_endings($1)', [hours(end, -2)])).rows
      .filter((x) => x.user_id === a || x.user_id === b);
  };
  await name(P, '  Sam   Lee'); await name(Q, 'Jo');
  const ends = await giftEnding(P, Q);
  ok(ends.length === 2 && ends.find((x) => x.user_id === P).partner_name === 'Jo'
    && ends.find((x) => x.user_id === Q).partner_name === 'Sam', 'offer_ending rows carry the partner first name (BE-59 (c))');
  await name(S2, '   ');
  const blank = await giftEnding(R2, S2);
  ok(blank.find((x) => x.user_id === R2)?.partner_name === '', 'blank partner name: empty (function fills the fallback)');

  console.log(`\n${passed} passed`);
} finally {
  await db.close();
}
