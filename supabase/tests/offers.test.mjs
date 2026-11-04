// BE-17 / D28: immutable shared offer clocks, real 24 hours, server eligibility.
import assert from 'node:assert/strict';
import { createDb } from './pglite-supabase.mjs';
const db = await createDb();
let passed = 0;
const ok = (condition, label) => { assert.ok(condition, label); console.log(`PASS ${label}`); passed++; };
const A = '00000000-0000-0000-0000-000000001701';
const B = '00000000-0000-0000-0000-000000001702';
const E = '00000000-0000-0000-0000-000000001703';
const F = '00000000-0000-0000-0000-000000001704';
const G = '00000000-0000-0000-0000-000000001705';
const run = async (role, uid, sql, params = []) => {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
  await db.exec(`set role ${role}`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
};
const as = (uid, sql, params) => run('authenticated', uid, sql, params);
const denied = async (role, uid, sql, params) => {
  try { await run(role, uid, sql, params); return ''; } catch (e) { return e.message; }
};
const offer = async (uid, kind, time) => {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  return (await db.query('select private.get_offer_at($1, $2) j', [kind, time])).rows[0].j;
};
try {
  await db.exec(`insert into auth.users(id) values ('${A}'),('${B}'),('${E}'),('${F}'),('${G}')`);
  const c = (await as(A, `select create_couple('dating') c`)).rows[0].c;
  const other = (await as(E, `select create_couple('dating') c`)).rows[0].c;
  const T = '2026-03-07T17:00:00Z'; // noon before US DST starts
  ok(!(await offer(A, 'intro', T)).eligible, 'solo users do not start an offer');
  ok((await db.query('select count(*)::int n from couple_offers')).rows[0].n === 0, 'solo call leaves no claim');
  await db.query(`insert into couple_members(couple_id,user_id,joined_at) values ($1,$2,$3),($4,$5,$3)`, [c, B, T, other, F]);
  await db.query(`update couple_members set joined_at = $1 where user_id in ($2,$3)`, [T, A, E]);
  await db.query(`update couples set timezone = 'America/New_York' where id = $1`, [c]);
  for (const kind of [null, '', 'default', 'INTRO']) {
    const result = await offer(A, kind, T);
    ok(result.eligible === false && result.expires_at === null, `unsupported kind ${JSON.stringify(kind)} is ineligible`);
  }
  ok(!(await offer(A, 'winback', T)).eligible, 'winback is unavailable on pairing day');
  ok(!(await offer(A, 'winback', '2026-03-09T03:59:59Z')).eligible, 'winback unavailable before local day 3');
  const intro = await offer(A, 'intro', T);
  ok(intro.eligible && Date.parse(intro.expires_at) === Date.parse(T) + 86400000, 'intro lasts exactly 24 hours across DST');
  const partner = await offer(B, 'intro', '2026-03-07T18:00:00Z');
  ok(partner.eligible && partner.expires_at === intro.expires_at, 'partner retry shares the same expiry');
  ok((await offer(A, 'intro', '2026-03-08T16:59:59Z')).eligible, 'offer valid just before expiry');
  const exact = await offer(A, 'intro', '2026-03-08T17:00:00Z');
  ok(!exact.eligible && exact.expires_at === intro.expires_at, 'offer expires at the exact boundary');
  ok(!(await offer(B, 'intro', '2026-04-07T17:00:00Z')).eligible, 'expired offer cannot be restarted next month');
  const winback = await offer(A, 'winback', '2026-03-09T04:00:00Z');
  ok(winback.eligible, 'winback first starts at day-3 local midnight after DST change');
  ok((await offer(B, 'winback', '2026-03-10T03:59:59Z')).expires_at === winback.expires_at, 'winback partner retry never extends the clock');
  ok(!(await offer(A, 'winback', '2026-03-10T04:00:00Z')).eligible, 'winback expiry is final');
  // A later first read must not resurrect a day-3 winback.
  ok(!(await offer(E, 'winback', '2026-03-10T17:00:00Z')).eligible, 'first winback read after day 3 remains ineligible');
  const lateWinback = await offer(E, 'winback', '2026-03-09T23:59:00Z');
  ok(lateWinback.eligible, 'day-3 first display can start near local midnight');
  const nextDay = await offer(F, 'winback', '2026-03-10T12:00:00Z');
  ok(nextDay.eligible && nextDay.expires_at === lateWinback.expires_at, 'existing winback remains eligible on day 4 within its original 24 hours');
  ok(!(await offer(E, 'winback', '2026-03-10T23:59:00Z')).eligible, 'late-started winback expires after exactly 24 hours');
  await db.query(`insert into entitlements(user_id,is_active,expires_at) values ($1,true,$2)`, [B, '2026-03-07T18:00:00Z']);
  const premium = await offer(A, 'intro', T);
  ok(!premium.eligible && premium.expires_at === intro.expires_at, 'premium partner suppresses eligibility without changing expiry');
  ok((await offer(A, 'intro', '2026-03-07T18:00:00Z')).eligible, 'entitlement expiration boundary restores remaining offer time only');
  await db.query(`insert into entitlements(user_id,is_active) values ($1,true)`, [F]);
  ok(!(await offer(E, 'intro', T)).eligible, 'currently premium couples cannot claim intro');
  ok((await db.query('select count(*)::int n from couple_offers where couple_id=$1', [other])).rows[0].n === 1, 'premium denial consumes no intro offer');
  await db.query(`update entitlements set is_active=false where user_id=$1`, [F]);
  ok((await offer(E, 'intro', T)).eligible, 'inactive entitlement does not suppress intro');
  ok((await as(A, 'select * from couple_offers')).rows.length === 2, 'members can read only their own two clocks');
  ok((await as(B, 'select * from couple_offers')).rows.length === 2, 'both partners see the shared clocks');
  ok((await as(E, 'select * from couple_offers where couple_id=$1', [c])).rows.length === 0, 'another couple cannot read the clocks');
  for (const sql of [
    `insert into couple_offers values ('${c}', 'intro', now(), now()+interval '24 hours')`,
    `update couple_offers set expires_at=expires_at+interval '24 hours'`,
    'delete from couple_offers',
  ]) ok(/permission denied/.test(await denied('authenticated', A, sql)), 'clients cannot create, extend or delete clocks');
  ok(/permission denied/.test(await denied('anon', null, 'select * from couple_offers')), 'anon cannot read offer clocks');
  ok(/permission denied/.test(await denied('anon', null, `select get_offer('intro')`)), 'anon cannot call the RPC');
  ok(await denied('authenticated', null, `select get_offer('intro')`) === 'NOT_AUTHENTICATED', 'JWT subject required');
  for (const role of ['authenticated', 'anon', 'service_role']) {
    ok(/permission denied/.test(await denied(role, A, `select private.get_offer_at('intro', now())`)), `${role} cannot set the eligibility clock`);
  }
  ok(!(await as(A, `select get_offer('unsupported') j`)).rows[0].j.eligible, 'public wrapper rejects unsupported offerings');
  ok(await denied('authenticated', G, `select get_offer('intro')`) === 'NOT_PAIRED', 'unpaired account cannot use offer RPC');
  // A former member's perpetual premium does not affect the remaining current members.
  await db.query(`update couple_members set left_at='2026-03-07T16:00:00Z' where user_id=$1`, [B]);
  await db.query(`update entitlements set expires_at=null where user_id=$1`, [B]);
  ok(!(await offer(A, 'intro', T)).eligible, 'solo-after-departure is ineligible even with an existing clock');
  ok((await as(B, 'select * from couple_offers')).rows.length === 0, 'former member cannot read clocks');
  ok(await denied('authenticated', B, `select get_offer('intro')`) === 'NOT_PAIRED', 'former member cannot use offer RPC');
  await db.query(`update couple_members set couple_id=$1 where user_id=$2`, [other, B]);
  ok((await offer(E, 'intro', T)).eligible, 'departed premium member does not suppress old couple offers');
  await db.query(`update couples set status='ended', ended_at=now() where id=$1`, [c]);
  ok(await denied('authenticated', A, `select get_offer('intro')`) === 'NOT_PAIRED', 'ended couple cannot use offer RPC');
  ok((await as(A, 'select * from couple_offers')).rows.length === 0, 'ended clocks are not client-readable');
  await db.query('delete from couples where id=$1', [c]);
  ok((await db.query('select count(*)::int n from couple_offers where couple_id=$1', [c])).rows[0].n === 0, 'offer clocks cascade on couple purge');
  console.log(`\n${passed} passed, 0 failed`);
} finally { await db.close(); }
