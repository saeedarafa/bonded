// QA-04a: runs the Maestro pairing flows on two simulators against the LOCAL Supabase stack.
//
//   npm --prefix qa/e2e run pairing -- <suite> --a <device-A-id> --b <device-B-id>
//   suites: link | link-warm | typed | signed-in | keeps-code | from-today | errors | all   (errors only needs --b)
//   link / link-warm = MOB-40: a token link opens J2 first, from a cold start / with the app already on 01.
//   keeps-code = D36 (MOB-33): the shared code survives answering first and an app restart.
//   from-today = D37 (MOB-33b): a solo account joins a partner by typed code from Today.
//
// Per pair: seed the scenario (dev_seed via qa/scripts/seed-scenario.ts), clear the invite limiter and
// the mail catcher, start both flows, coordinate through database state (poll with a timeout, never a
// sleep), then check the couple in the database. JUnit reports go to qa/e2e/out/.
// Env: SUPABASE_DB_URL / DB_URL (local only), MAILPIT_URL (default http://127.0.0.1:54324),
// MAESTRO (default `maestro`). D02 (BE-26 / MOB-32) is live: every typed code waits for the inviter's yes.
import pg from 'pg';

import { databaseUrl, type Queryable } from '../scripts/seed-scenario.ts';
import { clearMail, COUPLE, maestro as runFlow, MAYA, waitFor, type Result, type Run, seed, useDevices } from './lib.ts';

const LEA = '00000000-0000-4000-a000-00000000a003';
const LEA_SOLO = '00000000-0000-4000-b000-0000000000c3';

/** Pairing flows live in .maestro/pairing/. */
const maestro = (r: Run) => runFlow({ ...r, flow: `pairing/${r.flow}` });

async function prepare(db: Queryable, scenario: string) {
  await seed(db, scenario);
  // The limiter keys anon callers on the hashed IP, and every simulator shares the Mac's IP.
  await db.query('delete from private.invite_attempts');
  await db.query(`do $$ begin
    if to_regclass('private.invite_failure_counts') is not null then delete from private.invite_failure_counts; end if;
  end $$`);
  await clearMail();
}

async function members(db: Queryable): Promise<number> {
  const r = await db.query('select count(*)::int as n from couple_members where couple_id = $1 and left_at is null', [COUPLE]);
  return Number(r.rows[0].n);
}

async function pair(db: Queryable, name: string, a: Run, b: Run | (() => Promise<Run>), expectMembers = 2): Promise<Result> {
  const runA = maestro(a);
  let okB = false;
  try {
    const runB = typeof b === 'function' ? await b() : b;
    okB = await maestro(runB);
  } catch (e) {
    console.error(`${name}: ${(e as Error).message}`);
  }
  const okA = await runA;
  const n = await members(db);
  const ok = okA && okB && n === expectMembers;
  return { name, ok, detail: `device A ${okA ? 'ok' : 'FAILED'}, device B ${okB ? 'ok' : 'FAILED'}, maya_sam members ${n}/${expectMembers}` };
}

async function suite(db: Queryable, id: string, A: string, B: string): Promise<Result[]> {
  const results: Result[] = [];
  if (id === 'link' || id === 'all') {
    await prepare(db, 'solo-invite-pending');
    results.push(await pair(db, 'link cold (token link -> J2 -> J4 -> J5, joins at once)', { flow: 'inviter-waits.yaml', device: A },
      { flow: 'joiner-link-token.yaml', device: B, env: { START: 'cold' } }));
  }
  if (id === 'link-warm' || id === 'all') {
    await prepare(db, 'solo-invite-pending');
    results.push(await pair(db, 'link warm (app on 01, token link -> J2 -> J4 -> J5)', { flow: 'inviter-waits.yaml', device: A },
      { flow: 'joiner-link-token.yaml', device: B, env: { START: 'warm' } }));
  }
  if (id === 'typed' || id === 'all') {
    await prepare(db, 'solo-invite-pending');
    const startedAt = (await db.query('select now() as t')).rows[0].t;
    results.push(await pair(db, 'typed (inviter code -> typed on J3) [D02]',
      { flow: 'inviter-creates-code.yaml', device: A },
      async () => {
        // D36 (MOB-33): 10 shows the seeded open code 4827 (no new one on a visit); 10-new (confirmed)
        // replaces it with one new code. Start B once that one exists.
        const code = await waitFor('the new invite Maya makes with 10-new', 180_000, async () => {
          const r = await db.query(
            `select code, (select count(*) from pair_invites where inviter_id = $1 and created_at >= $2)::int as made
               from pair_invites where inviter_id = $1 and created_at >= $2
                and accepted_at is null and revoked_at is null and expires_at > now()
              order by created_at desc limit 1`, [MAYA, startedAt]);
          return r.rows[0] && Number(r.rows[0].made) >= 1 ? String(r.rows[0].code) : null;
        });
        return { flow: 'joiner-typed-code.yaml', device: B, env: { CODE: code } };
      }));
  }
  if (id === 'signed-in' || id === 'all') {
    await prepare(db, 'solo-invite-pending');
    results.push(await pair(db, 'signed-in (12, D04 solo joiner) [D02]',
      { flow: 'inviter-waits.yaml', device: A, env: { EXPECT_APPROVAL: 'true' } },
      { flow: 'joiner-signed-in-code.yaml', device: B, env: { CODE: '4827' } }));
  }
  if (id === 'keeps-code' || id === 'all') results.push(await keepsCode(db, A, B));
  if (id === 'from-today' || id === 'all') results.push(await fromToday(db, A, B));
  if (id === 'errors' || id === 'all') {
    for (const [scenario, flow, couple] of [
      ['invite-wrong-code', 'joiner-wrong-code.yaml', 1],
      ['invite-expired', 'joiner-expired.yaml', 1],
      ['couple-full', 'joiner-couple-full.yaml', 2],
    ] as const) {
      await prepare(db, scenario);
      const ok = await maestro({ flow, device: B });
      const n = await members(db);
      results.push({ name: `${flow} (${scenario})`, ok: ok && n === couple, detail: `maya_sam members ${n}/${couple}` });
    }
  }
  return results;
}

/** Maya's invites made since `since`: [{code, revoked, accepted}]. */
async function invitesSince(db: Queryable, since: unknown) {
  const r = await db.query(
    `select code, revoked_at is not null as revoked, accepted_at is not null as accepted
       from pair_invites where inviter_id = $1 and created_at >= $2 order by created_at`, [MAYA, since]);
  return r.rows as { code: string; revoked: boolean; accepted: boolean }[];
}

/**
 * D36 (MOB-33, QA-12): Maya makes a code from Today, answers first, restarts: the same code on Today and 10.
 * Then Sam types that code (J3) and Maya approves it on 10 after one more restart. Fails if any visit to 10
 * made a new code: exactly one invite since the start, never revoked, and it is the one Sam used.
 */
async function keepsCode(db: Queryable, A: string, B: string): Promise<Result> {
  const name = 'keeps-code (D36: same code after answer + restart, partner joins with it) [D02]';
  await prepare(db, 'invite-wrong-code'); // Maya: solo couple, no invite, no answer
  const since = (await db.query('select now() as t')).rows[0].t;
  const okA1 = await maestro({ flow: 'inviter-keeps-code.yaml', device: A });
  const before = await invitesSince(db, since);
  const answered = Number((await db.query(
    `select count(*)::int n from answers a join couple_questions q on q.id = a.couple_question_id
      where q.couple_id = $1 and a.user_id = $2`, [COUPLE, MAYA])).rows[0].n);
  const kept = before.length === 1 && !before[0].revoked;
  if (!okA1 || !kept) {
    return { name, ok: false, detail: `part 1 ${okA1 ? 'ok' : 'FAILED'}, invites since start ${JSON.stringify(before)}, maya answers ${answered}` };
  }
  const code = before[0].code;
  const res = await pair(db, name, { flow: 'inviter-approves-kept-code.yaml', device: A, env: { CODE: code } },
    { flow: 'joiner-typed-code.yaml', device: B, env: { CODE: code } });
  const after = await invitesSince(db, since);
  const sameInvite = after.length === 1 && after[0].code === code && after[0].accepted && !after[0].revoked;
  return { ...res, ok: res.ok && sameInvite && answered >= 1,
    detail: `${res.detail}, invites since start ${JSON.stringify(after)} (want one, ${code}, accepted), maya answers ${answered}` };
}

/**
 * D37 (MOB-33b, QA-12): Lea (signed up without a code, own space lea_solo) joins Maya by typed code from
 * her Today: pending, Maya approves on 11, Lea is in maya_sam and lea_solo is archived (ended, BE-25).
 */
async function fromToday(db: Queryable, A: string, B: string): Promise<Result> {
  await prepare(db, 'solo-invite-pending');
  const res = await pair(db, 'from-today (D37: solo account joins by code from Today) [D02]',
    { flow: 'inviter-waits.yaml', device: A, env: { EXPECT_APPROVAL: 'true' } },
    { flow: 'joiner-from-today.yaml', device: B });
  const lea = (await db.query(
    `select (select count(*)::int from couple_members where couple_id = $1 and user_id = $2 and left_at is null) as in_maya,
            (select status::text from couples where id = $3) as solo_status,
            (select ended_at is not null from couples where id = $3) as solo_ended`, [COUPLE, LEA, LEA_SOLO])).rows[0];
  const archived = lea.solo_status === 'ended' && lea.solo_ended === true;
  return { ...res, ok: res.ok && lea.in_maya === 1 && archived,
    detail: `${res.detail}, lea in maya_sam ${lea.in_maya}, lea_solo ${lea.solo_status}${lea.solo_ended ? ' (ended_at set)' : ''}` };
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
  if (!id || !['link', 'link-warm', 'typed', 'signed-in', 'keeps-code', 'from-today', 'errors', 'all'].includes(id) || !B || (id !== 'errors' && !A)) {
    console.error('usage: npm --prefix qa/e2e run pairing -- <link|link-warm|typed|signed-in|keeps-code|from-today|errors|all> --a <device-A> --b <device-B>');
    process.exit(2);
  }
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    const results = await suite(client, id, A ?? '', B);
    for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  (${r.detail})`);
    process.exit(results.every((r) => r.ok) ? 0 : 1);
  } finally {
    await client.end();
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((e: Error) => {
    console.error(`e2e pairing: ${e.message}`);
    process.exit(1);
  });
}
