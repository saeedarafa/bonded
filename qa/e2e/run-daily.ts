// QA-04b: runs the Maestro daily-loop flows (answer 19 / J7, hold to reveal 20, revealed + reactions 21)
// on simulators against the LOCAL Supabase stack.
//
//   npm --prefix qa/e2e run daily -- <suite> --a <device-A-id> --b <device-B-id>
//   suites: reveal | pack (two devices) | first | reduced (one device, --b) | all
//
// reveal  streak-11-fresh-day: A (Sam) answers; B (Maya) starts once Sam's answer is in the database and
//         must not see it anywhere until she answers (the reveal rule, release blocker); both reveal; Sam
//         reacts, Maya sees it. B runs with reduce motion on (tap + confirm), A with the hold.
// first   paired-day1-partner-answered: Sam's first question, J7, instant reveal.
// pack    free-couple-packs (QA-22, MOB-49): A (Sam) starts the free first question of the premium pack
//         "gratitude" on 33, answers on 19, waits on 30 with no answer text (D13); B (Maya) starts once
//         Sam's answer is in the database, starts the same question, answers blind, reveals; A reveals.
// reduced streak-11-both-answered: Maya reveals with reduce motion on; Sam's seeded "love" shows on 21.
// After each run the database is checked too (answers, reaction). JUnit: qa/e2e/out/daily-*.xml.
// Env: SUPABASE_DB_URL / DB_URL (local only), MAILPIT_URL, MAESTRO.
import pg from 'pg';

import { databaseUrl, type Queryable } from '../scripts/seed-scenario.ts';
import { clearMail, containsText, COUPLE, maestro, MAYA, SAM, setReduceMotion, waitFor, type Result, seed, useDevices } from './lib.ts';

// Typed on the devices. FIXTURE- prefix so privacy greps can find leaks; letters only, so the text is
// both what we type and a plain Maestro regex.
const ANSWER_SAM = 'FIXTURE-E2E Sam answers first';
const ANSWER_MAYA = 'FIXTURE-E2E Maya answers second';
const ANSWER_SAM_J7 = 'FIXTURE-E2E Sam first day';
const ANSWER_SAM_PACK = 'FIXTURE-E2E Sam pack first';
const ANSWER_MAYA_PACK = 'FIXTURE-E2E Maya pack second';
/** The premium pack whose first question a free couple may start (D43); the flows open it on 32. */
const PACK_SLUG = 'gratitude';
// Seeded (supabase/seed.sql, from the design boards): distinctive fragments, matched as "contains".
const SEED_SAM_TODAY = containsText('hum while cooking');
const SEED_MAYA_TODAY = containsText('leave the coffee ready');
const SEED_MAYA_DAY1 = containsText('Your laugh. Loud, sudden');

/** Today's daily question for maya_sam. */
async function todayCq(db: Queryable): Promise<string> {
  const r = await db.query(
    `select id from couple_questions where couple_id = $1 and source = 'daily' order by assigned_for desc limit 1`, [COUPLE]);
  if (!r.rows[0]) throw new Error('maya_sam has no daily question (scenario not seeded?)');
  return String(r.rows[0].id);
}

/**
 * streak-11-fresh-day: streak-11-your-turn (day 12, streak 11), then today's answers removed so neither
 * partner has answered. QA-side until backend adds the scenario to dev_seed (see docs/plan/status/qa.md).
 */
async function freshDay(db: Queryable) {
  await seed(db, 'streak-11-your-turn');
  const cq = await todayCq(db);
  await db.query('delete from answers where couple_question_id = $1', [cq]);
  await db.query('update couple_questions set answer_count = 0 where id = $1', [cq]);
}

/** The pack question maya_sam started from PACK_SLUG (null until 33 "Start" ran). */
async function packCq(db: Queryable): Promise<string | null> {
  const r = await db.query(
    `select cq.id from couple_questions cq
       join pack_questions i on i.question_id = cq.question_id
       join question_packs p on p.id = i.pack_id
      where cq.couple_id = $1 and cq.source = 'pack' and p.slug = $2
      order by cq.created_at desc limit 1`, [COUPLE, PACK_SLUG]);
  return r.rows[0] ? String(r.rows[0].id) : null;
}

async function answered(db: Queryable, cq: string, user: string): Promise<boolean> {
  const r = await db.query('select 1 from answers where couple_question_id = $1 and user_id = $2', [cq, user]);
  return r.rows.length > 0;
}

async function reactionKind(db: Queryable, cq: string, by: string, on: string): Promise<string | null> {
  const r = await db.query(
    `select r.kind::text as kind from reactions r join answers a on a.id = r.answer_id
      where a.couple_question_id = $1 and a.user_id = $2 and r.user_id = $3`, [cq, on, by]);
  return r.rows[0] ? String(r.rows[0].kind) : null;
}

async function suite(db: Queryable, id: string, A: string, B: string): Promise<Result[]> {
  const results: Result[] = [];
  if (id === 'reveal' || id === 'all') {
    await freshDay(db);
    await clearMail();
    const cq = await todayCq(db);
    setReduceMotion(A, false);
    setReduceMotion(B, true);
    const env = { ANSWER_A: ANSWER_SAM, ANSWER_B: ANSWER_MAYA };
    const runA = maestro({ flow: 'daily/reveal-rule-first.yaml', device: A, env });
    let okB = false;
    try {
      // B signs in only once A's answer exists: that is the state the reveal rule protects.
      await waitFor("Sam's answer from device A", 240_000, async () => ((await answered(db, cq, SAM)) ? true : null));
      okB = await maestro({ flow: 'daily/reveal-rule-second.yaml', device: B, env: { ...env, REDUCED_MOTION: 'true' } });
    } catch (e) {
      console.error(`reveal: ${(e as Error).message}`);
    }
    const okA = await runA;
    setReduceMotion(B, false);
    const both = (await answered(db, cq, SAM)) && (await answered(db, cq, MAYA));
    const kind = await reactionKind(db, cq, SAM, MAYA);
    results.push({
      name: 'reveal (A answers, B blind until B answers, both reveal, A reacts, B sees it)',
      ok: okA && okB && both && kind === 'love',
      detail: `device A ${okA ? 'ok' : 'FAILED'}, device B ${okB ? 'ok' : 'FAILED'}, both answered ${both}, Sam's reaction on Maya ${kind}`,
    });
  }
  if (id === 'pack' || id === 'all') {
    await seed(db, 'free-couple-packs');
    await clearMail();
    setReduceMotion(A, false);
    setReduceMotion(B, true);
    const env = { ANSWER_A: ANSWER_SAM_PACK, ANSWER_B: ANSWER_MAYA_PACK };
    const runA = maestro({ flow: 'daily/pack-answer-first.yaml', device: A, env });
    let okB = false;
    let cq: string | null = null;
    try {
      // B starts only once A's answer to the pack question exists (the state the reveal rule protects).
      cq = await waitFor("Sam's pack answer from device A", 240_000, async () => {
        const id = await packCq(db);
        return id && (await answered(db, id, SAM)) ? id : null;
      });
      okB = await maestro({ flow: 'daily/pack-answer-second.yaml', device: B, env: { ...env, REDUCED_MOTION: 'true' } });
    } catch (e) {
      console.error(`pack: ${(e as Error).message}`);
    }
    const okA = await runA;
    setReduceMotion(B, false);
    const both = !!cq && (await answered(db, cq, SAM)) && (await answered(db, cq, MAYA));
    // start_pack_question returns the existing row to the partner: one row, not two.
    const rows = await db.query(`select count(*)::int as n from couple_questions where couple_id = $1 and source = 'pack'`, [COUPLE]);
    const one = rows.rows[0]?.n === 1;
    results.push({
      name: 'pack (33 opens 19; A waits on 30 with no text; B blind until B answers; both reveal)',
      ok: okA && okB && both && one,
      detail: `device A ${okA ? 'ok' : 'FAILED'}, device B ${okB ? 'ok' : 'FAILED'}, both answered ${both}, one pack row ${one}`,
    });
  }
  if (id === 'first' || id === 'all') {
    await seed(db, 'paired-day1-partner-answered');
    await clearMail();
    const cq = await todayCq(db);
    setReduceMotion(B, false);
    const ok = await maestro({ flow: 'daily/joiner-first-answer.yaml', device: B,
      env: { ANSWER: ANSWER_SAM_J7, PARTNER_ANSWER: SEED_MAYA_DAY1 } });
    const mine = await answered(db, cq, SAM);
    results.push({ name: 'first (J7 instant reveal)', ok: ok && mine, detail: `Sam answered ${mine}` });
  }
  if (id === 'reduced' || id === 'all') {
    await seed(db, 'streak-11-both-answered');
    await clearMail();
    setReduceMotion(B, true);
    const ok = await maestro({ flow: 'daily/reveal-reduced-motion.yaml', device: B,
      env: { REDUCED_MOTION: 'true', PARTNER_ANSWER: SEED_SAM_TODAY, MY_ANSWER: SEED_MAYA_TODAY } });
    setReduceMotion(B, false);
    results.push({ name: 'reduced (reduce motion: tap + confirm; seeded reaction on 21)', ok });
  }
  return results;
}

function arg(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(argv: string[]) {
  const id = argv.find((a, i) => !a.startsWith('--') && !['--a', '--b'].includes(argv[i - 1] ?? ''));
  const A = arg(argv, '--a');
  const B = arg(argv, '--b');
  useDevices(A, B);
  const oneDevice = id === 'first' || id === 'reduced';
  if (!id || !['reveal', 'pack', 'first', 'reduced', 'all'].includes(id) || !B || (!oneDevice && !A)) {
    console.error('usage: npm --prefix qa/e2e run daily -- <reveal|pack|first|reduced|all> --a <device-A> --b <device-B>');
    process.exit(2);
  }
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    const results = await suite(client, id, A ?? '', B);
    for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  (${r.detail ?? ''})`);
    process.exit(results.every((r) => r.ok) ? 0 : 1);
  } finally {
    await client.end();
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((e: Error) => {
    console.error(`e2e daily: ${e.message}`);
    process.exit(1);
  });
}
