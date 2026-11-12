// BE-19 / #371: the ritual reminder's partner_name is the partner's first name (<= 30 characters),
// like voice messages, little things (functions' `firstName`), invite previews and join requests.
// Real SQL selection with explicit clocks (as reminders.test.mjs); no push network.
// Usage: node supabase/tests/reminder-first-name.test.mjs   (after `npm --prefix supabase/tests ci`)
// Without this task's migration (to show the tests fail): REMINDER_FIRST_NAME_WITHOUT=1 node supabase/tests/reminder-first-name.test.mjs
import { createDb, defaultMigrations } from './pglite-supabase.mjs';

const without = !!process.env.REMINDER_FIRST_NAME_WITHOUT;
const files = without ? defaultMigrations().filter(f => !f.includes('_reminder_first_name')) : defaultMigrations();
let db;
try { db = await createDb(files); } catch (e) { console.error(`FAIL ${e.message}`); process.exit(1); }
let passed = 0, failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (c) passed++; else { failed++; process.exitCode = 1; } };
const errorOf = async (role, sql, args) => {
  await db.exec(`set role ${role}`);
  try { await db.query(sql, args); return null; } catch (e) { return e.message; } finally { await db.exec('reset role'); }
};

// The functions' helper (supabase/functions/_shared/little_things.ts, notify/index.ts), with the
// 30-limit counted in characters (Postgres left()); the same for every name below (no astral chars
// before position 30).
const jsFirstName = name => typeof name === 'string' ? Array.from(name.trim().split(/\s+/)[0] ?? '').slice(0, 30).join('') : '';

const A = '00000000-0000-0000-0371-000000000001', B = '00000000-0000-0000-0371-000000000002';
await db.exec(`insert into auth.users(id) values ('${A}'), ('${B}');
  update profiles set timezone = 'UTC', display_name = 'FIXTURE Maya';
  select set_config('request.jwt.claim.sub', '${A}', false);`);
const c = (await db.query(`select create_couple('dating') c`)).rows[0].c;
await db.query('insert into couple_members(couple_id, user_id) values ($1, $2)', [c, B]);
await db.query(`update couples set timezone = 'UTC', paired_at = '2026-01-01' where id = $1`, [c]);
await db.exec(`select set_config('request.jwt.claim.sub', '', false)`);
const q = (await db.query(`insert into questions(body) values ('FIXTURE #371 question') returning id`)).rows[0].id;
const cq = (await db.query(`insert into couple_questions(couple_id, question_id, source, assigned_for)
  values ($1, $2, 'daily', '2026-11-03') returning id`, [c, q])).rows[0].id;
// B (the partner) answered; A gets the partner_answered ritual reminder at 21:00 UTC.
await db.query(`insert into answers(couple_question_id, user_id, body) values ($1, $2, 'FIXTURE #371 secret answer')`, [cq, B]);

const reminderFor = async displayName => {
  await db.query('update profiles set display_name = $1 where id = $2', [displayName, B]);
  await db.exec('delete from reminder_log; delete from push_log;');
  await db.exec('set role service_role');
  try { return (await db.query(`select * from due_reminders('2026-11-03T21:00Z')`)).rows; }
  finally { await db.exec('reset role'); }
};

// ═══ due_reminders: partner_name = first name ═══
const cases = [
  ['Sam Rivera-Longname', 'Sam', 'two words, hyphenated surname (the #371 report)'],
  ['Anne-Marie Lefebvre-Dubois de la Fontaine', 'Anne-Marie', 'long name with a hyphenated first name: the whole first name, nothing after'],
  ['Mary-Kate-Ashley-Olsen-Fuller-Smith Jr', 'Mary-Kate-Ashley-Olsen-Fuller-', 'hyphenated first word longer than 30: cut at 30 characters'],
  ['  Sam   Rivera  ', 'Sam', 'leading/trailing and repeated spaces'],
  ['Jo Ann Lee', 'Jo', 'no-break space separates words (as JavaScript \\s)'],
  ['Zoë\tBrandt', 'Zoë', 'tab separates words; non-ASCII kept'],
  ['Sam', 'Sam', 'single-word name unchanged'],
];
for (const [name, expected, label] of cases) {
  const rows = await reminderFor(name);
  const r = rows.find(x => x.user_id === A);
  ok(rows.length === 1 && r?.type === 'ritual_reminder' && r.partner_answered === true && r.partner_name === expected,
    `${label}: ${JSON.stringify(name)} -> ${JSON.stringify(r?.partner_name)}`);
  ok(r?.partner_name === jsFirstName(name), `${label}: same as the functions' firstName`);
}
const long = await reminderFor('Sam Rivera-Longname');
ok(!JSON.stringify(long).includes('Rivera'), 'the surname is not in the reminder row');
ok(!JSON.stringify(long).includes('secret answer'), 'no answer text in the reminder row');
const blank = (await reminderFor('   ')).find(x => x.user_id === A);
ok(blank?.partner_name === '' && blank.partner_answered === true,
  'blank display name: empty partner_name (daily-reminder then sends the default variant)');

// ═══ The helper ═══
if (!without) {
  const fn = (await db.query(`select p.provolatile v, p.prosecdef d, p.proconfig cfg,
      pg_get_function_result(p.oid) res
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'first_name'`)).rows;
  ok(fn.length === 1 && fn[0].v === 'i' && fn[0].d === false && fn[0].res === 'text'
    && JSON.stringify(fn[0].cfg) === JSON.stringify(['search_path=pg_catalog']),
    'private.first_name(text): one immutable invoker function, search_path pinned');
  for (const n of [null, '', 'Sam', 'A'.repeat(40) + ' B', '　Kenji　Sato', '﻿Eva Lind'])
    ok((await db.query('select private.first_name($1) r', [n])).rows[0].r === jsFirstName(n),
      `private.first_name(${JSON.stringify(n)}) = firstName`);
  for (const role of ['anon', 'authenticated'])
    ok(/permission denied/.test(await errorOf(role, `select private.first_name('Sam Rivera')`) ?? ''), `${role} cannot call private.first_name`);
}

// ═══ due_reminders: signature and grants unchanged ═══
const sig = (await db.query(`select pg_get_function_result('public.due_reminders(timestamptz)'::regprocedure) r,
  has_function_privilege('service_role', 'public.due_reminders(timestamptz)', 'execute') s,
  has_function_privilege('authenticated', 'public.due_reminders(timestamptz)', 'execute') u,
  has_function_privilege('anon', 'public.due_reminders(timestamptz)', 'execute') a`)).rows[0];
ok(sig.r === 'TABLE(user_id uuid, type push_type, claim_id uuid, streak integer, partner_name text, partner_answered boolean)',
  `due_reminders returns the same columns (${sig.r})`);
ok(sig.s && !sig.u && !sig.a, 'due_reminders: service_role only');
ok(/permission denied/.test(await errorOf('authenticated', `select * from due_reminders('2026-11-03T21:00Z')`) ?? ''),
  'authenticated cannot select reminders');

console.log(`\n${passed} passed, ${failed} failed`);
