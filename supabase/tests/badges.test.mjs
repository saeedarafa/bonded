// BE-12: streak awards are catalogue-driven, private to the couple, and awarded once.
import { createDb } from './pglite-supabase.mjs';
import { contentSql } from '../scripts/content-sql.mjs';
let db; try { db = await createDb(); await db.exec(contentSql()); } catch (e) { console.error(`FAIL ${e.message}`); process.exit(1); }
let passed = 0, failed = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (c) passed++; else { failed++; process.exitCode = 1; } };
const run = async (role, uid, sql, params) => { await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`); try { return await db.query(sql, params); } finally { await db.exec('reset role'); } };
const as = (uid, sql, params) => run('authenticated', uid, sql, params);
const U = n => `00000000-0000-0000-0000-0000000009${n}`;
const [A, B, OUT] = ['01', '02', '03'].map(U);
await db.exec(`insert into auth.users (id) values ('${A}'), ('${B}'), ('${OUT}'); insert into questions (body, sort_order) values ('BADGE-Q', 1);`);
const couple = (await as(A, `select create_couple('dating', '{}', null) c`)).rows[0].c;
const code = (await as(A, 'select (create_invite()).code c')).rows[0].c; await as(B, 'select accept_invite($1)', [code]);
const awards = async uid => (await as(uid, 'select badge_slug from badge_awards order by badge_slug')).rows.map(r => r.badge_slug).join();
await db.query(`update couple_streaks set current = 1 where couple_id = $1`, [couple]);
ok(await awards(A) === 'streak-1' && await awards(B) === 'streak-1', 'streak 1 awards the shared first-day badge to both partners');
await db.query(`update couple_streaks set current = 3 where couple_id = $1`, [couple]);
ok(await awards(A) === 'streak-1,streak-3', 'streak 3 awards only the newly crossed threshold');
await db.query(`update couple_streaks set current = 7 where couple_id = $1`, [couple]);
ok(await awards(A) === 'streak-1,streak-3,streak-7', 'streak 7 awards its threshold');
await db.query(`update couple_streaks set current = 3 where couple_id = $1`, [couple]);
await db.query(`update couple_streaks set current = 7 where couple_id = $1`, [couple]);
ok((await db.query('select count(*)::int n from badge_awards where couple_id = $1', [couple])).rows[0].n === 3, 'a repeated threshold award is idempotent');
ok((await as(OUT, 'select * from badge_awards')).rows.length === 0, 'other couples cannot read awards');
try { await as(A, `insert into badge_awards (badge_slug, couple_id) values ('streak-14', $1)`, [couple]); ok(false, 'client write denied'); } catch (e) { ok(/permission denied/.test(e.message), 'clients cannot mint badge awards'); }
try { await run('anon', null, 'select * from badges'); ok(false, 'anon catalogue denied'); } catch (e) { ok(/permission denied/.test(e.message), 'anon cannot read badge catalogue'); }
console.log(`\n${passed} passed, ${failed} failed`); await db.close();
