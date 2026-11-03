// BE-26 / D02: typed codes wait for the inviter; valid link tokens pair immediately.
import { createDb } from './pglite-supabase.mjs';

const db = await createDb();
let failed = 0, passed = 0;
const ok = (value, label) => { console.log(`${value ? 'PASS' : 'FAIL'} ${label}`); if (value) passed++; else failed++; };
const U = n => `00000000-0000-0000-0000-0000000007${n}`;
const [MAYA, SAM, EVE, ZOE, KAI, ANA, BEN, CAL, DOT, FIN, GIL, HAL, IDA] = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13'].map(U);
await db.exec(`insert into auth.users (id) values ${[MAYA, SAM, EVE, ZOE, KAI, ANA, BEN, CAL, DOT, FIN, GIL, HAL, IDA].map(id => `('${id}')`).join(', ')};`);
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

// ── A pending requester is not a member: no answers, no questions (lead review #41, item 2) ──
await as(ANA, `select create_couple('dating', '{}', null)`);
const anaInv = await invite(ANA, T0);
const anaCouple = (await db.query('select couple_id c from pair_invites where code = $1 and inviter_id = $2', [anaInv.code, ANA])).rows[0].c;
await db.exec(`insert into questions (body, sort_order) values ('JR-Q1', 1)`);
const cq = (await db.query(`insert into couple_questions (couple_id, question_id, source, assigned_for) select $1, id, 'daily', '2026-12-10' from questions where body = 'JR-Q1' returning id`, [anaCouple])).rows[0].id;
const benReq = (await core(BEN, 'accept_invite_at', [anaInv.code, null, T0])).rows[0].result;
ok(benReq.status === 'pending', 'typed code: pending request for the answer test');
let denied = null;
try { await as(BEN, 'insert into answers (couple_question_id, user_id, body) values ($1, $2, $3)', [cq, BEN, 'JR-PENDING']); } catch (e) { denied = e.message; }
ok(/row-level security/.test(denied ?? ''), 'a pending requester cannot answer the couple\'s question');
ok((await as(BEN, 'select * from couple_questions where couple_id = $1', [anaCouple])).rows.length === 0, 'a pending requester cannot read the couple\'s questions');

// ── Approval completes exactly the request's invite (no pairing into a reissued code) ──
await as(CAL, `select create_couple('dating', '{}', null)`);
const calOld = await invite(CAL, T0);
const calReq = (await core(DOT, 'accept_invite_at', [calOld.code, null, T0])).rows[0].result;
await invite(CAL, '2026-12-10T10:01:00Z'); // a new code revokes the old invite
await as(FIN, `select create_couple('dating', '{}', null)`);
const finInv = await invite(FIN, '2026-12-10T10:02:00Z');
// Reissue the old digits to Fin's live invite (what a later random draw may do).
await db.query('update pair_invites set code = $1 where code = $2 and inviter_id = $3', [calOld.code, finInv.code, FIN]);
const voided = (await core(CAL, 'approve_join_at', [calReq.request_id, '2026-12-10T10:03:00Z'])).rows[0].result;
ok(voided.message === 'JOIN_REQUEST_EXPIRED', 'approving after the invite was revoked → JOIN_REQUEST_EXPIRED');
ok((await db.query('select count(*)::int n from couple_members where user_id = $1 and couple_id = (select couple_id from pair_invites where inviter_id = $2 and revoked_at is null)', [DOT, FIN])).rows[0].n === 0, '... and the requester is not paired into the reissued code');
ok((await db.query('select status from join_requests where id = $1', [calReq.request_id])).rows[0].status === 'expired', '... and the request is void');
let mismatch = null;
const anaInviteId = (await db.query('select id from pair_invites where inviter_id = $1', [ANA])).rows[0].id;
try { await core(DOT, 'accept_invite_at', [calOld.code, null, '2026-12-10T10:04:00Z', anaInviteId]); } catch (e) { mismatch = e.message; }
ok(mismatch === 'JOIN_REQUEST_EXPIRED', 'core: an approval for another invite than the one the code resolves to is refused');

// ── BE-28: any link token of the invite pairs at once; only a typed code without a token waits ──
// invite_link (BE-28) is on main: this block must always run, never skip.
ok((await db.query(`select to_regprocedure('public.invite_link()') is not null h`)).rows[0].h, 'BE-28: public.invite_link() exists');
{
  await as(GIL, `select create_couple('dating', '{}', null)`);
  const gilInv = await invite(GIL, T0);
  await db.exec(`select set_config('request.jwt.claim.sub', '${GIL}', false);`);
  const extraToken = (await db.query(`select (x).token t from (select private.invite_link_at($1::timestamptz) x) s`, ['2026-12-10T10:01:00Z'])).rows[0].t;
  const typedFirst = (await core(HAL, 'accept_invite_at', [gilInv.code, null, '2026-12-10T10:02:00Z'])).rows[0].result;
  ok(typedFirst.status === 'pending', 'BE-28: typed code without a token still waits for approval');
  const viaLink = (await core(IDA, 'accept_invite_at', [gilInv.code, extraToken, '2026-12-10T10:03:00Z'])).rows[0].result;
  ok(typeof viaLink === 'string' && viaLink.length > 0, 'BE-28: an invite_link token pairs at once');
}

console.log(`\n${passed} passed, ${failed} failed`);
await db.close();
if (failed) process.exitCode = 1;
