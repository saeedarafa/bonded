// QA-02: put the six personas into one named state (qa/fixtures/personas.json "scenarios") on the
// LOCAL Supabase stack, through the dev seed engine `dev_seed.apply_scenario(id, now)` that
// `supabase db reset` loads from supabase/seed.sql (BE-05).
//
//   npm run qa:scenario <scenario-id>                      relative to now
//   npm run qa:scenario <scenario-id> -- --now 2026-12-01T09:00:00Z   pinned clock
//   npm run qa:scenario -- --list
//
// One-time setup: `npm --prefix qa/scripts ci` (installs pg). Needs the stack running and reset:
// `supabase start && supabase db reset`. The database URL comes from SUPABASE_DB_URL / DB_URL, else
// `supabase status -o env`, else the CLI default. Refuses any host but localhost.
//
// Plain TypeScript that Node 24 runs as is (type stripping): no enums, no parameter properties.
// The functions are exported so qa/contract/scenarios.test.ts drives the same code.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type Queryable = {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
};

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1', '[::1]'];
export const DEFAULT_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/** Scenario ids declared in qa/fixtures/personas.json (the shared vocabulary). */
export function fixtureScenarioIds(): string[] {
  const file = path.join(repoRoot, 'qa', 'fixtures', 'personas.json');
  const json = JSON.parse(fs.readFileSync(file, 'utf8')) as { scenarios: { id: string }[] };
  return json.scenarios.map((s) => s.id);
}

/** Scenario ids the database can build (dev_seed.scenarios()). */
export async function seededScenarioIds(db: Queryable): Promise<string[]> {
  const res = await db.query('select id from dev_seed.scenarios() order by id');
  return res.rows.map((r) => String(r.id));
}

export type Summary = {
  scenario: string;
  now: string;
  couples: {
    key: string;
    members: string[];
    status: string;
    streak: { current: number; longest: number } | null;
    answers: number;
    threadMessages: number;
    activeInvite: string | null;
  }[];
  personasWithoutAccount: string[];
};

/**
 * Applies a scenario (wipes the persona couples, invites, entitlements first) and reads back
 * what exists. Throws on an unknown id, naming the ones that exist.
 */
export async function applyScenario(db: Queryable, id: string, now?: string): Promise<Summary> {
  const known = await seededScenarioIds(db);
  if (!known.includes(id)) {
    throw new Error(`Unknown scenario '${id}'. Known: ${known.join(', ')}`);
  }
  // dev_seed.reset() only removes the couples it knows (dev_seed.couple). A persona who joined any
  // other couple (through the app, or a contract test) would hit couple_members_one_couple_per_user,
  // so drop every couple a persona belongs to first.
  await db.query(`delete from couples where id in (
    select m.couple_id from couple_members m join dev_seed.persona p on p.id = m.user_id)`);
  await db.query('select dev_seed.apply_scenario($1, coalesce($2::timestamptz, now()))', [
    id,
    now ?? null,
  ]);
  return summarize(db, id, now);
}

export async function summarize(db: Queryable, id: string, now?: string): Promise<Summary> {
  const at = (
    await db.query(
      `select to_char(coalesce($1::timestamptz, now()) at time zone 'utc',
              'YYYY-MM-DD"T"HH24:MI:SS"Z"') as t`,
      [now ?? null],
    )
  ).rows[0].t as string;

  const couples = await db.query(`
    select c.key,
           coalesce((select array_agg(p.key order by p.key)
                       from couple_members m join dev_seed.persona p on p.id = m.user_id
                      where m.couple_id = c.id), '{}') as members,
           co.status::text as status,
           s.current, s.longest,
           (select count(*)::int from answers a join couple_questions q on q.id = a.couple_question_id
             where q.couple_id = c.id) as answers,
           (select count(*)::int from thread_messages t join couple_questions q on q.id = t.couple_question_id
             where q.couple_id = c.id) as messages,
           (select i.code from pair_invites i
             where i.couple_id = c.id and i.accepted_at is null and i.revoked_at is null
             order by i.created_at desc limit 1) as invite
      from dev_seed.couple c
      join couples co on co.id = c.id
      left join couple_streaks s on s.couple_id = c.id
     order by c.key`);

  const missing = await db.query(`
    select p.key from dev_seed.persona p
     where not exists (select 1 from auth.users u where u.id = p.id) order by p.key`);

  return {
    scenario: id,
    now: at,
    couples: couples.rows.map((r) => ({
      key: String(r.key),
      members: r.members as string[],
      status: String(r.status),
      streak: r.current == null ? null : { current: Number(r.current), longest: Number(r.longest) },
      answers: Number(r.answers),
      threadMessages: Number(r.messages),
      activeInvite: r.invite == null ? null : String(r.invite),
    })),
    personasWithoutAccount: missing.rows.map((r) => String(r.key)),
  };
}

export function formatSummary(s: Summary): string {
  const lines = [`scenario ${s.scenario} applied at ${s.now}`];
  for (const c of s.couples) {
    const streak = c.streak ? `, streak ${c.streak.current}/${c.streak.longest}` : '';
    const invite = c.activeInvite ? `, open invite BND·${c.activeInvite}` : '';
    lines.push(
      `  ${c.key}: ${c.members.join('+') || '(no members)'} [${c.status}]${streak}, ` +
        `${c.answers} answers, ${c.threadMessages} messages${invite}`,
    );
  }
  if (s.personasWithoutAccount.length) {
    lines.push(`  no account: ${s.personasWithoutAccount.join(', ')}`);
  }
  lines.push('  sign in with an email OTP (local mail catcher): http://127.0.0.1:54324');
  return lines.join('\n');
}

// ───────────────────────────── CLI ─────────────────────────────

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

export function databaseUrl(): string {
  let url = process.env.SUPABASE_DB_URL ?? process.env.DB_URL;
  if (!url) {
    try {
      const env = parseEnv(
        execFileSync('supabase', ['status', '-o', 'env'], {
          cwd: repoRoot,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }),
      );
      url = env.DB_URL;
    } catch {
      // supabase CLI missing or stack not running: fall back to the CLI default port
    }
  }
  url = url ?? DEFAULT_DB_URL;
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.includes(host)) {
    throw new Error(
      `Refusing to seed a non-local database (${host}). Scenarios are local/dev only.`,
    );
  }
  return url;
}

type PgClient = Queryable & { connect(): Promise<void>; end(): Promise<void> };

async function main(argv: string[]) {
  const args = argv.slice(2);
  const nowAt = args.indexOf('--now');
  const now = nowAt >= 0 ? args[nowAt + 1] : undefined;
  if (nowAt >= 0 && (!now || Number.isNaN(Date.parse(now)))) {
    throw new Error('--now needs an ISO timestamp, for example 2026-12-01T09:00:00Z');
  }
  const id = args.find((a, i) => !a.startsWith('--') && (nowAt < 0 || i !== nowAt + 1));
  const list = args.includes('--list');
  if (!list && !id) {
    console.error('usage: npm run qa:scenario <scenario-id> [-- --now <iso>] | -- --list');
    console.error(`scenarios: ${fixtureScenarioIds().join(', ')}`);
    process.exit(2);
  }

  const modName = 'pg'; // resolved from qa/scripts/node_modules (npm --prefix qa/scripts ci)
  let Client: new (o: { connectionString: string }) => PgClient;
  try {
    Client = (await import(modName)).default.Client;
  } catch {
    throw new Error('Missing dependency: run `npm --prefix qa/scripts ci` once.');
  }
  const client = new Client({ connectionString: databaseUrl() });
  try {
    await client.connect();
  } catch (e) {
    throw new Error(
      `Cannot reach the local database (${(e as Error).message}). Run \`supabase start && supabase db reset\`.`,
    );
  }
  try {
    const has = await client.query(
      `select to_regprocedure('dev_seed.apply_scenario(text, timestamptz)') is not null as ok`,
    );
    if (!has.rows[0].ok) {
      throw new Error(
        'dev_seed is not loaded: run `supabase db reset` (supabase/seed.sql, BE-05).',
      );
    }
    if (list) {
      for (const sid of await seededScenarioIds(client)) console.log(sid);
      return;
    }
    console.log(formatSummary(await applyScenario(client, id as string, now)));
  } finally {
    await client.end();
  }
}

if (import.meta.main) {
  main(process.argv).catch((e: Error) => {
    console.error(`qa:scenario: ${e.message}`);
    process.exit(1);
  });
}
