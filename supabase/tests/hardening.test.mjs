// BE-04c: pairing hardening (SEC-01 F2, F4, F5, F8, F9, F10, F11, F12).
// Usage: node supabase/tests/hardening.test.mjs
// Interleavings that need two connections are reproduced on one: private.race_point() is a no-op seam
// that these tests replace to run a competing accept at a named point inside the function under test.
import { createDb } from './pglite-supabase.mjs';

let db;
try { db = await createDb(); } catch (e) { console.error(`FAIL ${e.message}`); process.exit(1); }
let passed = 0, failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (c) passed++; else { failed++; process.exitCode = 1; } };
const setSession = (uid, headers) => `select set_config('request.jwt.claim.sub', '${uid ?? ''}', false),
  set_config('request.headers', '${headers ? JSON.stringify(headers) : ''}', false)`;
const run = async (role, uid, sql, params) => {
  await db.exec(`set role ${role}; ${setSession(uid)};`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
};
const as = (uid, sql, params) => run('authenticated', uid, sql, params);
const errorOf = async (role, uid, sql, params) => { try { await run(role, uid, sql, params); return null; } catch (e) { return e.message; } };
const count = async (sql, params) => (await db.query(sql, params)).rows[0].n;
const core = async (uid, fn, args, now, headers) => {
  await db.exec(setSession(uid, headers));
  try {
    const ph = [...args, now].map((_, i) => `$${i + 1}${i === args.length ? '::timestamptz' : ''}`).join(', ');
    const r = await db.query(`select private.${fn}(${ph}) j, current_setting('response.status', true) s`, [...args, now]);
    const { j, s } = r.rows[0];
    return s === '400' ? { code: j.message } : { code: 'OK', value: j };
  } catch (e) { return { code: e.message, raised: true }; }
};
const accept = (uid, code, token, now, headers) => core(uid, 'accept_invite_at', [code, token ?? null], now, headers);
const preview = (uid, code, token, now, headers) => core(uid, 'invite_preview_at', [code, token ?? null], now, headers);
const mkInvite = async (uid, now) => {
  await db.exec(setSession(uid));
  return (await db.query(`select (x).code, (x).token from (select private.create_invite_at($1::timestamptz) x) s`, [now])).rows[0];
};
const at = (base, ms) => new Date(new Date(base).getTime() + ms).toISOString();
const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN, DAY = 24 * HOUR;
let seq = 0;
const user = async (name, { solo = true, tz } = {}) => {
  const id = `00000000-0000-0000-0000-0000000008${String(++seq).padStart(2, '0')}`;
  await db.exec(`insert into auth.users (id) values ('${id}'); update profiles set display_name = '${name}'${tz ? `, timezone = '${tz}'` : ''} where id = '${id}'`);
  const u = { id, name };
  if (solo) u.couple = (await as(id, `select create_couple('dating', '{}', null) c`)).rows[0].c;
  return u;
};
await db.exec(`insert into questions (body, sort_order) select 'HARD-Q' || g, g from generate_series(1, 30) g`);
// A couple question with explicit dates. Picks the highest unused question so it never collides
// with get_daily_question, which takes the lowest.
const cq = async (couple, { day, source = 'daily', createdAt }) => (await db.query(
  `insert into couple_questions (couple_id, question_id, source, assigned_for, created_at)
   select $1, q.id, $2, $3::date, coalesce($4::timestamptz, now()) from questions q
    where q.body like 'HARD-Q%' and not exists (select 1 from couple_questions x where x.couple_id = $1 and x.question_id = q.id)
    order by q.sort_order desc limit 1 returning id`,
  [couple, source, source === 'daily' ? day : null, createdAt ?? null])).rows[0].id;
const localDate = async (tz, offset = 0) => (await db.query(`select ((now() at time zone $1)::date + $2::int)::text d`, [tz, offset])).rows[0].d;

// ═══ F2: a joiner cannot reach the inviter's solo history ═══
{
  const lea = await user('Lea'), zed = await user('Zed');
  ok((await db.query('select paired_at from couples where id = $1', [lea.couple])).rows[0].paired_at === null, 'a solo couple has no paired_at');
  const d1 = await localDate('UTC', -1), d2 = await localDate('UTC', -2), d3 = await localDate('UTC', -3), d4 = await localDate('UTC', -4);
  const old1 = await cq(lea.couple, { day: d1, createdAt: `${d1}T08:00:00Z` }), old2 = await cq(lea.couple, { day: d2, createdAt: `${d2}T08:00:00Z` }), old3 = await cq(lea.couple, { day: d3, createdAt: `${d3}T08:00:00Z` });
  const unanswered = await cq(lea.couple, { day: d4, createdAt: `${d4}T08:00:00Z` });
  const packSolo = await cq(lea.couple, { source: 'pack' });                 // started solo, created before pairing
  const todayQ = (await as(lea.id, 'select (get_daily_question()).id i')).rows[0].i;
  for (const [id, body] of [[old1, 'SOLO-1'], [old2, 'SOLO-2'], [old3, 'SOLO-3'], [packSolo, 'SOLO-PACK'], [todayQ, 'LEA-DAY1']]) {
    await as(lea.id, `insert into answers (couple_question_id, user_id, body) values ($1, $2, $3)`, [id, lea.id, body]);
  }
  const invite = (await as(lea.id, 'select (x).code c, (x).token t from (select create_invite() x) s')).rows[0];
  await as(zed.id, 'select accept_invite($1, $2)', [invite.c, invite.t]);
  const paired = (await db.query('select paired_at, (select max(joined_at) from couple_members where couple_id = $1) j from couples where id = $1', [lea.couple])).rows[0];
  ok(paired.paired_at !== null && new Date(paired.paired_at).getTime() === new Date(paired.j).getTime(), 'paired_at = when the second member joined');

  ok((await as(zed.id, 'select * from answers')).rows.length === 0, 'the joiner sees no answer at all before answering');
  for (const [id, label] of [[old1, 'yesterday'], [old2, '2 days ago'], [old3, '3 days ago'], [unanswered, 'an unanswered solo question'], [packSolo, 'a solo pack question']]) {
    ok(/row-level security/.test(await errorOf('authenticated', zed.id, `insert into answers (couple_question_id, user_id, body) values ($1, $2, 'ZED-LATE')`, [id, zed.id]) ?? ''), `F2: the joiner cannot answer ${label}`);
    ok(/row-level security/.test(await errorOf('authenticated', zed.id, `insert into answers (couple_question_id, user_id, body) values ($1, $2, 'ZED-LATE') on conflict (couple_question_id, user_id) do update set body = excluded.body`, [id, zed.id]) ?? ''), `... nor by upsert (${label})`);
  }
  ok((await as(zed.id, 'select * from answers')).rows.length === 0, 'F2: still nothing readable after the failed attempts');
  ok((await as(zed.id, 'select answer_count from couple_questions where id = $1', [old1])).rows[0].answer_count === 1 && (await as(zed.id, 'select body from answers where couple_question_id = $1', [old1])).rows.length === 0, 'he can see that a question had an answer (the count), never the text');
  const soloAns = (await db.query(`select id from answers where body = 'SOLO-1'`)).rows[0].id;
  ok(/row-level security/.test(await errorOf('authenticated', zed.id, `insert into reactions (user_id, answer_id, kind) values ($1, $2, 'love')`, [zed.id, soloAns]) ?? ''), 'F2: he cannot react to a solo-period answer either');
  // The intended exception (D03): the pairing day's daily question.
  await as(zed.id, `insert into answers (couple_question_id, user_id, body) values ($1, $2, 'ZED-DAY1')`, [todayQ, zed.id]);
  const seen = (await as(zed.id, 'select body from answers order by body')).rows.map(r => r.body);
  ok(seen.join() === 'LEA-DAY1,ZED-DAY1', 'D03/J7: the pairing day\'s question unlocks the inviter\'s day-1 answer, and only that');
  ok(!seen.some(b => b.startsWith('SOLO')), 'F2: no solo-period answer is readable by the joiner');
  // The inviter: old unanswered questions are closed too; her own answers stay hers.
  ok(/row-level security/.test(await errorOf('authenticated', lea.id, `insert into answers (couple_question_id, user_id, body) values ($1, $2, 'LEA-LATE')`, [unanswered, lea.id]) ?? ''), 'the inviter cannot answer a pre-pairing question after pairing either');
  ok((await as(lea.id, 'select count(*)::int n from answers where user_id = $1', [lea.id])).rows[0].n === 5, 'the inviter still reads all her own answers');
  ok((await as(lea.id, `update answers set body = 'SOLO-1-EDITED' where couple_question_id = $1`, [old1])).rows.length === 0,
    'R1: the inviter cannot edit her own solo-period answer after pairing');
  ok((await as(zed.id, 'select * from answers where couple_question_id = $1', [old1])).rows.length === 0, 'the blocked edit does not open it to him');
  // R1: simulate a two-answer pre-hardening row. The old answer policy is fixed above, but thread,
  // reaction and read-marker policies must not turn that historical row into a metadata side channel.
  const historicPartner = (await db.query(`insert into answers (couple_question_id, user_id, body)
    values ($1, $2, 'PREHARDENING-PARTNER') returning id`, [old1, zed.id])).rows[0].id;
  const historicMessage = (await db.query(`insert into thread_messages (client_id, couple_question_id, user_id, body)
    values (gen_random_uuid(), $1, $2, 'PREHARDENING-THREAD') returning id`, [old1, zed.id])).rows[0].id;
  await db.query(`insert into reactions (user_id, answer_id, kind) values ($1, $2, 'love')`, [zed.id, soloAns]);
  await db.query(`insert into thread_reads (couple_question_id, user_id) values ($1, $2)`, [old1, zed.id]);
  ok((await as(zed.id, 'select * from thread_messages where couple_question_id = $1', [old1])).rows.length === 0,
    'R1: a pre-hardening historical thread remains hidden');
  ok(/row-level security/.test(await errorOf('authenticated', zed.id,
    `insert into thread_messages (client_id, couple_question_id, user_id, body) values (gen_random_uuid(), $1, $2, 'late thread')`, [old1, zed.id]) ?? ''),
    'R1: historical threads reject new posts');
  ok((await as(zed.id, 'select * from reactions where answer_id = $1', [soloAns])).rows.length === 0,
    'R1: a pre-hardening reaction remains hidden');
  ok(/row-level security/.test(await errorOf('authenticated', zed.id,
    `insert into reactions (user_id, message_id, kind) values ($1, $2, 'laugh')`, [zed.id, historicMessage]) ?? ''),
    'R1: historical reactions reject writes');
  ok((await as(zed.id, 'select * from thread_reads where couple_question_id = $1', [old1])).rows.length === 0,
    'R1: a pre-hardening read marker remains hidden');
  ok(/row-level security/.test(await errorOf('authenticated', zed.id,
    `insert into thread_reads (couple_question_id, user_id) values ($1, $2) on conflict (couple_question_id, user_id) do update set last_read_at = now()`, [old1, zed.id]) ?? ''),
    'R1: historical read markers reject upserts');
  ok(historicPartner && historicMessage, 'R1 fixture contains the pre-hardening paired data');
  // Questions created after pairing work both ways.
  const later = await cq(lea.couple, { day: await localDate('UTC', 1), createdAt: new Date(Date.now() + 1000).toISOString() });
  await as(lea.id, `insert into answers (couple_question_id, user_id, body) values ($1, $2, 'LEA-NEXT')`, [later, lea.id]);
  ok((await as(zed.id, 'select * from answers where couple_question_id = $1', [later])).rows.length === 0, 'a question created after pairing: the partner\'s answer is still locked until he answers');
  await as(zed.id, `insert into answers (couple_question_id, user_id, body) values ($1, $2, 'ZED-NEXT')`, [later, zed.id]);
  ok((await as(zed.id, 'select * from answers where couple_question_id = $1', [later])).rows.length === 2, '... and revealed once he has');
  const packLater = await cq(lea.couple, { source: 'pack', createdAt: new Date(Date.now() + 2000).toISOString() });
  await as(zed.id, `insert into answers (couple_question_id, user_id, body) values ($1, $2, 'ZED-PACK')`, [packLater, zed.id]);
  ok((await as(zed.id, 'select * from answers where couple_question_id = $1', [packLater])).rows.length === 1, 'a pack question started after pairing can be answered');
  const out = await user('Out');
  ok((await as(out.id, 'select * from answers')).rows.length === 0, 'an outsider sees no answers');
  await as(lea.id, 'select unpair()');
  ok((await as(zed.id, 'select * from answers where couple_question_id = $1 and user_id = $2', [old1, lea.id])).rows.length === 0,
    'BE-09 composition: an ended archive still hides the partner\'s pre-pairing answer');
  ok((await as(zed.id, 'select * from answers where couple_question_id = $1', [later])).rows.length === 2,
    'BE-09 composition: an ended archive keeps pairing-period answers readable');
}

// The pairing-day exception follows the couple's local date (Auckland, UTC+13).
{
  const a = await user('Aya', { tz: 'Pacific/Auckland' }), b = await user('Bix', { solo: false });
  // Paired at 2026-12-05T11:30Z = 2026-12-06 00:30 in Auckland.
  await db.exec(`insert into couple_members (couple_id, user_id, joined_at) values ('${a.couple}', '${b.id}', '2026-12-05T11:30:00Z')`);
  ok(new Date((await db.query('select paired_at from couples where id = $1', [a.couple])).rows[0].paired_at).toISOString() === '2026-12-05T11:30:00.000Z', 'any path that adds the second member sets paired_at (trigger)');
  const day = await cq(a.couple, { day: '2026-12-06', createdAt: '2026-12-05T10:00:00Z' });   // created before pairing, local day of pairing
  const prev = await cq(a.couple, { day: '2026-12-05', createdAt: '2026-12-04T11:00:00Z' });
  const next = await cq(a.couple, { day: '2026-12-07', createdAt: '2026-12-06T11:00:00Z' });
  const inPeriod = async id => (await db.query('select private.cq_in_pair_period($1) r', [id])).rows[0].r;
  ok(await inPeriod(day) === true, 'the daily question of the local pairing date is in the period even though it was created earlier');
  ok(await inPeriod(prev) === false, 'the previous local day is not');
  ok(await inPeriod(next) === true, 'a later question is');
  ok((await db.query(`select private.cq_in_pair_period(gen_random_uuid()) r`)).rows[0].r === false, 'an unknown question is not');
  ok(/permission denied/.test(await errorOf('anon', null, 'select private.cq_in_pair_period(gen_random_uuid())') ?? ''), 'anon cannot call the helper');
}

// ═══ F5: D04 lock order and re-check (interleavings reproduced with the race seam) ═══
// A hook = per-point SQL run inside private.race_point(); `watch` snapshots counts into sequences
// at 'refused' (sequences are not rolled back, and the refusal raises, which rolls everything else back).
const hook = ({ lockPoint = 'before_couple_lock', run = null, watch = null }) => db.exec(`
  create sequence if not exists t_a; create sequence if not exists t_b; create sequence if not exists t_c;
  select setval('t_a', 1), setval('t_b', 1), setval('t_c', 1), set_config('test.arm', 'on', false);
  create or replace function private.race_point(p_name text) returns void language plpgsql as $$
  declare v_sub text := current_setting('request.jwt.claim.sub', true);
  begin
    if p_name = '${lockPoint}' and current_setting('test.arm', true) = 'on' then
      perform set_config('test.arm', 'off', false);
      ${run ?? ''}
      perform set_config('request.jwt.claim.sub', v_sub, false);
    elsif p_name = 'refused' then
      ${watch ?? ''}
    end if;
  end $$;`);
const competitor = (other, code, token, now) => `perform set_config('request.jwt.claim.sub', '${other}', false);
      perform private.accept_invite_at('${code}', '${token}', '${now}'::timestamptz);`;
const seen = async () => Object.fromEntries(await Promise.all(['a', 'b', 'c'].map(async k => [k, (await db.query(`select last_value::int - 1 v from t_${k}`)).rows[0].v])));
const noHook = () => db.exec(`create or replace function private.race_point(p_name text) returns void language plpgsql as $$ begin end $$;`);
const T = '2026-12-10T10:00:00Z';
{
  // The data-loss interleaving: A (solo) accepts B's invite while C accepts A's.
  const a = await user('Ann'), b = await user('Ben'), c = await user('Cam');
  const ia = await mkInvite(a.id, T), ib = await mkInvite(b.id, T);
  await hook({ run: competitor(c.id, ia.code, ia.token, at(T, MIN)), watch: `
      perform setval('t_a', 1 + (select count(*) from couple_members where couple_id = '${a.couple}' and user_id = '${c.id}'));
      perform setval('t_b', 1 + (select count(*) from couples where id = '${a.couple}'));
      perform setval('t_c', 1 + (select count(*) from couples where id = '${b.couple}'));` });
  const r = await accept(a.id, ib.code, ib.token, at(T, MIN));
  await noHook();
  ok(r.code === 'ALREADY_PAIRED' && r.raised, 'F5: A\'s accept notices that her couple filled up while she waited → ALREADY_PAIRED');
  const s = await seen();
  ok(s.a === 1 && s.b === 1, 'F5: at the refusal C is still a member of A\'s couple and that couple still exists (the old code went on to delete it, taking C\'s new membership with it)');
  ok(s.c === 1, 'F5: B\'s couple is untouched');
}
{
  // The deadlock interleaving: A accepts B's invite while B accepts A's.
  const a = await user('Dee'), b = await user('Eli');
  const ia = await mkInvite(a.id, T), ib = await mkInvite(b.id, T);
  await hook({ run: competitor(b.id, ia.code, ia.token, at(T, MIN)), watch: `
      perform setval('t_a', 1 + (select count(*) from couple_members where couple_id = '${a.couple}'));
      perform setval('t_b', 1 + (select count(*) from couples c join couple_members m on m.couple_id = c.id
        where c.id = '${b.couple}' and m.user_id = '${b.id}' and c.status = 'ended' and m.left_at is not null));` });
  const r = await accept(a.id, ib.code, ib.token, at(T, MIN));
  await noHook();
  ok(r.code === 'ALREADY_PAIRED', 'F5: crossing accepts: the second one gets ALREADY_PAIRED, no error from the database');
  const s = await seen();
  ok(s.a === 2 && s.b === 1, 'F5: both are in one active couple and the other solo couple is retained as an ended archive (one winner, nothing lost)');
}
{
  // Both couples are locked, in one statement, before any decision is read (xmax shows the row lock).
  const a = await user('Fay'), b = await user('Gus');
  const ib = await mkInvite(b.id, T);
  await hook({ lockPoint: 'couples_locked', watch: '', run: `
      perform setval('t_a', 1 + (select (xmax::text::bigint <> 0)::int from couples where id = '${a.couple}'));
      perform setval('t_b', 1 + (select (xmax::text::bigint <> 0)::int from couples where id = '${b.couple}'));` });
  await accept(a.id, ib.code, ib.token, at(T, MIN));
  await noHook();
  const s = await seen();
  ok(s.a === 1 && s.b === 1, 'F5: the caller\'s solo couple and the inviter\'s couple are both row-locked before the decision');
}
{
  // A solo couple that gained a member after the locks is never deleted.
  const a = await user('Hal'), b = await user('Ivo'), c = await user('Jon');
  const ib = await mkInvite(b.id, T);
  await db.exec(`delete from couples where id = '${c.couple}'`);
  await hook({ lockPoint: 'couples_locked', run: `insert into couple_members (couple_id, user_id) values ('${a.couple}', '${c.id}');`, watch: `
      perform setval('t_a', 1 + (select count(*) from couple_members where couple_id = '${a.couple}'));
      perform setval('t_b', 1 + (select count(*) from couples where id = '${a.couple}'));` });
  const r = await accept(a.id, ib.code, ib.token, at(T, MIN));
  await noHook();
  const s = await seen();
  ok(r.code === 'ALREADY_PAIRED' && s.a === 2 && s.b === 1, 'F5: a solo couple that gained a member under the lock is kept, the accept is refused');
}

// ═══ F8: the actor's advisory lock ═══
{
  const x = await user('Kim');
  await db.exec(`create table if not exists test_adv (fn text, n int)`);
  const probe = fn => db.exec(`
    create or replace function private.race_point(p_name text) returns void language plpgsql as $$
    begin
      if p_name = 'actor_locked' then
        insert into test_adv select '${fn}', count(*) from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and granted;
      end if;
    end $$;`);
  await probe('accept'); await accept(x.id, '0000', null, at(T, MIN));
  await probe('preview'); await preview(x.id, '0000', null, at(T, MIN));
  await probe('anon-preview'); await preview(null, '0000', null, at(T, MIN), { 'cf-connecting-ip': '203.0.113.5' });
  await noHook();
  const rows = (await db.query('select fn, n::int n from test_adv order by fn')).rows;
  ok(rows.length === 3 && rows.every(r => r.n === 1), 'F8: accept_invite, invite_preview and anon invite_preview each hold one advisory lock on the actor before the limiter check');
  ok(await count(`select count(*)::int n from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()`) === 0, 'F8: the lock is transaction-scoped (released at the end)');
}

// ═══ F4: cheap, bounded counting ═══
{
  const h = await user('Mo'); const H = '2026-12-11T08:00:00Z';
  for (let i = 0; i < 4; i++) await accept(h.id, '12ab', null, at(H, i * SEC));
  ok(await count('select coalesce(sum(n), 0)::int n from private.invite_failure_counts where bucket = $1::timestamptz', [H]) === 4, 'F4: failures bump a per-hour sharded counter');
  ok(await count('select count(*)::int n from private.invite_failure_counts where bucket = $1::timestamptz', [H]) <= 16, 'F4: at most 16 shard rows per hour, however many failures');
  ok(await count('select count(*)::int n from private.security_alerts where bucket = $1::timestamptz', [H]) === 0, 'F4: no alert row below the cap');
  for (let i = 0; i < 100; i++) await preview(null, '12ab', null, at(H, 10 * SEC + i * SEC), { 'cf-connecting-ip': `10.9.0.${i}` });
  const alert = (await db.query(`select xmin::text x, detail from private.security_alerts where bucket = $1::timestamptz`, [H])).rows;
  ok(alert.length === 1 && alert[0].detail.failures_in_hour >= 100, 'F4: crossing the cap writes the alert once');
  for (let i = 0; i < 20; i++) await preview(null, '12ab', null, at(H, 200 * SEC + i * SEC), { 'cf-connecting-ip': `10.8.0.${i}` });
  const again = (await db.query(`select xmin::text x from private.security_alerts where bucket = $1::timestamptz`, [H])).rows;
  ok(again.length === 1 && again[0].x === alert[0].x, 'F4: after that the alert row is never rewritten (no hot-row updates)');
  ok((await db.query(`select indexdef from pg_indexes where tablename = 'invite_attempts' and indexname = 'invite_attempts_by_actor'`)).rows[0].indexdef.includes('(actor, created_at)'), 'F4: attempts are indexed by (actor, created_at), the limiter reads at most 5 rows');
  await db.query(`select private.purge_pairing_data($1::timestamptz)`, [at(H, 3 * DAY)]);
  ok(await count('select count(*)::int n from private.invite_failure_counts') === 0 && await count('select count(*)::int n from private.invite_attempts') === 0, 'F4: the purge drops old attempts and counters');
}

// ═══ F9: create_invite throttle and purge ═══
{
  const t = await user('Nia'), u = await user('Oz'); const C0 = '2026-12-12T08:00:00Z';
  for (let i = 0; i < 10; i++) await mkInvite(t.id, at(C0, i * MIN));
  const r11 = await core(t.id, 'create_invite_at', [], at(C0, 10 * MIN));
  ok(r11.raised && r11.code === 'RATE_LIMITED', 'F9: the 11th invite within an hour → RATE_LIMITED');
  ok((await core(u.id, 'create_invite_at', [], at(C0, 10 * MIN))).code === 'OK', 'F9: another user is unaffected');
  ok((await core(t.id, 'create_invite_at', [], at(C0, HOUR))).code === 'OK', 'F9: allowed again once the oldest of the ten is an hour old');
  ok(await count('select count(*)::int n from pair_invites where inviter_id = $1 and accepted_at is null and revoked_at is null', [t.id]) === 1, 'F9: still exactly one live invite');
  // Purge: revoked, expired and used invites and their tokens go after a week; live ones stay.
  await db.exec(`delete from pair_invites`);
  const P0 = '2026-12-20T08:00:00Z';
  const old = await mkInvite(t.id, at(P0, -10 * DAY));       // expired 8 days ago
  const oldId = (await db.query(`select id from pair_invites where code = $1`, [old.code])).rows[0].id;
  const fresh = await mkInvite(u.id, at(P0, -DAY));          // live
  await db.query(`select private.purge_pairing_data($1::timestamptz)`, [P0]);
  ok(await count('select count(*)::int n from pair_invites where code = $1', [old.code]) === 0 && await count('select count(*)::int n from private.invite_tokens where invite_id = $1', [oldId]) === 0, 'F9: an invite that expired more than a week ago is purged, with its token hash');
  ok(await count('select count(*)::int n from pair_invites where code = $1', [fresh.code]) === 1, 'F9: a live invite stays');
  await db.exec(`insert into pair_invites (code, inviter_id, couple_id, created_at, expires_at, revoked_at) values ('5151', '${t.id}', '${t.couple}', '${at(P0, -9 * DAY)}', '${at(P0, -7 * DAY)}', '${at(P0, -8 * DAY)}')`);
  await db.exec(`insert into pair_invites (code, inviter_id, couple_id, created_at, expires_at, revoked_at) values ('5152', '${t.id}', '${t.couple}', '${at(P0, -3 * DAY)}', '${at(P0, -1 * DAY)}', '${at(P0, -2 * DAY)}')`);
  await db.query(`select private.purge_pairing_data($1::timestamptz)`, [P0]);
  ok(await count(`select count(*)::int n from pair_invites where code = '5151'`) === 0 && await count(`select count(*)::int n from pair_invites where code = '5152'`) === 1, 'F9: a revoked invite is purged after a week, not before');
  ok(/permission denied/.test(await errorOf('authenticated', t.id, 'select private.purge_pairing_data()') ?? ''), 'F9: clients cannot call the purge');
}

// ═══ F10: user text shown to anon ═══
{
  await db.exec(`insert into private.app_settings (key, value) values ('storage_host', 'proj.supabase.co') on conflict (key) do update set value = excluded.value`);
  const GOOD = 'https://proj.supabase.co/storage/v1/object/public/avatars/00000000-0000-0000-0000-000000000009/avatar.jpg';
  const p = await user('Pat'); const P1 = '2026-12-13T08:00:00Z';
  const inv = await mkInvite(p.id, P1);
  const avatarFor = async url => {
    await db.query('update profiles set avatar_url = $1 where id = $2', [url, p.id]);
    return (await preview(null, inv.code, null, P1)).value.inviter_avatar_url;
  };
  ok(await avatarFor(GOOD) === null, 'F10: a private avatar is never returned to an anonymous preview');
  for (const [bad, why] of [['https://evil.test/storage/v1/object/public/avatars/x/a.jpg', 'another host'], ['http://proj.supabase.co/storage/v1/object/public/avatars/x/a.jpg', 'plain http'],
    ['https://proj.supabase.co.evil.test/storage/v1/object/public/avatars/x/a.jpg', 'a host that merely starts with ours'], ['https://proj.supabase.co@evil.test/storage/v1/object/public/avatars/x/a.jpg', 'a userinfo trick'],
    ['https://proj.supabase.co/other/path.jpg', 'a path outside the avatars bucket'], [GOOD + ' onerror=1', 'whitespace'], ['javascript:alert(1)', 'a script URL'], [null, 'no avatar']]) {
    ok(await avatarFor(bad) === null, `F10: avatar URL is never returned (${why})`);
  }
  await db.exec(`delete from private.app_settings where key = 'storage_host'`);
  ok(await avatarFor(GOOD) === null, 'F10: with no storage_host configured no avatar is returned (fails closed)');
  await db.exec(`update profiles set display_name = '${'W'.repeat(60)}' where id = '${p.id}'`);
  ok((await preview(null, inv.code, null, P1)).value.inviter_name === 'W'.repeat(30), 'F10: the preview name is cut at 30 characters');
  ok(/profiles_display_name_length/.test(await errorOf('authenticated', p.id, `update profiles set display_name = $1 where id = $2`, ['x'.repeat(61), p.id]) ?? ''), 'F10: display_name over 60 characters is rejected');
  await as(p.id, `update profiles set display_name = $1 where id = $2`, ['x'.repeat(60), p.id]);
  ok(/profiles_avatar_url_length/.test(await errorOf('authenticated', p.id, `update profiles set avatar_url = $1 where id = $2`, ['https://x.test/' + 'a'.repeat(500), p.id]) ?? ''), 'F10: avatar_url over 500 characters is rejected');
}

// ═══ F11: settings columns ═══
{
  const g = await user('Gil');
  ok(/couples_goals_length/.test(await errorOf('authenticated', g.id, `update couples set goals = $1`, [['ok', 'y'.repeat(61)]]) ?? ''), 'F11: a goal over 60 characters is rejected');
  await as(g.id, `update couples set goals = $1`, [['a'.repeat(60), 'b']]);
  ok((await as(g.id, 'select goals from couples')).rows[0].goals.length === 2, 'F11: 60 characters is fine');
  await as(g.id, `select create_couple('dating', $1, null)`, [['z'.repeat(80), 'z'.repeat(80) + 'q', 'short']]);
  const goals = (await as(g.id, 'select goals from couples')).rows[0].goals;
  ok(goals.length === 2 && goals[0] === 'z'.repeat(60) && goals[1] === 'short', 'F11: create_couple cuts goals to 60 characters (and the cut duplicates merge)');
  for (const bad of ['Mars/Olympus', 'EST', 'UTC+3', '', 'Europe/Berlin; drop']) {
    ok(/couples_timezone_is_iana/.test(await errorOf('authenticated', g.id, `update couples set timezone = $1`, [bad]) ?? ''), `F11: couples.timezone ${JSON.stringify(bad)} is rejected`);
  }
  await as(g.id, `update couples set timezone = 'Asia/Tokyo'`);
  ok((await as(g.id, 'select timezone from couples')).rows[0].timezone === 'Asia/Tokyo', 'F11: a valid IANA timezone is accepted');
  ok(/profiles_timezone_is_iana/.test(await errorOf('authenticated', g.id, `update profiles set timezone = 'Mars/Olympus' where id = $1`, [g.id]) ?? ''), 'F11: profiles.timezone is checked as well');
}

// ═══ F12: search_path and schema privileges ═══
{
  const defs = (await db.query(`select p.oid::regprocedure::text sig, array_to_string(p.proconfig, ',') cfg from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosecdef and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`)).rows;
  const bad = defs.filter(d => !(d.cfg ?? '').includes('search_path=pg_catalog, extensions, public, pg_temp')).map(d => d.sig);
  ok(defs.length > 10 && bad.length === 0, `F12: all ${defs.length} SECURITY DEFINER functions use search_path = pg_catalog, extensions, public, pg_temp${bad.length ? ` (not: ${bad})` : ''}`);
  ok(!(await db.query(`select has_schema_privilege('authenticated', 'public', 'create') or has_schema_privilege('anon', 'public', 'create') c`)).rows[0].c, 'F12: anon and authenticated cannot create objects in public');
  // A function planted in public can't shadow digest()/gen_random_bytes() for definer code.
  await db.exec(`create function public.digest(text, text) returns bytea language plpgsql as $$ begin raise exception 'SHADOWED'; end $$;
    create function public.gen_random_bytes(int) returns bytea language plpgsql as $$ begin raise exception 'SHADOWED'; end $$;`);
  const s = await user('Sia');
  const made = await errorOf('authenticated', s.id, 'select (create_invite()).code');
  ok(made === null, `F12: create_invite still uses pgcrypto's digest and gen_random_bytes with look-alikes in public${made ? ` (${made})` : ''}`);
  await db.exec(`drop function public.digest(text, text); drop function public.gen_random_bytes(int);`);
}

console.log(`\n${passed} passed, ${failed} failed`);
await db.close();
