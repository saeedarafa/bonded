// QA-04a: runs the Maestro pairing flows on two simulators against the LOCAL Supabase stack.
//
//   npm --prefix qa/e2e run pairing -- <suite> --a <device-A-id> --b <device-B-id>
//   suites: link | typed | signed-in | errors | all        (errors only needs --b)
//
// Per pair: seed the scenario (dev_seed via qa/scripts/seed-scenario.ts), clear the invite limiter and
// the mail catcher, start both flows, coordinate through database state (poll with a timeout, never a
// sleep), then check the couple in the database. JUnit reports go to qa/e2e/out/.
// Env: SUPABASE_DB_URL / DB_URL (local only), MAILPIT_URL (default http://127.0.0.1:54324),
// MAESTRO (default `maestro`), D02_APPROVAL=true once BE-26 / MOB-32 land.
import pg from 'pg';

import { databaseUrl, type Queryable } from '../scripts/seed-scenario.ts';
import { clearMail, COUPLE, D02, maestro as runFlow, MAYA, waitFor, type Result, type Run, seed, useDevices } from './lib.ts';

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
    results.push(await pair(db, 'link (token link joins at once)', { flow: 'inviter-waits.yaml', device: A },
      { flow: 'joiner-link-token.yaml', device: B }));
  }
  if (id === 'typed' || id === 'all') {
    await prepare(db, 'solo-invite-pending');
    const startedAt = (await db.query('select now() as t')).rows[0].t;
    results.push(await pair(db, 'typed (inviter code -> typed on J3) [D02]',
      { flow: 'inviter-creates-code.yaml', device: A },
      async () => {
        // Device A makes a code, then a new one (10-new). Start B once the second one exists.
        const code = await waitFor('the second invite Maya makes on 10', 180_000, async () => {
          const r = await db.query(
            `select code, (select count(*) from pair_invites where inviter_id = $1 and created_at >= $2)::int as made
               from pair_invites where inviter_id = $1 and created_at >= $2
                and accepted_at is null and revoked_at is null and expires_at > now()
              order by created_at desc limit 1`, [MAYA, startedAt]);
          return r.rows[0] && Number(r.rows[0].made) >= 2 ? String(r.rows[0].code) : null;
        });
        return { flow: 'joiner-typed-code.yaml', device: B, env: { CODE: code } };
      }));
  }
  if (id === 'signed-in' || id === 'all') {
    await prepare(db, 'solo-invite-pending');
    results.push(await pair(db, 'signed-in (12, D04 solo joiner) [D02]',
      { flow: 'inviter-waits.yaml', device: A, env: { EXPECT_APPROVAL: String(D02) } },
      { flow: 'joiner-signed-in-code.yaml', device: B, env: { CODE: '4827' } }));
  }
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

function arg(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(argv: string[]) {
  const id = argv.find((a, i) => !a.startsWith('--') && !['--a', '--b'].includes(argv[i - 1] ?? ''));
  const A = arg(argv, '--a');
  const B = arg(argv, '--b');
  useDevices(A, B);
  if (!id || !['link', 'typed', 'signed-in', 'errors', 'all'].includes(id) || !B || (id !== 'errors' && !A)) {
    console.error('usage: npm --prefix qa/e2e run pairing -- <link|typed|signed-in|errors|all> --a <device-A> --b <device-B>');
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
