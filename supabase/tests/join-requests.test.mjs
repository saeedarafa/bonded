// BE-26 / D02: typed codes wait for the inviter; valid link tokens pair immediately.
import { createDb } from './pglite-supabase.mjs';

const db = await createDb();
let failed = 0;
const ok = (value, label) => { console.log(`${value ? 'PASS' : 'FAIL'} ${label}`); if (!value) failed++; };
const U = n => `00000000-0000-0000-0000-0000000007${n}`;
const [MAYA, SAM, EVE, ZOE, KAI] = ['01', '02', '03', '04', '05'].map(U);
await db.exec(`insert into auth.users (id) values ${[MAYA, SAM, EVE, ZOE, KAI].map(id => `('${id}')`).join(', ')};`);
const as = async (id, sql, params = []) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${id}', false);`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
};
const core = async (id, fn, params) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${id}', false);`);
  return db.query(`select private.${fn}(${params.map((_, i) => `$${i + 1}`).join(', ')}) result`, params);
};
const invite = async (id, at) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${id}', false);`);
  return (await db.query(`select (x).code, (x).token from (select private.create_invite_at($1::timestamptz) x) s`, [at])).rows[0];
};

const T0 = '2026-12-10T10:00:00Z';
await as(MAYA, `select create_couple('dating', '{}', null)`);
const typed = await invite(MAYA, T0);
const pending = (await core(SAM, 'accept_invite_at', [typed.code, null, T0])).rows[0].result;
ok(pending.status === 'pending' && pending.request_id, 'typed code returns a pending request');
ok((await db.query('select count(*)::int n from couple_members where couple_id = (select couple_id from pair_invites where code = $1)', [typed.code])).rows[0].n === 1, 'typed code does not pair immediately');
ok((await as(SAM, 'select * from join_requests')).rows.length === 1, 'requester can read their request');
ok((await as(MAYA, 'select * from join_requests')).rows.length === 1, 'inviter can read the request');
ok((await as(EVE, 'select * from join_requests')).rows.length === 0, 'outsider cannot read requests');
ok((await core(SAM, 'accept_invite_at', [typed.code, null, '2026-12-10T10:01:00Z'])).rows[0].result.request_id === pending.request_id, 'typed retry is idempotent');
try { await as(EVE, 'select approve_join($1)', [pending.request_id]); ok(false, 'outsider cannot approve'); } catch (e) { ok(e.message === 'JOIN_REQUEST_FORBIDDEN', 'outsider cannot approve'); }
const approved = (await core(MAYA, 'approve_join_at', [pending.request_id, '2026-12-10T10:02:00Z'])).rows[0].result;
ok(typeof approved === 'string' && approved.length > 0, 'inviter approval completes pairing');
ok((await db.query('select status from join_requests where id = $1', [pending.request_id])).rows[0].status === 'approved', 'approved request is recorded');

await as(ZOE, `select create_couple('dating', '{}', null)`);
const link = await invite(ZOE, T0);
const immediate = (await core(EVE, 'accept_invite_at', [link.code, link.token, T0])).rows[0].result;
ok(typeof immediate === 'string' && immediate.length > 0, 'valid link token pairs immediately');

await as(ZOE, 'select unpair()');
await as(ZOE, `select create_couple('dating', '{}', null)`);
const expiring = await invite(ZOE, T0);
const expiringRequest = (await core(KAI, 'accept_invite_at', [expiring.code, null, T0])).rows[0].result;
const expired = (await core(ZOE, 'decline_join_at', [expiringRequest.request_id, '2026-12-10T10:16:00Z'])).rows[0].result;
ok(expired.message === 'JOIN_REQUEST_EXPIRED', 'expired request returns its documented error body');
ok((await db.query(`select status from join_requests where id = $1`, [expiringRequest.request_id])).rows[0].status === 'expired', 'expiry is persisted');
ok((await db.query(`select count(*)::int n from private.invite_attempts where actor = $1`, [`u:${KAI}`])).rows[0].n === 1, 'expiry counts once as a failed attempt');

await db.close();
if (failed) process.exitCode = 1;
