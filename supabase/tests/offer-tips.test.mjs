// BE-47b (lead decisions on #160): (1) `offer_ending` is promotional, so it needs the recipient's
// `notification_prefs.tips` opt-in; `trial_ending` stays transactional (no toggle).
// (2) "Once per pair" for the day-3 gift relies on couple rows that private.purge_ended_couples
// deletes 30 days after the couple ended. After unpair + purge + re-pair + a new 3-day streak the
// same two people can earn a second gift (accepted, lead option c, CONTRACTS §3); anyone who ever
// subscribed or trialled stays excluded through private.premium_history.
import assert from 'node:assert/strict';
import { createDb } from './pglite-supabase.mjs';
import { contentSql } from '../scripts/content-sql.mjs';

const db = await createDb();
await db.exec(contentSql());
let passed = 0;
const ok = (v, label) => { assert.ok(v, label); passed++; console.log('PASS ' + label); };
const id = (n) => `00000000-0000-4000-a000-0000000147${String(n).padStart(2, '0')}`;
const users = Array.from({ length: 12 }, (_, i) => id(i + 1));
const [A, B, C, D, E, F, G, H, T1] = users;
const hours = (iso, h) => new Date(Date.parse(iso) + h * 3600 * 1000).toISOString();
const as = async (uid, sql, params = []) => {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  await db.exec('set role authenticated');
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
};
const pair = async (a, b) => {
  const couple = (await as(a, `select create_couple('dating') c`)).rows[0].c;
  const invite = (await as(a, 'select (x).code c, (x).token t from (select create_invite() x) s')).rows[0];
  await as(b, 'select accept_invite($1, $2, true)', [invite.c, invite.t]);
  return couple;
};
const earn = (couple, time) =>
  db.query(`insert into badge_awards(badge_slug, couple_id, awarded_at) values ('streak-3',$1,$2)
    on conflict do nothing`, [couple, time]);
const day3 = async (couple) =>
  (await db.query(`select * from couple_offers where couple_id=$1 and kind='day3'`, [couple])).rows[0];
const open = async (uid, time) => {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  return (await db.query(`select private.open_offer_at('day3', $1) j`, [time])).rows[0].j;
};
const tips = (uid, on) => db.query('update notification_prefs set tips=$2 where user_id=$1', [uid, on]);
const due = async (couple, now) => {
  const ids = (await db.query('select user_id from couple_members where couple_id=$1 and left_at is null', [couple]))
    .rows.map((r) => r.user_id);
  return (await db.query('select * from due_offer_endings($1)', [now])).rows.filter((r) => ids.includes(r.user_id));
};
const T0 = '2026-11-20T10:00:00Z';

try {
  await db.query(`insert into auth.users(id) values ${users.map((_, i) => `($${i + 1})`).join()}`, users);

  // ─── (1) offer_ending needs the tips opt-in ───
  ok((await db.query('select bool_and(not tips) b from notification_prefs where user_id = any($1::uuid[])', [users]))
    .rows[0].b, 'tips is opt-in: off by default');
  const c1 = await pair(A, B);
  await earn(c1, T0);
  const end1 = (await open(A, hours(T0, 1))).expires_at; // ends T0 + 13 h (23:00Z)
  const DUE1 = hours(end1, -2);                           // 21:00Z, outside default quiet hours (UTC)
  ok((await due(c1, DUE1)).length === 0, 'tips off for both: no offer_ending push');
  ok((await db.query('select count(*)::int n from private.offer_reminders where couple_id=$1', [c1])).rows[0].n === 0
    && (await db.query(`select count(*)::int n from push_log where type='offer_ending' and user_id = any($1::uuid[])`,
      [[A, B]])).rows[0].n === 0, 'tips off: no ledger row and no push_log claim');
  await tips(B, true);
  const sent = await due(c1, hours(DUE1, 0.25));
  ok(sent.length === 1 && sent[0].user_id === B && sent[0].minutes_left === 105,
    'only the partner who opted in is sent (as before: same timing, minutes_left)');
  ok((await due(c1, hours(DUE1, 0.5))).length === 0, 'still once per partner after opting in');
  await tips(A, true);
  const late = await due(c1, hours(DUE1, 0.75));
  ok(late.length === 1 && late[0].user_id === A, 'opting in later inside the window still sends it at the next tick');
  await tips(A, false);
  await tips(B, false);
  ok((await due(c1, hours(DUE1, 1))).length === 0, 'opting out afterwards: nothing more (already sent once anyway)');

  const c2 = await pair(C, D);
  await tips(C, true);
  await tips(D, true);
  await earn(c2, T0);
  const end2 = (await open(D, hours(T0, 1))).expires_at;
  const both = await due(c2, hours(end2, -2));
  ok(both.length === 2 && both.every((r) => r.minutes_left === 120), 'tips on for both: both pushed 2 h before the end');

  // trial_ending stays transactional: sent with tips off
  ok(!(await db.query('select tips from notification_prefs where user_id=$1', [T1])).rows[0].tips, 'trial user has tips off');
  const S = '2026-11-01T10:00:00Z';
  await db.query(`select apply_revenuecat_event('evt-t1',$1,$2::jsonb)`, [S, JSON.stringify([{
    user_id: T1, is_active: true, product_id: 'yearly_v2', store: 'app_store', expires_at: hours(S, 168),
    period_type: 'trial', period_started_at: S, will_renew: true }])]);
  const trial = (await db.query('select * from due_trial_endings($1)', [hours(S, 96)])).rows.filter((r) => r.user_id === T1);
  ok(trial.length === 1, 'trial_ending ignores tips (transactional, no toggle)');

  // ─── (2) once per pair does not survive the 30-day purge (documented, accepted) ───
  const p1 = await pair(E, F);
  await earn(p1, T0);
  ok(await day3(p1), 'E+F earn their gift');
  await as(E, 'select unpair()');
  const ended = (await db.query('select ended_at from couples where id=$1', [p1])).rows[0].ended_at;
  const before = await pair(E, F);
  await earn(before, hours(T0, 100));
  ok(!(await day3(before)), 're-paired before the purge: no second gift (once per pair)');
  await as(E, 'select unpair()');
  const ended2 = (await db.query('select ended_at from couples where id=$1', [before])).rows[0].ended_at;
  const purgeAt = new Date(Math.max(ended.getTime(), ended2.getTime()) + 31 * 24 * 3600e3).toISOString();
  const purged = (await db.query('select private.purge_ended_couples($1) n', [purgeAt])).rows[0].n;
  ok(purged >= 2 && (await db.query('select count(*)::int n from couples where id = any($1::uuid[])', [[p1, before]]))
    .rows[0].n === 0, 'purge_ended_couples deletes both ended couples after 30 days');
  ok((await db.query(`select count(*)::int n from couple_offers where couple_id = any($1::uuid[])`, [[p1, before]]))
    .rows[0].n === 0, 'and their couple_offers rows cascade with them');
  const after = await pair(E, F);
  await earn(after, purgeAt);
  ok(await day3(after), 'after unpair + purge + re-pair + a new 3-day streak, the same pair earns a second gift (accepted, CONTRACTS §3)');

  // anyone who redeemed (or trialled) is still excluded after the purge
  const p2 = await pair(G, H);
  await earn(p2, T0);
  ok(await day3(p2), 'G+H earn their gift');
  await db.query(`insert into entitlements(user_id,is_active,product_id,expires_at,updated_at)
    values ($1,true,'day3_yearly',$2,$3)`, [G, hours(T0, 2), hours(T0, 1)]);
  await db.query('update entitlements set is_active=false, updated_at=$2 where user_id=$1', [G, hours(T0, 3)]);
  await as(G, 'select unpair()');
  const endedG = (await db.query('select ended_at from couples where id=$1', [p2])).rows[0].ended_at;
  const purgeG = new Date(endedG.getTime() + 31 * 24 * 3600e3).toISOString();
  await db.query('select private.purge_ended_couples($1)', [purgeG]);
  ok((await db.query('select count(*)::int n from couples where id=$1', [p2])).rows[0].n === 0, 'G+H couple purged');
  ok((await db.query('select count(*)::int n from private.premium_history where user_id=$1', [G])).rows[0].n === 1,
    'premium_history survives the purge (keyed on the person, not the couple)');
  const again = await pair(G, H);
  await earn(again, purgeG);
  ok(!(await day3(again)), 'a pair where someone redeemed gets no second gift even after the purge');

  console.log(`\n${passed} passed, 0 failed`);
} finally { await db.close(); }
