// QA-12: front-door flows on one simulator against the LOCAL Supabase stack.
//
//   npm --prefix qa/e2e run onboarding -- <fresh|returning-solo|returning-paired|all> --device <id>
//
//   fresh            scenario fresh-install: noor goes 01 -> 05 -> 07 -> 02 -> 03 -> 04 -> 06 (D50) -> 47 skip (MOB-28)
//                    -> T1 answer -> N "Not now" -> L -> P2 (MOB-61) -> 08 sign-up -> 10 (09 steps aside) -> 11 -> 23.
//                    DB: noor has exactly one active couple (solo), no key dates, stage + goals from the quiz,
//                    exactly one answer (the T1 text) on a daily question, and ritual_time 21:00.
//   returning-solo   D40 (MOB-36), scenario invite-wrong-code (Maya: solo couple, no invite): 01 "I already
//                    have an account" -> 08 -> 10. DB: Maya is still in maya_sam only (no new couple).
//   returning-paired D40, scenario paired-day1-partner-answered: same path, a paired Maya lands on Today.
// Env: SUPABASE_DB_URL / DB_URL (local only), MAILPIT_URL, MAESTRO.
import pg from 'pg';

import { databaseUrl, type Queryable } from '../scripts/seed-scenario.ts';
import { clearMail, COUPLE, maestro, MAYA, seed, useDevices, type Result } from './lib.ts';

const NOOR_EMAIL = 'noor@bonded.test';
/** Must match the ANSWER default in .maestro/onboarding/fresh-install.yaml (fixture text only). */
const T1_ANSWER = 'FIXTURE-T1 noor day one';
const CASES = ['fresh', 'returning-solo', 'returning-paired'] as const;
type Case = (typeof CASES)[number];

async function activeCouples(db: Queryable, where: string, param: string) {
  const r = await db.query(
    `select m.couple_id::text as id,
            (select count(*)::int from couple_members x where x.couple_id = m.couple_id and x.left_at is null) as members
       from couple_members m join auth.users u on u.id = m.user_id
      where ${where} = $1 and m.left_at is null`, [param]);
  return r.rows as { id: string; members: number }[];
}

async function runCase(db: Queryable, c: Case, device: string): Promise<Result> {
  if (c === 'fresh') {
    await seed(db, 'fresh-install');
    await clearMail();
    const before = Number((await db.query('select count(*)::int n from auth.users where email = $1', [NOOR_EMAIL])).rows[0].n);
    const ok = await maestro({ flow: 'onboarding/fresh-install.yaml', device });
    const couples = await activeCouples(db, 'u.email', NOOR_EMAIL);
    const dates = couples.length
      ? Number((await db.query('select count(*)::int n from key_dates where couple_id = $1', [couples[0].id])).rows[0].n)
      : 0;
    // QA-34 (D50): the stage from 05 and the goal from 06 reach the couple (the flow picks dating
    // and deep talks).
    const quiz = couples.length
      ? (await db.query('select stage::text as stage, goals from couples where id = $1', [couples[0].id])).rows[0] as
          { stage: string | null; goals: string[] }
      : null;
    const quizOk = quiz?.stage === 'dating' && quiz.goals.length === 1 && quiz.goals[0] === 'deep_talks';
    // QA-34 (MOB-61): T1 is written once, as noor's answer to a daily question of the new couple
    // (day 1), and N's "Not now" still writes the ritual time (21:00, the pre-picked tile). The
    // answer text is compared here, never printed.
    const t1 = couples.length
      ? (await db.query(
          `select count(*)::int as n, bool_and(a.body = $3) as same
             from answers a join couple_questions cq on cq.id = a.couple_question_id
             join auth.users u on u.id = a.user_id
            where cq.couple_id = $1 and u.email = $2 and cq.source = 'daily'`,
          [couples[0].id, NOOR_EMAIL, T1_ANSWER])).rows[0] as { n: number; same: boolean | null }
      : { n: 0, same: null };
    const ritual = ((await db.query(
      `select p.ritual_time::text as t from notification_prefs p join auth.users u on u.id = p.user_id where u.email = $1`,
      [NOOR_EMAIL])).rows[0] as { t: string } | undefined)?.t ?? null;
    const t1Ok = t1.n === 1 && t1.same === true && ritual?.startsWith('21:00') === true;
    const dbOk = before === 0 && couples.length === 1 && couples[0].members === 1 && dates === 0 && quizOk && t1Ok;
    return { name: 'fresh (01 -> 05 -> 07 -> 02 -> 03 -> 04 -> 06 -> 47 skip -> T1 -> N -> L -> P2 -> 08 -> 10 -> 11 -> 23)', ok: ok && dbOk,
      detail: `flow ${ok ? 'ok' : 'FAILED'}, noor existed before ${before}, noor couples ${JSON.stringify(couples)} (want one solo), key dates ${dates}, quiz ${JSON.stringify(quiz)} (want dating + [deep_talks]), T1 answers ${t1.n} same text ${t1.same} (want 1, true), ritual ${ritual} (want 21:00)` };
  }
  const solo = c === 'returning-solo';
  await seed(db, solo ? 'invite-wrong-code' : 'paired-day1-partner-answered');
  await clearMail();
  const ok = await maestro({ flow: 'auth/returning-sign-in.yaml', device,
    env: { EMAIL: 'maya@bonded.test', LANDING: solo ? '10' : 'today' } });
  const couples = await activeCouples(db, 'm.user_id', MAYA);
  const want = solo ? 1 : 2;
  const dbOk = couples.length === 1 && couples[0].id === COUPLE && couples[0].members === want;
  return { name: `${c} (D40: 01 -> 08 -> ${solo ? '10' : 'Today'})`, ok: ok && dbOk,
    detail: `flow ${ok ? 'ok' : 'FAILED'}, maya couples ${JSON.stringify(couples)} (want maya_sam with ${want})` };
}

function arg(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(argv: string[]) {
  const id = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--device');
  const device = arg(argv, '--device');
  if (!id || !['all', ...CASES].includes(id) || !device) {
    console.error('usage: npm --prefix qa/e2e run onboarding -- <fresh|returning-solo|returning-paired|all> --device <id>');
    process.exit(2);
  }
  useDevices(device);
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  const results: Result[] = [];
  try {
    for (const c of CASES) if (id === 'all' || id === c) results.push(await runCase(client, c, device));
  } finally {
    await client.end();
  }
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  (${r.detail})`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((e: Error) => {
    console.error(`e2e onboarding: ${e.message}`);
    process.exit(1);
  });
}
