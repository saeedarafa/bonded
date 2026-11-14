// BE-64 (MOB-78b step 4, SEC-21): the silent `widget_refresh` push selection.
//   * service-only `due_widget_refreshes(p_now)` → setof {user_id}: a live widget token expiring within
//     12 h that is still the device's live one (not rotated since minting), signed-in (session row,
//     not past not_after), paired (active couple, two current members), with a push token;
//   * at most one claim per person per rolling 24 h, atomic (a replay or overlapping run gets nothing);
//   * not a user-visible push: never written to push_log, never counted toward D24, no quiet hours;
//   * grants, definer hygiene, no token hash or content in the result, account deletion cascades.
// Usage: node supabase/tests/widget-refresh-push.test.mjs ../migrations/*.sql
import { createDb } from './pglite-supabase.mjs';
import { randomUUID } from 'node:crypto';

let db;
try { db = await createDb(); } catch (e) { console.error(`FAIL ${e.message}`); process.exit(1); }
let passed = 0, failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (c) passed++; else { failed++; process.exitCode = 1; } };
const owner = (sql, params) => db.query(sql, params);
const claims = async (uid, session) => db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', false),
  set_config('request.jwt.claims', '${uid ? JSON.stringify({ sub: uid, session_id: session ?? undefined, role: 'authenticated' }) : ''}', false);`);
const run = async (role, uid, session, sql, params) => {
  await claims(uid, session);
  await db.exec(`set role ${role};`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role;'); await claims(null); }
};
const as = (uid, sql, params, session = null) => run('authenticated', uid, session, sql, params);
const errOf = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
const perm = e => /permission denied/.test(e?.message ?? '');
const HOUR = 3600;
const at = (base, s) => new Date(new Date(base).getTime() + s * 1000).toISOString();
const mintAt = async (uid, session, device, now) => {
  await claims(uid, session);
  try { return (await owner('select private.mint_widget_token_at($1, $2) j', [device, now])).rows[0].j; } finally { await claims(null); }
};
const due = async (now) => (await owner('select * from public.due_widget_refreshes($1)', [now])).rows;
const dueIds = async (now) => (await due(now)).map(r => r.user_id).sort();
const pushLogCount = async () => Number((await owner('select count(*) n from push_log')).rows[0].n);

const U = n => `00000000-0000-0000-0000-0000000064${n}`;
const [A1, A2, B1, B2, C1, C2, D1, D2, E1, E2] = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'].map(U);
const users = [A1, A2, B1, B2, C1, C2, D1, D2, E1, E2];
await db.exec(`insert into auth.users (id) values ${users.map(u => `('${u}')`).join(', ')};`);
const S = Object.fromEntries(users.map(u => [u, randomUUID()]));
await owner(`insert into auth.sessions (id, user_id) select (x->>'s')::uuid, (x->>'u')::uuid from jsonb_array_elements($1::jsonb) x`,
  [JSON.stringify(users.map(u => ({ u, s: S[u] })))]);
const pair = async (a, b) => {
  const couple = (await as(a, `select create_couple('dating', '{}', null) c`)).rows[0].c;
  const inv = (await as(a, 'select (x).code c, (x).token t from (select create_invite() x) s')).rows[0];
  await as(b, 'select accept_invite($1, $2, true)', [inv.c, inv.t]);
  return couple;
};
const coupleA = await pair(A1, A2);
await pair(B1, B2);
const coupleC = await pair(C1, C2);
await pair(D1, D2);
await pair(E1, E2);
for (const u of users) {
  await as(u, `select register_push_token($1, 'ios')`, [`ExponentPushToken[FIXTURE-${u.slice(-4)}]`]);
}

const T0 = '2030-05-01T12:00:00Z';
const devA = randomUUID();
const a = await mintAt(A1, S[A1], devA, T0);   // expires T0 + 48 h

// ═══ 1. The 12 h window and the once-a-day claim ═══
ok((await due(at(T0, 36 * HOUR - 60))).length === 0, 'a token with more than 12 h left is not due');
const first = await due(at(T0, 36 * HOUR));
ok(first.length === 1 && first[0].user_id === A1, 'a live token with exactly 12 h left is due (once, for its owner)');
ok(Object.keys(first[0]).join() === 'user_id', 'the result is the user id only: no token hash, device, couple or content');
ok((await due(at(T0, 36 * HOUR))).length === 0, 'a replay at the same moment claims nothing (idempotent)');
ok((await due(at(T0, 47 * HOUR))).length === 0, 'no second push within 24 h, even with 1 h left');
ok((await due(at(T0, 48 * HOUR))).length === 0, 'an expired token is never due');
const claimRow = (await owner('select * from private.widget_refresh_pushes where user_id = $1', [A1])).rows;
ok(claimRow.length === 1 && Object.keys(claimRow[0]).sort().join() === 'last_claimed_at,user_id',
  'the claim row holds only the user and the claim time');

// A day later with a token that is again close to expiry (not refreshed): due again.
const T1 = at(T0, 60 * HOUR);
await owner('update private.widget_tokens set revoked_at = $2 where user_id = $1 and revoked_at is null', [A1, T1]);
await mintAt(A1, S[A1], devA, T1);
ok((await due(at(T1, 36 * HOUR))).length === 1, 'the next near-expiry token is due again once 24 h have passed');

// ═══ 2. "Not seen since minted": a rotated token is never due ═══
const devB = randomUUID();
await mintAt(B1, S[B1], devB, T0);
await mintAt(B1, S[B1], devB, at(T0, 30 * HOUR));   // the app ran and rotated the device's token
ok(!(await dueIds(at(T0, 37 * HOUR))).includes(B1), 'a device whose token was rotated after minting is not due');
ok((await dueIds(at(T0, 30 * HOUR + 36 * HOUR))).includes(B1), 'its new token is due 36 h after its own minting');

// Multi-device: one fresh device does not hide another device's old token.
const devC1 = randomUUID(), devC2 = randomUUID();
await mintAt(C1, S[C1], devC1, T0);
await mintAt(C1, S[C1], devC2, at(T0, 30 * HOUR));
ok((await dueIds(at(T0, 36 * HOUR))).includes(C1), 'an old live token on one device is due although another device minted recently');

// ═══ 3. Never to signed-out, unpaired or push-less people ═══
await mintAt(D1, S[D1], randomUUID(), T0);
await mintAt(D2, S[D2], randomUUID(), T0);
await mintAt(E1, S[E1], randomUUID(), T0);
await mintAt(E2, S[E2], randomUUID(), T0);
await mintAt(C2, S[C2], randomUUID(), T0);
await mintAt(A2, S[A2], randomUUID(), T0);
await mintAt(B2, S[B2], randomUUID(), T0);
await owner('delete from auth.sessions where user_id = $1', [D1]);                         // signed out
await owner(`update auth.sessions set not_after = $2 where user_id = $1`, [D2, at(T0, HOUR)]); // session time-boxed out
await as(E1, `select revoke_widget_tokens(null)`, [], S[E1]);                                 // revoked
await owner('delete from push_tokens where user_id = $1', [E2]);                             // no device to push
await owner('update couple_members set left_at = $2 where user_id = $1', [C2, at(T0, HOUR)]); // C2 left the couple
await owner('update private.widget_tokens set revoked_at = null where user_id = $1', [C2]);   // even if the trigger had not revoked
await owner(`update couples set status = 'ended', ended_at = now() where id = $1`, [coupleA]);                // A2's couple ended
let ids = await dueIds(at(T0, 36 * HOUR + 60));
ok(!ids.includes(D1), 'a signed-out person (minting session gone) is not due');
ok(!ids.includes(D2), 'a session past not_after is not due');
ok(!ids.includes(E1), 'a revoked token is not due');
ok(!ids.includes(E2), 'a person without a push token is not due');
ok(!ids.includes(C2), 'a person who left the couple is not due');
ok(!ids.includes(A2), 'a person whose couple ended is not due');
ok(ids.includes(B2), 'the control (paired, signed in, push token) is due');
ok(Number((await owner('select count(*) n from private.widget_refresh_pushes where user_id = $1', [E2])).rows[0].n) === 0,
  'skipping a push-less person writes no claim');
await as(E2, `select register_push_token($1, 'android')`, ['ExponentPushToken[FIXTURE-E2-new]']);
ok((await dueIds(at(T0, 36 * HOUR + 120))).includes(E2), 'once a push token is registered the person is due');

// ═══ 4. Not a user-visible push: no push_log, no D24 ═══
const devF = randomUUID();
await owner(`update couples set status = 'active', ended_at = null where id = $1`, [coupleA]);
await owner('delete from private.widget_refresh_pushes where user_id = $1', [A2]);
await mintAt(A2, S[A2], devF, T1);
const today = (await owner(`select (($1::timestamptz) at time zone timezone)::date d from profiles where id = $2`, [at(T1, 36 * HOUR), A2])).rows[0].d;
for (let i = 0; i < 4; i++) {
  await owner(`insert into push_log (user_id, type, record_id, local_date, status, created_at) values ($1, 'nudge', gen_random_uuid(), $2, 'sent', $3)`,
    [A2, today, at(T1, 36 * HOUR - 60)]);
}
const before = await pushLogCount();
ok((await dueIds(at(T1, 36 * HOUR))).includes(A2), 'a person at the D24 four-a-day cap still gets the silent refresh');
ok(await pushLogCount() === before, 'the refresh writes nothing to push_log (never counts toward D24 or per-type caps)');
ok(!(await owner(`select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'push_type' and e.enumlabel = 'widget_refresh'`)).rows.length,
  'widget_refresh is not a push_type (no push_log row can exist for it)');
// Quiet hours do not hold it: B1's quiet hours cover almost the whole day.
await owner(`update notification_prefs set quiet_start = '00:00', quiet_end = '23:59' where user_id = $1`, [B1]);
await owner('delete from private.widget_refresh_pushes where user_id = $1', [B1]);
ok((await dueIds(at(T0, 30 * HOUR + 36 * HOUR + 60))).includes(B1), 'quiet hours do not hold the silent refresh');

// ═══ 5. Input guards, grants, definer hygiene, deletion ═══
ok((await due(null)).length === 0 && (await due('infinity')).length === 0, 'a null or infinite clock selects nothing');
for (const role of ['anon', 'authenticated']) {
  ok(perm(await errOf(() => run(role, role === 'anon' ? null : A1, S[A1], 'select * from public.due_widget_refreshes(now())'))),
    `${role} cannot call due_widget_refreshes`);
}
ok(!(await errOf(() => run('service_role', null, null, 'select * from public.due_widget_refreshes(now())'))), 'service_role can call due_widget_refreshes');
for (const role of ['anon', 'authenticated', 'service_role']) {
  ok(!(await owner(`select has_table_privilege($1, 'private.widget_refresh_pushes', 'select') s,
      has_table_privilege($1, 'private.widget_refresh_pushes', 'insert') i`, [role])).rows[0].s,
    `${role} has no access to private.widget_refresh_pushes`);
}
const def = (await owner(`select p.prosecdef d, p.proconfig c from pg_proc p where p.oid = 'public.due_widget_refreshes(timestamptz)'::regprocedure`)).rows[0];
ok(def.d && (def.c ?? []).some(c => c.startsWith('search_path=')), 'due_widget_refreshes is SECURITY DEFINER with a pinned search_path');
ok((await owner(`select relrowsecurity r from pg_class where oid = 'private.widget_refresh_pushes'::regclass`)).rows[0].r, 'RLS is on for the claim table');
await owner('delete from auth.users where id = $1', [A1]);
ok(Number((await owner('select count(*) n from private.widget_refresh_pushes where user_id = $1', [A1])).rows[0].n) === 0,
  'deleting the account removes its claim row');

console.log(`\n${passed} passed, ${failed} failed`);
