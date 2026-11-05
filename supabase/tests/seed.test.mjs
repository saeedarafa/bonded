// BE-05: supabase/seed.sql = content + the persona scenarios of qa/fixtures/personas.json.
// Applies the real seed.sql to PGlite, then every scenario with a pinned clock and checks the state
// the fixture describes, including the reveal rule and couple isolation on the seeded data.
// Usage: node supabase/tests/seed.test.mjs
import fs from 'fs';
import path from 'path';
import { createDb, supabaseDir } from './pglite-supabase.mjs';
import { buildSeed } from '../scripts/build-seed.mjs';

const personasFile = JSON.parse(fs.readFileSync(path.join(supabaseDir, '..', 'qa', 'fixtures', 'personas.json'), 'utf8'));
const P = Object.fromEntries(Object.entries(personasFile.personas).map(([k, v]) => [k, v.id]));
const fixtureScenarios = personasFile.scenarios.map(s => s.id);

let db;
try { db = await createDb(); } catch (e) { console.error(`FAIL ${e.message}`); process.exit(1); }
let passed = 0, failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (c) passed++; else { failed++; process.exitCode = 1; } };
const as = async (uid, sql, params) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
};
const count = async (sql, params) => (await db.query(sql, params)).rows[0].n;
const asCount = async (uid, sql, params) => (await as(uid, sql, params)).rows[0].n;
const NOW = '2026-12-01T12:00:00Z';                      // Berlin 13:00 on 2026-12-01; Tokyo 21:00
const TODAY = '2026-12-01';
const apply = id => db.query(`select dev_seed.apply_scenario($1, $2::timestamptz)`, [id, NOW]);
const core = async (uid, fn, args) => {                   // private.*_at at the pinned clock, as the owner
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', false), set_config('request.headers', '', false)`);
  try {
    const r = await db.query(`select private.${fn}($1, $2, $3::timestamptz) j, current_setting('response.status', true) s`, [...args, NOW]);
    return r.rows[0].s === '400' ? r.rows[0].j.message : (r.rows[0].j ?? 'OK');
  } catch (e) { return e.message; }
};
const MAYA_SAM = personasFile.couples.maya_sam.id;
// An answer "written now" at the pinned clock (NOW), as the owner: the clients' own inserts use the
// real clock, which can't count for a question assigned on a pinned day (D17).
const ownerAnswer = async (cq, uid, body) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '', false)`);
  await db.query(`insert into answers (couple_question_id, user_id, body, created_at) values ($1, $2, $3, $4::timestamptz)`, [cq, uid, body, NOW]);
};
const mayaSam = sql => count(sql.replace('$C', `'${MAYA_SAM}'`));

// ═══ The real seed.sql, as `supabase db reset` runs it ═══
const seedSql = fs.readFileSync(path.join(supabaseDir, 'seed.sql'), 'utf8');
ok(seedSql === buildSeed({ includeAgeGated: false }), 'supabase/seed.sql is up to date (node supabase/scripts/build-seed.mjs)');
try { await db.exec(seedSql); ok(true, 'seed.sql applies on an empty database after all migrations'); } catch (e) { ok(false, `seed.sql applies: ${e.message}`); process.exit(1); }
ok(await count(`select count(*)::int n from auth.users where email like '%@bonded.test'`) === 6 && await count('select count(*)::int n from auth.identities') === 6, 'six persona accounts with email identities (sign in by OTP)');
ok(JSON.stringify((await db.query('select email, display_name, timezone from profiles p join auth.users u on u.id = p.id where u.id = $1', [P.maya])).rows) === '[{"email":"maya@bonded.test","display_name":"Maya","timezone":"Europe/Berlin"}]', 'profiles carry name and timezone from personas.json');
ok(await count('select count(*)::int n from questions') === 153 && await count('select count(*)::int n from question_packs') === 6, 'content loaded: 153 questions, 6 packs (no 18+ pack)');
ok(await count(`select count(*)::int n from question_packs where age_gate is not null`) === 0, 'D33: the 18+ pack is not in the seed');
ok(await count(`select count(*)::int n from couples`) === 3 && await count(`select count(*)::int n from couple_members`) === 5, 'default state: maya_sam, eve_finn and lea_solo');
await db.exec(seedSql);
ok(await count(`select count(*)::int n from couples`) === 3 && await count('select count(*)::int n from questions') === 153 && await count('select count(*)::int n from auth.users') === 6, 'seed.sql is re-runnable (same state, no duplicates)');
await db.exec(`insert into auth.users (id, email) values ('99999999-0000-4000-a000-000000000001', 'real.person@example.com')`);
ok(/refuses to run/.test(await db.exec(seedSql).then(() => '', e => e.message)), 'seed.sql refuses to run next to a real (non-@bonded.test) user');
await db.exec(`delete from auth.users where email = 'real.person@example.com'`);
ok(/permission denied/.test(await as(P.maya, 'select * from dev_seed.persona').then(() => '', e => e.message)) && /permission denied/.test(await as(P.maya, `select dev_seed.apply_scenario('empty-history')`).then(() => '', e => e.message)), 'clients cannot read or call dev_seed');
ok(JSON.stringify((await db.query('select id from dev_seed.scenarios()')).rows.map(r => r.id).sort()) === JSON.stringify([...fixtureScenarios].sort()), `dev_seed knows exactly the ${fixtureScenarios.length} scenarios of personas.json`);

// ═══ Scenarios ═══
// fresh-install
await apply('fresh-install');
ok(await count('select count(*)::int n from auth.users where id = $1', [P.noor]) === 0 && await count('select count(*)::int n from couples') === 0 && await count('select count(*)::int n from auth.users') === 5, 'fresh-install: Noor has no account, no couples, content loaded');

// solo-invite-pending
await apply('solo-invite-pending');
{
  ok(await mayaSam(`select count(*)::int n from couple_members where couple_id = $C`) === 1 && await count('select count(*)::int n from auth.users where id = $1', [P.sam]) === 0, 'solo-invite-pending: Maya alone in maya_sam; Sam has no account');
  const inv = (await db.query(`select code, partner_name, created_at, expires_at from pair_invites where inviter_id = $1`, [P.maya])).rows[0];
  ok(inv.code === '4827' && inv.partner_name === 'Sam' && new Date(inv.created_at).toISOString() === '2026-12-01T11:00:00.000Z' && new Date(inv.expires_at).toISOString() === '2026-12-03T11:00:00.000Z', 'invite 4827 (BND·4827), partner_name Sam, created 1 h ago, expires in 47 h');
  const day1 = (await db.query(`select q.external_id, a.body from couple_questions cq join questions q on q.id = cq.question_id join answers a on a.couple_question_id = cq.id where cq.couple_id = $1`, [MAYA_SAM])).rows;
  ok(day1.length === 1 && day1[0].external_id === 'special-first_day' && day1[0].body.startsWith('Your laugh.'), 'Maya answered the first_day question');
  const pv = await core(null, 'invite_preview_at', ['4827', null]);
  ok(pv.inviter_name === 'Maya' && pv.inviter_answered_today === true, 'Sam\'s invite preview shows Maya, and that she already answered');
  ok((await core(null, 'invite_preview_at', ['4827', 'dev-seed-token-4827'])).inviter_name === 'Maya', 'the dev link token works: /j/BND4827?t=dev-seed-token-4827');
  ok(await as(P.lea, 'select count(*)::int n from pair_invites').then(r => r.rows[0].n) === 0, 'another user cannot see the invite');
}

// paired-day1-partner-answered
await apply('paired-day1-partner-answered');
{
  ok(await mayaSam(`select count(*)::int n from couple_members where couple_id = $C`) === 2 && await count(`select count(*)::int n from pair_invites where accepted_by = $1`, [P.sam]) === 1, 'paired-day1: Sam redeemed 4827 and is in the couple');
  ok(await asCount(P.sam, 'select count(*)::int n from answers') === 0 && await asCount(P.sam, 'select answer_count::int n from couple_questions') === 1, 'reveal rule: Sam sees only that Maya answered, not what');
  const cq = (await db.query('select id from couple_questions where couple_id = $1', [MAYA_SAM])).rows[0].id;
  await ownerAnswer(cq, P.sam, 'Her smile.');
  ok((await as(P.sam, 'select body from answers')).rows.some(r => r.body.startsWith('Your laugh.')), 'J7: once Sam answers he sees Maya\'s answer immediately');
  ok(await mayaSam(`select current::int n from couple_streaks where couple_id = $C`) === 1, 'both answered day 1: streak 1');
}

// invite-expired, invite-wrong-code, couple-full
await apply('invite-expired');
ok(await core(P.lea, 'accept_invite_at', ['4827', null]) === 'INVITE_EXPIRED', 'invite-expired: 4827 → INVITE_EXPIRED (Lea\'s solo couple is no obstacle, D04)');
await apply('invite-wrong-code');
{
  ok(await core(P.lea, 'accept_invite_at', ['1111', null]) === 'INVALID_CODE', 'invite-wrong-code: 1111 → INVALID_CODE');
  for (let i = 0; i < 4; i++) await core(P.lea, 'accept_invite_at', ['1111', null]);
  ok(await core(P.lea, 'accept_invite_at', ['1111', null]) === 'RATE_LIMITED', 'the 6th failed attempt within 15 min → RATE_LIMITED');
}
await apply('couple-full');
ok(await core(P.lea, 'accept_invite_at', ['4827', null]) === 'COUPLE_FULL' && await count(`select count(*)::int n from couples where id = $1`, [personasFile.couples.lea_solo.id]) === 1, 'couple-full: Lea (solo) redeems 4827 → COUPLE_FULL, her solo couple stays');

// streak-11-your-turn
await apply('streak-11-your-turn');
{
  const st = (await db.query('select current, longest, last_completed_on::text d from couple_streaks where couple_id = $1', [MAYA_SAM])).rows[0];
  ok(st.current === 11 && st.longest === 11 && st.d === '2026-11-30', 'streak-11-your-turn: current 11, longest 11, last completed yesterday');
  const today = (await db.query(`select cq.id, q.external_id, q.body, cq.answer_count from couple_questions cq join questions q on q.id = cq.question_id where cq.couple_id = $1 and cq.assigned_for = $2`, [MAYA_SAM, TODAY])).rows[0];
  ok(today.external_id === 'd001' && today.body === 'What\'s a small thing I do that makes your day better?' && today.answer_count === 1, 'today\'s question is d001; one answer');
  ok(await mayaSam(`select count(*)::int n from couple_questions where couple_id = $C`) === 12, 'day 12: 11 earlier days plus today');
  ok((await as(P.maya, 'select body from answers where couple_question_id = $1', [today.id])).rows.length === 0, 'reveal rule: Maya (not answered) cannot read Sam\'s answer to today\'s question');
  ok(await asCount(P.maya, 'select count(*)::int n from answers') === 22, '... but reads the 22 answers of the 11 earlier days');
  ok(await asCount(P.sam, 'select count(*)::int n from answers where couple_question_id = $1', [today.id]) === 1, 'Sam sees his own');
  ok((await db.query('select body from answers where couple_question_id = $1', [today.id])).rows[0].body.startsWith('When you hum while cooking.'), 'Sam\'s answer is the board text');
  await ownerAnswer(today.id, P.maya, 'coffee');
  ok(await mayaSam(`select current::int n from couple_streaks where couple_id = $C`) === 12, 'Maya answering makes the streak 12');
  ok(await asCount(P.maya, 'select count(*)::int n from answers where couple_question_id = $1', [today.id]) === 2, '... and reveals Sam\'s answer to her');
}

// streak-11-both-answered and outsider-couple
for (const id of ['streak-11-both-answered', 'outsider-couple']) {
  await apply(id);
  const st = (await db.query('select current, longest, last_completed_on::text d from couple_streaks where couple_id = $1', [MAYA_SAM])).rows[0];
  ok(st.current === 12 && st.longest === 12 && st.d === TODAY, `${id}: streak 12, last completed today`);
  const cq = (await db.query(`select id from couple_questions where couple_id = $1 and assigned_for = $2`, [MAYA_SAM, TODAY])).rows[0].id;
  ok((await as(P.maya, 'select body from thread_messages where couple_question_id = $1 order by created_at', [cq])).rows.map(r => r.body).join('|') === 'Wait, I hum while I cook??|Every single time. Please never stop.|Okay, tomorrow the coffee is on me.|Deal. Bring the humming too.', `${id}: the four thread messages`);
  ok((await as(P.maya, `select kind::text k from reactions r join answers a on a.id = r.answer_id where a.user_id = $1`, [P.maya])).rows.map(r => r.k).join() === 'love', `${id}: Sam reacted love on Maya's answer`);
  ok(await asCount(P.maya, 'select count(*)::int n from answers where couple_question_id = $1', [cq]) === 2, `${id}: Maya sees both of today's answers`);
  // Isolation both ways (outsider-couple): Eve and Finn never see maya_sam rows, and vice versa.
  const eveAnswers = await as(P.eve, 'select body from answers');
  ok(eveAnswers.rows.length === 6 && eveAnswers.rows.every(r => /^Seed answer from (Eve|Finn)/.test(r.body)), `${id}: Eve sees only eve_finn's 6 answers`);
  ok(await asCount(P.eve, `select count(*)::int n from couples`) === 1 && await asCount(P.eve, 'select count(*)::int n from thread_messages') === 6 && await asCount(P.eve, 'select count(*)::int n from reactions') === 3, `${id}: Eve sees her couple, 6 messages and 3 reactions only`);
  ok(await asCount(P.maya, `select count(*)::int n from answers where body like 'Seed answer from Eve%' or body like 'Seed answer from Finn%'`) === 0 && await asCount(P.finn, `select count(*)::int n from answers where body like '%Maya%' or body like 'When you%'`) === 0, `${id}: Maya sees nothing of eve_finn, Finn nothing of maya_sam`);
  ok(await asCount(P.noor, 'select count(*)::int n from couples') === 0 && await asCount(P.lea, 'select count(*)::int n from answers') === 0, `${id}: Noor (no couple) and Lea (solo, unanswered) see no answers`);
}

// streak-6-milestone
await apply('streak-6-milestone');
{
  const st = (await db.query('select current, last_completed_on::text d from couple_streaks where couple_id = $1', [MAYA_SAM])).rows[0];
  ok(st.current === 6 && st.d === '2026-11-30', 'streak-6-milestone: streak 6, last completed yesterday');
  const cq = (await db.query(`select id, answer_count from couple_questions where couple_id = $1 and assigned_for = $2`, [MAYA_SAM, TODAY])).rows[0];
  ok(cq.answer_count === 1, 'Sam answered today, Maya has not');
  await ownerAnswer(cq.id, P.maya, 'x');
  ok(await mayaSam(`select current::int n from couple_streaks where couple_id = $C`) === 7, 'Maya answering makes the streak 7 (the streak-7 badge trigger point)');
}

// missed-day-*
await apply('missed-day-napping');
{
  const st = (await db.query('select current, longest, last_completed_on::text d from couple_streaks where couple_id = $1', [MAYA_SAM])).rows[0];
  ok(st.current === 11 && st.longest === 41 && st.d === '2026-11-29', 'missed-day-napping: current 11 and longest 41 as of day -2');
  ok(await mayaSam(`select count(*)::int n from couple_questions where couple_id = $C and assigned_for >= '2026-11-30'`) === 0, 'yesterday was missed and today not opened');
  ok(!(await db.query(`select private.is_couple_premium($1) p`, [MAYA_SAM])).rows[0].p, 'free couple');
}
await apply('missed-day-premium-saver');
ok((await db.query(`select private.is_couple_premium($1) p`, [MAYA_SAM])).rows[0].p && await count(`select count(*)::int n from entitlements where user_id = $1 and is_active`, [P.maya]) === 1, 'missed-day-premium-saver: Maya has an active entitlement, so the couple is premium');

// BE-11: execute the fixture's promised eleven-day restoration, then reseed it.
await db.exec(`select set_config('request.jwt.claim.sub', '${P.maya}', false)`);
const saved = (await db.query('select (s).* from (select private.use_streak_saver_at($1::timestamptz) s) x', [NOW])).rows[0];
ok(saved.current === 11 && saved.longest === 41 && !saved.completed_today && !saved.saver_available,
  'missed-day-premium-saver: restores eleven to eleven, longest41, no fabricated completion');
await db.exec(`select set_config('request.jwt.claim.sub', '${P.sam}', false)`);
ok((await db.query('select (private.use_streak_saver_at($1::timestamptz)).current n', [NOW])).rows[0].n === 11,
  'seeded partner retry preserves the same restored eleven-day run');
await db.exec("select set_config('request.jwt.claim.sub', '', false)");
await apply('missed-day-premium-saver');
ok(await count('select count(*)::int n from private.streak_savers') === 0, 'reapplying persona scenario clears prior saver claims through couple cascade');

// premium-couple, free-couple-packs, empty-history
await apply('premium-couple');
{
  const e = (await db.query('select is_active, product_id, store, expires_at from entitlements')).rows;
  ok(e.length === 1 && e[0].is_active && e[0].product_id === 'yearly_trial' && e[0].store === 'app_store' && Math.round((new Date(e[0].expires_at) - new Date(NOW)) / 864e5) === 300, 'premium-couple: Maya yearly_trial via app_store, expires in 300 days');
  ok(await asCount(P.sam, 'select count(*)::int n from entitlements') === 1 && await asCount(P.sam, `select count(*)::int n from entitlements where user_id = '${P.sam}'`) === 0, 'Sam has no row of his own but sees Maya\'s ("on Maya\'s plan")');
}
await apply('free-couple-packs');
ok(await count('select count(*)::int n from entitlements') === 0 && await mayaSam('select count(*)::int n from couple_members where couple_id = $C') === 2, 'free-couple-packs: paired, no entitlements');
await apply('empty-history');
ok(await mayaSam('select count(*)::int n from couple_questions where couple_id = $C') === 0 && await mayaSam('select count(*)::int n from couple_members where couple_id = $C') === 2, 'empty-history: paired today, nothing answered');

// history-month and delete-account
await apply('history-month');
{
  ok(await mayaSam(`select count(*)::int n from couple_questions where couple_id = $C`) === 28, 'history-month: 28 days with a question (2 missed)');
  ok(await mayaSam(`select count(*)::int n from couple_questions where couple_id = $C and answer_count = 2`) === 24 && await mayaSam(`select count(*)::int n from couple_questions where couple_id = $C and answer_count = 1`) === 4, 'both answered on 24 days, one on 4');
  const d4 = (await db.query(`select cq.id, q.body from couple_questions cq join questions q on q.id = cq.question_id where cq.couple_id = $1 and cq.assigned_for = '2026-11-27'`, [MAYA_SAM])).rows[0];
  ok(d4.body === 'When did you feel most proud of me?' && await count('select count(*)::int n from thread_messages where couple_question_id = $1', [d4.id]) === 6, 'day -4: "When did you feel most proud of me?" with 6 replies');
  ok(await mayaSam(`select count(*)::int n from thread_messages m join couple_questions cq on cq.id = m.couple_question_id where cq.couple_id = $C and cq.assigned_for >= '2026-11-25'`) === 18, 'last 7 days: 18 replies');
  ok(await count(`select count(*)::int n from reactions r where r.user_id in ($1, $2)`, [P.maya, P.sam]) === 11, 'last 7 days: 11 reactions');
  const st = (await db.query('select current, longest, last_completed_on::text d from couple_streaks where couple_id = $1', [MAYA_SAM])).rows[0];
  ok(st.current === 5 && st.longest === 5 && st.d === TODAY, 'the streak the triggers computed from the history: 5, ending today');
  ok(await asCount(P.maya, `select count(*)::int n from answers`) === 52, 'Maya (who answered every day) reads all 52 answers (reveal rule: each day she answered)');
  ok(await asCount(P.sam, `select count(*)::int n from answers`) === 48, 'Sam reads the 48 answers of the 24 days he answered');
}
await apply('delete-account');
{
  ok(await count('select count(*)::int n from auth.users where id = $1', [P.sam]) === 0 && await count('select count(*)::int n from profiles where id = $1', [P.sam]) === 0, 'delete-account: Sam\'s account and profile are gone');
  ok(await count('select count(*)::int n from answers where user_id = $1', [P.sam]) === 0 && await count('select count(*)::int n from thread_messages where user_id = $1', [P.sam]) === 0 && await count('select count(*)::int n from reactions where user_id = $1', [P.sam]) === 0, '... and his answers, messages and reactions');
  ok(await count('select count(*)::int n from answers where user_id = $1', [P.maya]) === 28, 'Maya keeps her own 28 answers');
  const c = (await db.query('select status::text s, ended_at is not null e from couples where id = $1', [MAYA_SAM])).rows[0];
  ok(c.s === 'ended' && c.e && await mayaSam('select count(*)::int n from couple_members where couple_id = $C') === 1, 'the couple is ended; Maya is its only member');
  ok(await mayaSam('select count(*)::int n from couple_questions where couple_id = $C and answer_count > 1') === 0, 'answer counts follow the deleted answers');
}

// partner-left
await apply('partner-left');
{
  const c = (await db.query('select status::text s, ended_at from couples where id = $1', [MAYA_SAM])).rows[0];
  ok(c.s === 'ended' && new Date(c.ended_at).toISOString() === '2026-11-29T12:00:00.000Z', 'partner-left: couple ended 2 days ago');
  ok((await db.query('select count(*)::int n from couple_members where couple_id = $1 and left_at is not null', [MAYA_SAM])).rows[0].n === 2, 'both ended memberships are timestamped');
  ok(await mayaSam('select count(*)::int n from couple_questions where couple_id = $C') === 12 && await asCount(P.maya, 'select count(*)::int n from answers') === 24, '12 days of history, readable by Maya');
}

// anniversary-today
await apply('anniversary-today');
ok((await db.query(`select date::text d from key_dates where couple_id = $1 and kind = 'together_since'`, [MAYA_SAM])).rows[0].d === '2024-06-01', 'anniversary-today: together_since is today minus 2 years 6 months');

// Every scenario in personas.json applies cleanly twice in a row (reset is complete).
for (const id of fixtureScenarios) {
  try { await apply(id); await apply(id); ok(true, `scenario ${id} applies twice`); } catch (e) { ok(false, `scenario ${id}: ${e.message}`); }
}
ok(/unknown scenario/.test(await apply('nope').then(() => '', e => e.message)), 'an unknown scenario id is an error');

console.log(`\n${passed} passed, ${failed} failed`);
await db.close();
