// BE-35/D37: only explicit requester consent may archive the exact current solo space.
import assert from 'node:assert/strict';
import { createDb } from './pglite-supabase.mjs';
const db = await createDb();
let passed = 0;
const check = (value, label) => { assert.ok(value, label); console.log(`PASS ${label}`); passed++; };
const T = '2026-12-10T10:00:00Z';
const as = async (id, sql, args = [], role = 'authenticated') => {
  await db.exec(`set role ${role}`);
  try { await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [id ?? '']); return (await db.query(sql, args)).rows; }
  finally { await db.exec('reset role'); }
};
const core = async (id, code, token = null, consent = false) => {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [id]);
  return (await db.query(`select private.accept_invite_at($1,$2,$3,null,$4) result`, [code, token, T, consent])).rows[0].result;
};
const approve = async (id, request) => {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [id]);
  return (await db.query(`select private.approve_join_at($1,$2) result`, [request, T])).rows[0].result;
};
const rejects = async (fn, error, label) => { await assert.rejects(fn, e => e.message === error); check(true, label); };
let sequence = 0;
const user = async () => {
  const id = `00000000-0000-0000-0000-${String(++sequence).padStart(12, '0')}`;
  await db.query('insert into auth.users(id) values ($1)', [id]); return id;
};
const solo = async id => (await as(id, `select create_couple('dating','{}',null) id`))[0].id;
const invite = async id => {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [id]);
  return (await db.query(`select (i).* from (select private.create_invite_at($1) i) s`, [T])).rows[0];
};
const status = async id => (await db.query('select status from couples where id=$1',[id])).rows[0].status;
try {
  const owner = await user(), joiner = await user();
  const target = await solo(owner), own = await solo(joiner);
  const link = await invite(owner), ownLink = await invite(joiner);
  for (const token of [null, link.token]) {
    for (const consent of [false, null]) {
      await rejects(() => core(joiner, link.code, token, consent), 'CONFIRM_ARCHIVE', 'typed/token absent or null consent is denied');
      check(await status(own) === 'active', 'denied call leaves solo space active');
    }
  }
  await rejects(() => as(joiner, 'select accept_invite($1,$2)', [link.code,link.token]), 'CONFIRM_ARCHIVE', 'public default is safe for old clients');
  await rejects(() => as(joiner, 'select accept_invite($1)', [link.code]), 'CONFIRM_ARCHIVE', 'public typed default requires confirmation');
  check((await db.query('select count(*)::int n from join_requests')).rows[0].n === 0, 'no request created without consent');
  check((await db.query('select revoked_at from pair_invites where code=$1',[ownLink.code])).rows[0].revoked_at === null, 'denial preserves own invite');
  check((await db.query('select count(*)::int n from private.invite_attempts')).rows[0].n === 0, 'confirmation refusal is not a guessed-code failure');
  check((await as(joiner, 'select accept_invite($1,$2,true) result',[link.code,link.token]))[0].result === target, 'public explicit consent pairs by token');
  check(await status(own) === 'ended', 'consented token join archives own space');
  check((await db.query('select revoked_at from pair_invites where code=$1',[ownLink.code])).rows[0].revoked_at !== null, 'consented join revokes own invite');
  await rejects(() => core(joiner,link.code,link.token,true), 'ALREADY_PAIRED', 'paired retry keeps existing error');
  await rejects(() => core(owner,link.code,link.token), 'ALREADY_PAIRED', 'two-member callers unchanged');

  const typedOwner = await user(), typedJoiner = await user();
  const typedTarget = await solo(typedOwner), typedSolo = await solo(typedJoiner), typed = await invite(typedOwner);
  const request = await core(typedJoiner,typed.code,null,true);
  check(request.status === 'pending' && await status(typedSolo) === 'active', 'typed consent waits for inviter before archiving');
  const retry = await core(typedJoiner,typed.code,null,true);
  check(request.request_id === retry.request_id && request.expires_at === retry.expires_at, 'consented retry preserves request and expiry');
  await rejects(() => core(typedJoiner,typed.code), 'CONFIRM_ARCHIVE', 'unconfirmed retry cannot reuse earlier consent');
  check(await approve(typedOwner,request.request_id) === typedTarget, 'approval consumes stored requester consent');
  check(await status(typedSolo) === 'ended', 'approval archives only consented space');
  check((await db.query(`select count(*)::int n from private.join_archive_consents where request_id=$1`,[request.request_id])).rows[0].n === 1, 'retry stores only one consent');

  // An initially unpaired requester may create a solo space while waiting.
  const raceOwner = await user(), raceJoiner = await user();
  const raceTarget = await solo(raceOwner), race = await invite(raceOwner);
  const pending = await core(raceJoiner,race.code);
  const laterSolo = await solo(raceJoiner);
  await rejects(() => approve(raceOwner,pending.request_id),'CONFIRM_ARCHIVE','approval cannot archive a space created after an unpaired request');
  check(await status(laterSolo) === 'active', 'late-created solo remains active');
  check((await db.query('select status from join_requests where id=$1',[pending.request_id])).rows[0].status === 'pending', 'refused approval leaves request pending');
  check((await core(raceJoiner,race.code,null,true)).request_id === pending.request_id, 'requester may confirm current solo without extending request');
  check(await approve(raceOwner,pending.request_id) === raceTarget, 'approval works after explicit current-space consent');

  // Consent to a former solo space cannot authorize archiving a replacement space.
  const oldOwner = await user(), mover = await user();
  await solo(oldOwner); const oldSolo = await solo(mover), old = await invite(oldOwner);
  const oldRequest = await core(mover,old.code,null,true);
  await as(mover,'select unpair()'); const replacement = await solo(mover);
  await rejects(() => approve(oldOwner,oldRequest.request_id),'CONFIRM_ARCHIVE','old-space consent does not transfer to a new solo couple');
  check(await status(replacement) === 'active', 'replacement space stays active');
  await db.query('delete from couples where id=$1',[oldSolo]);
  check((await db.query('select count(*)::int n from private.join_archive_consents where request_id=$1',[oldRequest.request_id])).rows[0].n === 0, 'purging consented archive clears private consent');

  // A pre-migration pending request has no ledger row; safe default on approval.
  const legacyOwner = await user(), legacyJoiner = await user();
  await solo(legacyOwner); const legacySolo = await solo(legacyJoiner), legacy = await invite(legacyOwner);
  const legacyRequest = await core(legacyJoiner,legacy.code,null,true);
  await db.query('delete from private.join_archive_consents where request_id=$1',[legacyRequest.request_id]);
  await rejects(() => approve(legacyOwner,legacyRequest.request_id),'CONFIRM_ARCHIVE','legacy pending requests cannot silently archive');
  check(await status(legacySolo) === 'active', 'legacy request refusal preserves solo');

  const fresh = await user(), freshOwner = await user();
  const freshTarget = await solo(freshOwner), freshLink = await invite(freshOwner);
  check(await core(fresh,freshLink.code,freshLink.token) === freshTarget, 'unpaired link join needs no archive confirmation');
  const soloOwner = await user(); await solo(soloOwner); const ownCode = await invite(soloOwner);
  await rejects(() => core(soloOwner,ownCode.code,ownCode.token),'OWN_CODE','own-code error still precedes confirmation');
  await rejects(() => as(null,'select accept_invite($1,$2,true)',[ownCode.code,ownCode.token]),'NOT_AUTHENTICATED','missing JWT denied');
  for (const role of ['anon','authenticated','service_role']) {
    await assert.rejects(() => as(fresh, 'select * from private.join_archive_consents', [],role), /permission denied/); check(true, `${role} cannot read consent ledger`);
    for (const sql of [
      `insert into private.join_archive_consents values ('${request.request_id}','${typedSolo}')`,
      'update private.join_archive_consents set couple_id=couple_id',
      'delete from private.join_archive_consents'
    ]) { await assert.rejects(() => as(fresh,sql,[],role), /permission denied/); check(true, `${role} cannot write consent ledger`); }
    await assert.rejects(() => as(fresh, `select private.accept_invite_at('1234',null,$1,null,true)`,[T],role), /permission denied/); check(true, `${role} cannot call clock/approval core`);
  }
  await assert.rejects(() => as(null,`select accept_invite('1234',null,true)`,[],'anon'),/permission denied/); check(true,'anon cannot call public consent overload');
  check((await db.query(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname='accept_invite'`)).rows[0].n === 1,'one public signature; no old overload bypass');
  check((await db.query(`select relrowsecurity from pg_class where oid='private.join_archive_consents'::regclass`)).rows[0].relrowsecurity,'private consent ledger has RLS');
  await db.query('delete from join_requests where id=$1',[request.request_id]);
  check((await db.query('select count(*)::int n from private.join_archive_consents where request_id=$1',[request.request_id])).rows[0].n === 0,'request deletion cascades consent');
  console.log(`\n${passed} passed, 0 failed`);
} finally { await db.close(); }
