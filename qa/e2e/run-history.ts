// QA-39: runs the Maestro History flows for D55 (History is Premium beyond yesterday; MOB-71, BE-55) on one
// simulator or emulator against the LOCAL Supabase stack.
//
//   npm --prefix qa/e2e run history -- <suite> --b <device-id> [--shipped]
//   suites: locked | premium | ended | paywall-row | all (locked, premium, ended)
//
// locked       history-month (free): 29 lists the newest older day (day -2) locked ("Premium"), a tap opens 16 for
//              History; yesterday opens 30; 30 and 22 by link for that day are locked, no text.
// premium      history-month + an active entitlement for Maya: that day opens with Sam's answer; then the
//              runner lapses the entitlement (expires_at in the past) and runs `locked` again (relock),
//              and checks that nothing of the couple was deleted (answers, messages, reactions).
// ended        partner-left (Maya free, Sam unpaired 2 days ago): 58 -> the archive; the MOB-70 note; an
//              older archived day is locked and opens 16; by link it shows no text.
// paywall-row  history-month: 16 from=history -> × -> 17 lists "History: Last 2 days / Everything" only with
//              --shipped (a build with EXPO_PUBLIC_SHIP_PREMIUM_HISTORY=1); without it the row must be
//              absent. Needs a RevenueCat sandbox key in the build. Not in `all` (build flag).
// After each run the database is checked too. JUnit: qa/e2e/out/history-*.xml.
// Env: SUPABASE_DB_URL / DB_URL (local only), MAILPIT_URL, MAESTRO.
import pg from 'pg';

import { databaseUrl, type Queryable } from '../scripts/seed-scenario.ts';
import { dropDay3Gift } from '../scripts/offer-seeds.ts';
import { clearMail, containsText, COUPLE, maestro, MAYA, SAM, seed, setReduceMotion, useDevices, type Result } from './lib.ts';

const SUITES = ['locked', 'premium', 'ended', 'paywall-row', 'all'];

/** maya_sam's daily question `back` couple-local days ago with `answers` answers (null when none). */
async function dayBack(db: Queryable, back: number, answers = 2): Promise<string | null> {
  const r = await db.query(
    `select q.id from couple_questions q join couples c on c.id = q.couple_id
      where q.couple_id = $1 and q.source = 'daily' and q.answer_count = $3
        and q.assigned_for = (now() at time zone c.timezone)::date - $2::int
      limit 1`,
    [COUPLE, back, answers],
  );
  return r.rows[0] ? String(r.rows[0].id) : null;
}

/** The newest daily question older than couple-local yesterday that both answered (locked when free). */
async function olderBothAnswered(db: Queryable): Promise<string> {
  const r = await db.query(
    `select q.id from couple_questions q join couples c on c.id = q.couple_id
      where q.couple_id = $1 and q.source = 'daily' and q.answer_count = 2
        and q.assigned_for < (now() at time zone c.timezone)::date - 1
      order by q.assigned_for desc limit 1`,
    [COUPLE],
  );
  if (!r.rows[0]) throw new Error('maya_sam has no older day both answered (scenario not seeded?)');
  return String(r.rows[0].id);
}

/** A regex (Maestro `text:`) of the first 24 characters of a seeded answer or message. */
async function textOf(db: Queryable, sql: string, params: unknown[]): Promise<string> {
  const r = await db.query(sql, params);
  const body = String(r.rows[0]?.body ?? '');
  if (!body) throw new Error('no seeded text to check against');
  return containsText(body.slice(0, 24));
}
const samAnswer = (db: Queryable, cq: string) =>
  textOf(db, 'select body from answers where couple_question_id = $1 and user_id = $2', [cq, SAM]);
/** A reply on that day; falls back to Sam's answer when the day has no thread. */
async function aMessage(db: Queryable, cq: string): Promise<string> {
  const r = await db.query('select 1 from thread_messages where couple_question_id = $1 and body is not null limit 1', [cq]);
  if (!r.rows.length) return samAnswer(db, cq);
  return textOf(db, 'select body from thread_messages where couple_question_id = $1 and body is not null order by created_at limit 1', [cq]);
}

/** Answers, messages and reactions of maya_sam (D55: a lapse deletes nothing). */
async function contentCount(db: Queryable): Promise<string> {
  const r = await db.query(
    `select (select count(*) from answers a join couple_questions q on q.id = a.couple_question_id where q.couple_id = $1)::int a,
            (select count(*) from thread_messages m join couple_questions q on q.id = m.couple_question_id where q.couple_id = $1)::int m,
            (select count(*) from reactions r left join answers a on a.id = r.answer_id left join thread_messages t on t.id = r.message_id
               join couple_questions q on q.id = coalesce(a.couple_question_id, t.couple_question_id) where q.couple_id = $1)::int r`,
    [COUPLE],
  );
  const row = r.rows[0] ?? {};
  return `answers ${row.a}, messages ${row.m}, reactions ${row.r}`;
}

const entitle = (db: Queryable, expiresAt: string) =>
  db.query(
    `insert into entitlements (user_id, is_active, expires_at) values ($1, true, $2::timestamptz)
       on conflict (user_id) do update set is_active = true, expires_at = excluded.expires_at`,
    [MAYA, expiresAt],
  );

async function historyMonth(db: Queryable) {
  await seed(db, 'history-month');
  await db.query('delete from entitlements where user_id in ($1, $2)', [MAYA, SAM]);
  // QA-35: the seeded streak can hold a live day-3 gift; Today would open 14 over the tabs.
  await dropDay3Gift(db);
  await clearMail();
}

async function lockedEnv(db: Queryable) {
  const locked = await olderBothAnswered(db);
  const open = (await dayBack(db, 1, 2)) ?? (await dayBack(db, 1, 1));
  if (!open) throw new Error('history-month has no answered day -1 (seed changed?)');
  return { LOCKED_CQ: locked, OPEN_CQ: open, PARTNER_LOCKED: await samAnswer(db, locked), MESSAGE_LOCKED: await aMessage(db, locked) };
}

export async function suite(db: Queryable, id: string, B: string, shipped: boolean): Promise<Result[]> {
  const results: Result[] = [];
  setReduceMotion(B, false);
  if (id === 'locked' || id === 'all') {
    await historyMonth(db);
    const env = await lockedEnv(db);
    const before = await contentCount(db);
    const ok = await maestro({ flow: 'history/locked-free.yaml', device: B, env });
    const after = await contentCount(db);
    results.push({ name: 'locked (29 lock + Premium -> 16 from=history; 30 and 22 locked by link; yesterday open)', ok: ok && before === after, detail: `${after}` });
  }
  if (id === 'premium' || id === 'all') {
    await historyMonth(db);
    const env = await lockedEnv(db);
    await entitle(db, new Date(Date.now() + 30 * 86_400_000).toISOString());
    const before = await contentCount(db);
    const okOpen = await maestro({ flow: 'history/premium-open.yaml', device: B,
      env: { LOCKED_CQ: env.LOCKED_CQ, PARTNER_OPEN: env.PARTNER_LOCKED } });
    // Lapse: the entitlement expired a minute ago. The same day locks again; nothing is deleted.
    await entitle(db, new Date(Date.now() - 60_000).toISOString());
    await clearMail();
    const okRelock = await maestro({ flow: 'history/locked-free.yaml', device: B, env });
    const after = await contentCount(db);
    results.push({ name: 'premium (older day opens) + lapse relocks, nothing deleted', ok: okOpen && okRelock && before === after,
      detail: `open ${okOpen ? 'ok' : 'FAILED'}, relock ${okRelock ? 'ok' : 'FAILED'}, before ${before} / after ${after}` });
  }
  if (id === 'ended' || id === 'all') {
    await seed(db, 'partner-left');
    await db.query('delete from entitlements where user_id in ($1, $2)', [MAYA, SAM]);
    await clearMail();
    const r = await db.query(
      `select q.id from couple_questions q join couples c on c.id = q.couple_id
        where q.couple_id = $1 and c.status = 'ended' and q.source = 'daily'
          and exists (select 1 from answers a where a.couple_question_id = q.id and a.user_id = $2)
          and exists (select 1 from answers a where a.couple_question_id = q.id and a.user_id = $3)
          and q.assigned_for < (now() at time zone c.timezone)::date - 1
        order by q.assigned_for desc limit 1`,
      [COUPLE, MAYA, SAM],
    );
    if (!r.rows[0]) throw new Error('partner-left has no ended older day both answered (seed changed?)');
    const locked = String(r.rows[0].id);
    const ok = await maestro({ flow: 'history/ended-locked.yaml', device: B,
      env: { LOCKED_CQ: locked, PARTNER_LOCKED: await samAnswer(db, locked) } });
    results.push({ name: 'ended (archive locked for a free reader; MOB-70 note; 16 from=history)', ok });
  }
  if (id === 'paywall-row') {
    await historyMonth(db);
    const ok = await maestro({ flow: 'history/paywall-17-history-row.yaml', device: B, env: { SHIPPED: shipped ? '1' : '0' } });
    results.push({ name: `paywall-row (17 History row ${shipped ? 'shown' : 'absent'}, build ${shipped ? 'ships' : 'does not ship'} D55)`, ok });
  }
  return results;
}

function arg(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(argv: string[]) {
  const id = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--b');
  const B = arg(argv, '--b');
  if (!id || !SUITES.includes(id) || !B) {
    console.error(`usage: npm --prefix qa/e2e run history -- <${SUITES.join('|')}> --b <device> [--shipped]`);
    process.exit(2);
  }
  useDevices(B);
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    const results = await suite(client, id, B, argv.includes('--shipped'));
    for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  (${r.detail ?? ''})`);
    process.exit(results.every((r) => r.ok) ? 0 : 1);
  } finally {
    await client.end();
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((e: Error) => {
    console.error(`e2e history: ${e.message}`);
    process.exit(1);
  });
}
