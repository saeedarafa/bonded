// BE-44b (SEC-09d follow-ups on #195): undo cap and pinned edge cases.
//   * At most 10 undos per sender per sender-local day; the 11th → UNDO_EXPIRED, the gesture stays sent
//     and counts. Re-undoing an undone gesture stays idempotent. Per sender (the partner has their own),
//     the next sender-local day starts again.
//   * Timezone switch (lead: accepted, not fixed): sends count on the sender's local day at send time,
//     so moving the profile timezone back across midnight opens that day's allowance once.
//   * client_id retry after an undo returns the first (undone) send, no second row.
// Usage: node supabase/tests/little-things-undo-cap.test.mjs
import { createDb } from './pglite-supabase.mjs';
import { randomUUID } from 'node:crypto';

let db;
try { db = await createDb(); } catch (e) { console.error(`FAIL ${e.message}`); process.exit(1); }
let passed = 0, failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (c) passed++; else { failed++; process.exitCode = 1; } };
const run = async (role, uid, sql, params) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`);
  try { return await db.query(sql, params); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};
const as = (uid, sql, params) => run('authenticated', uid, sql, params);
const owner = (sql, params) => db.query(sql, params);
const is = (e, msg) => e?.message === msg && e.code === 'P0001';
const withSub = async (uid, fn) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid}', false)`);
  try { return await fn(); } finally { await db.exec(`select set_config('request.jwt.claim.sub', '', false)`); }
};
const sendAt = (uid, now, kind, amount = 1, client = null) => withSub(uid, async () =>
  (await db.query('select (r).id, (r).at_limit from (select private.send_little_thing_at($1, $2, $3, $4) r) s', [kind, amount, client, now])).rows[0]);
const sendErr = async (...a) => { try { await sendAt(...a); return null; } catch (e) { return e; } };
const undoAt = (uid, now, id) => withSub(uid, async () => (await db.query('select * from private.undo_little_thing_at($1, $2)', [id, now])).rows);
const undoErr = async (...a) => { try { await undoAt(...a); return null; } catch (e) { return e; } };
const at = (base, s) => new Date(new Date(base).getTime() + s * 1000).toISOString();

const U = n => `00000000-0000-0000-0000-0000000046${n}`;
const [MAYA, SAM] = ['01', '02'].map(U);
await db.exec(`insert into auth.users (id) values ('${MAYA}'), ('${SAM}'); insert into questions (body, sort_order) values ('LTU-Q1', 1);`);
const c = (await as(MAYA, `select create_couple('dating', '{}', null) c`)).rows[0].c;
const inv = (await as(MAYA, 'select (x).code c, (x).token t from (select create_invite() x) s')).rows[0];
await as(SAM, 'select accept_invite($1, $2, true)', [inv.c, inv.t]);
ok(Boolean(c), 'paired');
await owner(`update profiles set timezone = 'UTC' where id in ($1, $2)`, [MAYA, SAM]);

// ═══ Undo cap ═══
const D = '2030-05-01T10:00:00Z';
let t = 0, refused = null, last = null;
for (let i = 1; i <= 11; i++) {
  const s = await sendAt(MAYA, at(D, t), 'hug', 100);
  const e = await undoErr(MAYA, at(D, t + 2), s.id);
  if (i <= 10 && e) ok(false, `undo ${i} should succeed (got ${e.message})`);
  if (i === 11) { refused = e; last = s; }
  t += 10;
}
ok(true, 'ten send → undo loops in a day succeed');
ok(is(refused, 'UNDO_EXPIRED'), `the 11th undo of the sender-local day → UNDO_EXPIRED (got ${refused?.message})`);
ok((await owner(`select undone_at from little_things where id = $1`, [last.id])).rows[0].undone_at === null, 'the refused gesture stays sent');
ok(Number((await owner(`select count(*) n from little_things where sender_id = $1 and undone_at is null and kind = 'hug'`, [MAYA])).rows[0].n) === 1, 'and counts toward the hug limit');
const anUndone = (await owner(`select id from little_things where sender_id = $1 and undone_at is not null limit 1`, [MAYA])).rows[0].id;
ok((await undoAt(MAYA, at(D, t), anUndone)).length === 5, 'undoing an already undone gesture stays idempotent after the cap');
ok(Number((await owner(`select count(*) n from little_things where sender_id = $1 and undone_at is not null`, [MAYA])).rows[0].n) === 10, 'exactly 10 undone rows: the table grows by at most 10 undos per sender and day');
const ps = await sendAt(SAM, at(D, t + 1), 'kiss', 2);
ok((await undoAt(SAM, at(D, t + 3), ps.id)).length === 5, 'the cap is per sender: the partner can still undo');
const next = await sendAt(MAYA, '2030-05-02T10:00:00Z', 'kiss', 1);
ok((await undoAt(MAYA, '2030-05-02T10:00:02Z', next.id)).length === 5, 'the next sender-local day starts again');
await owner(`update profiles set timezone = 'Asia/Tokyo' where id = $1`, [MAYA]);
const tk = await sendAt(MAYA, '2030-05-02T15:30:00Z', 'kiss', 1);   // 00:30 May 3 in Tokyo
ok((await undoAt(MAYA, '2030-05-02T15:30:02Z', tk.id)).length === 5, 'the undo day is the gesture\'s sender-local day');
await owner(`update profiles set timezone = 'UTC' where id = $1`, [MAYA]);

// ═══ client_id retry after an undo ═══
const cid = randomUUID();
const first = await sendAt(SAM, '2030-05-04T09:00:00Z', 'miss_you', 1, cid);
await undoAt(SAM, '2030-05-04T09:00:01Z', first.id);
const retry = await sendAt(SAM, '2030-05-04T09:00:03Z', 'miss_you', 1, cid);
ok(retry.id === first.id, 'a retry with the same client_id after an undo returns the first send');
ok(Number((await owner(`select count(*) n from little_things where client_id = $1`, [cid])).rows[0].n) === 1, 'no second row');

// ═══ Timezone switch (accepted burst, pinned) ═══
// Sam uses the 5 free hugs on May 6 (UTC), then moves to Los Angeles where it is still May 5.
const T = '2030-05-06T02:00:00Z';
await owner(`update profiles set timezone = 'UTC' where id = $1`, [SAM]);
for (let i = 0; i < 5; i++) await sendAt(SAM, at(T, i * 10), 'hug', 100);
ok(is(await sendErr(SAM, at(T, 60), 'hug', 100), 'LITTLE_THING_LIMIT'), '6th hug on the UTC day is refused');
await owner(`update profiles set timezone = 'America/Los_Angeles' where id = $1`, [SAM]);   // 19:01 May 5
for (let i = 0; i < 5; i++) await sendAt(SAM, at(T, 70 + i * 10), 'hug', 100);
ok(is(await sendErr(SAM, at(T, 130), 'hug', 100), 'LITTLE_THING_LIMIT'), 'after a timezone switch back across midnight, that local day\'s 5 hugs open once, then the limit holds');
await owner(`update profiles set timezone = 'UTC' where id = $1`, [SAM]);
ok(is(await sendErr(SAM, at(T, 140), 'hug', 100), 'LITTLE_THING_LIMIT'), 'switching back gives nothing more (the UTC day is still full)');

console.log(`\n${passed} passed, ${failed} failed`);
