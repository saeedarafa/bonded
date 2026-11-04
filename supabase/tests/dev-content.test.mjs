// BE-32: destination guard, redaction and content-only replay. No hosted calls.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readContent } from '../scripts/content-sql.mjs';
import { createDb } from './pglite-supabase.mjs';
import { DEV_REF, devContentSql, loadDevContent } from '../scripts/load-dev-content.mjs';

let calls = 0;
const databaseUrl = `postgresql://postgres:fixture-secret@db.${DEV_REF}.supabase.co:5432/postgres`;
const poolerUrl = `postgresql://postgres.${DEV_REF}:fixture-secret@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`;
const run = async (env, sql) => {
  calls++;
  assert.equal(env.PGPORT, '5432');
  assert.equal(env.PGDATABASE, 'postgres');
  assert.equal(env.PGPASSWORD, 'fixture-secret');
  assert.equal(env.PGSSLMODE, 'verify-full');
  assert.equal(env.PGSSLROOTCERT, 'system');
  assert.equal(env.PGCONNECT_TIMEOUT, '10');
  assert.equal(env.PGSERVICE, undefined);
  assert.equal(env.PGOPTIONS, undefined);
  assert.equal(env.PGHOSTADDR, undefined);
  assert.equal(env.SUPABASE_ACCESS_TOKEN, undefined);
  assert.equal(sql, devContentSql());
};
for (const projectRef of [undefined, '', 'nciyrepyphvksusoigzx', 'other', DEV_REF + '.evil', DEV_REF + '/..', ` ${DEV_REF}`]) {
  await assert.rejects(loadDevContent({ projectRef, databaseUrl, run }), { message: 'DEV_PROJECT_REQUIRED' });
}
assert.equal(calls, 0, 'invalid destinations make no process/network call');
for (const databaseUrl of [undefined, '', ' ']) {
  await assert.rejects(loadDevContent({ projectRef: DEV_REF, databaseUrl, run }), { message: 'DEV_DB_URL_REQUIRED' });
}
for (const bad of [
  'private-invalid-fixture-secret',
  databaseUrl.replace(DEV_REF, 'nciyrepyphvksusoigzx'),
  poolerUrl.replace(DEV_REF, 'nciyrepyphvksusoigzx'),
  poolerUrl.replace(`postgres.${DEV_REF}`, 'postgres'),
  databaseUrl.replace('.supabase.co', '.supabase.co.evil'),
  databaseUrl.replace('5432', '6543'),
  databaseUrl.replace('/postgres', '/other'),
  databaseUrl.replace('postgresql:', 'https:'),
  databaseUrl.replace('fixture-secret', ''),
  databaseUrl.replace('fixture-secret', '%00'),
  databaseUrl + '?host=db.nciyrepyphvksusoigzx.supabase.co',
  databaseUrl + '?sslmode=disable', databaseUrl + '?options=-cfoo=bar', databaseUrl + '#private',
]) {
  await assert.rejects(loadDevContent({ projectRef: DEV_REF, databaseUrl: bad, run }), { message: 'DEV_DB_URL_INVALID' });
}
assert.equal(calls, 0, 'wrong/malformed actual connection is rejected before process/network');
process.env.PGSERVICE = 'fixture-untrusted';
process.env.PGOPTIONS = 'fixture-untrusted';
process.env.PGHOSTADDR = '127.0.0.1';
await loadDevContent({ projectRef: DEV_REF, databaseUrl, run: async (env, sql) => {
  assert.equal(env.PGHOST, `db.${DEV_REF}.supabase.co`);
  assert.equal(env.PGUSER, 'postgres');
  await run(env, sql);
} });
await loadDevContent({ projectRef: DEV_REF, databaseUrl: poolerUrl + '?sslmode=verify-full', run: async (env, sql) => {
  assert.equal(env.PGHOST, 'aws-0-eu-central-1.pooler.supabase.com');
  assert.equal(env.PGUSER, `postgres.${DEV_REF}`);
  await run(env, sql);
} });
assert.equal(calls, 2);
await assert.rejects(loadDevContent({ projectRef: DEV_REF, databaseUrl, run: async () => {
  throw new Error('PRIVATE fixture-secret SQL');
} }), { message: 'CONTENT_LOAD_FAILED' });
// Exercise CLI redaction without spawning psql or making a hosted connection.
const cli = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/load-dev-content.mjs', import.meta.url))], {
  env: { PATH: process.env.PATH, SUPABASE_PROJECT_REF: DEV_REF, SUPABASE_DEV_DB_URL: 'PRIVATE fixture-secret' },
  encoding: 'utf8',
});
assert.equal(cli.status, 1);
assert.equal(cli.stdout, '');
assert.equal(cli.stderr.trim(), 'DEV_DB_URL_INVALID');

// An inherited age-gating override cannot enable launch-excluded content in this hosted loader.
process.env.CONTENT_INCLUDE_AGE_GATED = 'true';
const sql = devContentSql();
assert.doesNotMatch(sql, /auth\.users|dev_seed|apply_scenario/);
assert.match(sql, /^begin;/);
assert.match(sql, /pg_advisory_xact_lock/);
assert.match(sql, /commit;\n$/);
const db = await createDb();
try {
  const snapshot = async () => JSON.stringify((await db.query(`select
    (select jsonb_agg(to_jsonb(q) order by external_id) from questions q) questions,
    (select jsonb_agg(to_jsonb(p) order by slug) from question_packs p) packs,
    (select jsonb_agg(to_jsonb(b) order by slug) from badges b) badges,
    (select jsonb_agg(to_jsonb(m) order by pack_id, question_id) from pack_questions m) memberships`)).rows);
  await db.exec(sql);
  const first = await snapshot();
  await db.exec(sql);
  assert.equal(await snapshot(), first, 'retry preserves all row values including IDs/timestamps');
  const expected = readContent({ includeAgeGated: false });
  assert.equal((await db.query('select count(*)::int n from questions')).rows[0].n, expected.questions.length);
  assert.equal((await db.query('select count(*)::int n from question_packs')).rows[0].n, expected.packs.length);
  assert.equal((await db.query('select count(*)::int n from badges')).rows[0].n, expected.badges.length);
  assert.equal((await db.query('select count(*)::int n from pack_questions')).rows[0].n, expected.questions.filter(q => q.pack_slug !== '').length);
  assert.equal((await db.query('select count(*)::int n from auth.users')).rows[0].n, 0);
  assert.equal((await db.query('select count(*)::int n from profiles')).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int n from questions where age_gate = '18+' and active")).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int n from question_packs where age_gate = '18+' and active")).rows[0].n, 0);
  console.log('PASS BE-32 destination, request, redaction, content-only, D33 and idempotency');
} finally {
  await db.close();
}
