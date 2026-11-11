// BE-53 (D48 amended, PO 2026-11-11): the "Little things sounds" switch on 41 also mutes the push sound.
//   * notification_prefs.little_things_sound boolean not null default true; own row only (existing
//     prefs policies), the partner and other users cannot read or change it.
//   * Off → the little-thing claim is `silent` (notify sends it without sound on `little_thing_quiet`,
//     iOS passive); it is still claimed/delivered and still counts (D24 4/day, 1 per type per hour).
//   * On → silent only in quiet hours, as before (BE-45).
// Usage: node supabase/tests/little-things-sound.test.mjs
import { createDb } from './pglite-supabase.mjs';

let db;
try { db = await createDb(); } catch (e) { console.error(`FAIL ${e.message}`); process.exit(1); }
let passed = 0, failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (c) passed++; else { failed++; process.exitCode = 1; } };
const run = async (role, uid, sql, params) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`);
  try { return await db.query(sql, params); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};
const as = (uid, sql, params) => run('authenticated', uid, sql, params);
const errOf = async (role, uid, sql, params) => { try { await run(role, uid, sql, params); return null; } catch (e) { return e; } };
const owner = (sql, params) => db.query(sql, params);
const withSub = async (uid, fn) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid}', false)`);
  try { return await fn(); } finally { await db.exec(`select set_config('request.jwt.claim.sub', '', false)`); }
};
const sendAt = (uid, now, kind, amount = 1) => withSub(uid, async () =>
  (await db.query('select (r).id from (select private.send_little_thing_at($1, $2, null, $3) r) s', [kind, amount, now])).rows[0].id);
const claim = async now => (await owner('select * from private.claim_little_thing_pushes_at($1)', [now])).rows;
const claimFor = async (uid, now) => (await claim(now)).filter(r => r.user_id === uid);
const outcome = async id => (await owner('select outcome from private.little_thing_dispatch where little_thing_id = $1', [id])).rows[0]?.outcome ?? null;
const at = (base, s) => new Date(new Date(base).getTime() + s * 1000).toISOString();
const MIN = 60, HOUR = 3600;

const U = n => `00000000-0000-0000-0000-0000000053${n}`;
const ids = Array.from({ length: 6 }, (_, i) => U(String(i + 10)));
const [A, B, C, D, E, F] = ids;
await db.exec(`insert into auth.users (id, raw_user_meta_data) values ${ids.map((u, i) =>
  `('${u}', '{"name":"${i % 2 ? 'Sam' : 'Maya Rose'}"}')`).join(', ')};
  insert into questions (body, sort_order) values ('LTS-Q1', 1);`);
const pair = async (a, b) => {
  const c = (await as(a, `select create_couple('dating', '{}', null) c`)).rows[0].c;
  const inv = (await as(a, 'select (x).code c, (x).token t from (select create_invite() x) s')).rows[0];
  await as(b, 'select accept_invite($1, $2, true)', [inv.c, inv.t]);
  return c;
};
await pair(A, B); await pair(C, D); await pair(E, F);
await owner(`update profiles set timezone = 'UTC' where id = any($1)`, [ids]);
const sound = async uid => (await owner('select little_things_sound s from notification_prefs where user_id = $1', [uid])).rows[0]?.s;

// ═══ Column, default, own row only ═══
const col = (await owner(`select data_type, is_nullable, column_default from information_schema.columns
  where table_schema = 'public' and table_name = 'notification_prefs' and column_name = 'little_things_sound'`)).rows[0];
ok(col?.data_type === 'boolean' && col.is_nullable === 'NO' && col.column_default === 'true', `little_things_sound boolean not null default true (got ${JSON.stringify(col)})`);
ok((await as(B, 'select little_things_sound from notification_prefs')).rows[0]?.little_things_sound === true, 'a new account has the sound on');
await as(B, 'update notification_prefs set little_things_sound = false where user_id = $1', [B]);
ok(await sound(B) === false, 'the owner can switch the sound off');
await as(B, 'update notification_prefs set little_things_sound = true where user_id = $1', [B]);
ok(await sound(B) === true, 'and on again');
await as(B, `insert into notification_prefs (user_id, little_things_sound) values ($1, false)
  on conflict (user_id) do update set little_things_sound = excluded.little_things_sound`, [B]);
ok(await sound(B) === false, "the app's upsert (onConflict user_id) writes it");
await as(B, 'update notification_prefs set little_things_sound = true where user_id = $1', [B]);
ok((await as(A, 'select little_things_sound from notification_prefs where user_id = $1', [B])).rows.length === 0, 'the partner cannot read it');
await as(A, 'update notification_prefs set little_things_sound = false where user_id = $1', [B]);
ok(await sound(B) === true, 'the partner cannot change it (0 rows)');
await as(C, 'update notification_prefs set little_things_sound = false where user_id = $1', [B]);
ok(await sound(B) === true, 'another couple cannot change it (0 rows)');
const anonRead = await errOf('anon', null, 'select little_things_sound from notification_prefs');
ok(/permission denied/.test(anonRead?.message ?? ''), 'anon cannot read prefs');

// ═══ Sound on → per-gesture push outside quiet hours ═══
const T1 = '2030-04-01T12:00:00Z';
await sendAt(A, T1, 'kiss', 2);
let c = await claimFor(B, at(T1, 12));
ok(c.length === 1 && c[0].silent === false && c[0].gesture === 'kiss', 'sound on, 12:00 → not silent (per-gesture sound in notify)');

// ═══ Sound off → silent, still claimed, still counted ═══
await as(D, 'update notification_prefs set little_things_sound = false where user_id = $1', [D]);
const T2 = '2030-04-02T12:00:00Z';
const d1 = await sendAt(C, T2, 'hug', 1000);
c = await claimFor(D, at(T2, 12));
ok(c.length === 1 && c[0].silent === true, 'sound off, 12:00 → claimed silent');
ok(await outcome(d1) === 'pushed', 'sound off is still delivered (outcome pushed, not preference)');
ok(c[0]?.partner_name === 'Maya Rose' && JSON.stringify(c[0]?.counts) === JSON.stringify({ hug: 1 }), 'the claim carries the same name and counts');
const logged = (await owner(`select status, local_date::text d from push_log where id = $1`, [c[0].claim_id])).rows[0];
ok(logged?.status === 'claimed' && logged.d === '2030-04-02', 'a silent push takes a push_log slot (counts toward D24)');
// Within the hour another hug is capped (1 per type per hour) exactly as with sound on.
const d2 = await sendAt(C, at(T2, 20 * MIN), 'hug', 500);
c = await claimFor(D, at(T2, 20 * MIN + 12));
ok(c.length === 0 && await outcome(d2) === 'type_cap', 'sound off still obeys one push per gesture type per hour');
// Fill the four-a-day cap: three more pushes, then the fifth is refused.
for (const [i, kind] of [[1, 'kiss'], [2, 'miss_you'], [3, 'good_morning']]) {
  await sendAt(C, at(T2, i * HOUR + 30 * MIN), kind);
  const r = await claimFor(D, at(T2, i * HOUR + 30 * MIN + 12));
  ok(r.length === 1 && r[0].silent === true, `sound off: push ${i + 1} of the day is silent`);
}
const d5 = await sendAt(C, at(T2, 5 * HOUR), 'goodnight');
c = await claimFor(D, at(T2, 5 * HOUR + 12));
ok(c.length === 0 && await outcome(d5) === 'daily_cap', 'sound off: the fifth push of the day hits the shared D24 cap');
// The sender's own setting does not matter: C's sound is on, D's off, and vice versa.
await sendAt(D, at(T2, 6 * HOUR), 'kiss');
c = await claimFor(C, at(T2, 6 * HOUR + 12));
ok(c.length === 1 && c[0].silent === false, "the recipient's switch decides, not the sender's");

// ═══ Back on → quiet hours unchanged ═══
await as(D, 'update notification_prefs set little_things_sound = true where user_id = $1', [D]);
const T3 = '2030-04-04T12:00:00Z';
await sendAt(C, T3, 'kiss');
c = await claimFor(D, at(T3, 12));
ok(c.length === 1 && c[0].silent === false, 'switched back on → sound again');
const T4 = '2030-04-05T23:30:00Z';   // 23:30 UTC, inside the default 23:00–07:00 quiet hours
await sendAt(C, T4, 'goodnight');
c = await claimFor(D, at(T4, 12));
ok(c.length === 1 && c[0].silent === true, 'sound on in quiet hours → still silent (unchanged)');
await as(F, 'update notification_prefs set little_things_sound = false where user_id = $1', [F]);
await sendAt(E, T4, 'goodnight');
c = await claimFor(F, at(T4, 12));
ok(c.length === 1 && c[0].silent === true, 'sound off in quiet hours → silent');

// ═══ The little_things toggle still wins (off → no push at all) ═══
await as(F, 'update notification_prefs set little_things = false where user_id = $1', [F]);
const f1 = await sendAt(E, '2030-04-06T12:00:00Z', 'hug', 100);
c = await claimFor(F, '2030-04-06T12:00:12Z');
ok(c.length === 0 && await outcome(f1) === 'preference', 'little_things off → dropped, whatever the sound switch');

console.log(`\n${passed} passed, ${failed} failed`);
