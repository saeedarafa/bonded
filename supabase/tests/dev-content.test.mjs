// BE-32: destination guard, redaction and content-only replay. No hosted calls.
import assert from 'node:assert/strict';
import { createDb } from './pglite-supabase.mjs';
import { DEV_REF, devContentSql, loadDevContent } from '../scripts/load-dev-content.mjs';

let calls = 0;
const fetchImpl = async (url, options) => {
  calls++;
  assert.equal(url, `https://api.supabase.com/v1/projects/${DEV_REF}/database/query`);
  assert.equal(options.method, 'POST');
  assert.equal(options.redirect, 'error');
  assert.equal(options.headers.Authorization, 'Bearer fixture-secret');
  assert.equal(options.headers['Content-Type'], 'application/json');
  assert.equal(JSON.parse(options.body).query, devContentSql());
  assert.equal(JSON.parse(options.body).read_only, false);
  assert.ok(options.signal instanceof AbortSignal);
  return new Response('[]', { status: 201 });
};
for (const projectRef of [undefined, '', 'nciyrepyphvksusoigzx', 'other', DEV_REF + '.evil', DEV_REF + '/..', ` ${DEV_REF}`]) {
  await assert.rejects(loadDevContent({ projectRef, accessToken: 'fixture-secret', fetchImpl }), { message: 'DEV_PROJECT_REQUIRED' });
}
assert.equal(calls, 0, 'invalid destinations make no network call');
for (const accessToken of [undefined, '', ' ']) {
  await assert.rejects(loadDevContent({ projectRef: DEV_REF, accessToken, fetchImpl }), { message: 'ACCESS_TOKEN_REQUIRED' });
}
assert.equal(calls, 0, 'missing credentials make no network call');
await loadDevContent({ projectRef: DEV_REF, accessToken: 'fixture-secret', fetchImpl });
assert.equal(calls, 1);
for (const status of [301, 401, 403, 429, 500]) {
  await assert.rejects(loadDevContent({ projectRef: DEV_REF, accessToken: 'fixture-secret', fetchImpl: async () => new Response('PRIVATE fixture-secret', { status }) }), { message: 'CONTENT_LOAD_REJECTED' });
}
await assert.rejects(loadDevContent({ projectRef: DEV_REF, accessToken: 'fixture-secret', fetchImpl: async () => { throw new Error('PRIVATE fixture-secret'); } }), { message: 'CONTENT_LOAD_NETWORK_ERROR' });

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
  assert.equal((await db.query('select count(*)::int n from questions')).rows[0].n, 153);
  assert.equal((await db.query('select count(*)::int n from question_packs')).rows[0].n, 6);
  assert.equal((await db.query('select count(*)::int n from badges')).rows[0].n, 15);
  assert.equal((await db.query('select count(*)::int n from auth.users')).rows[0].n, 0);
  assert.equal((await db.query('select count(*)::int n from profiles')).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int n from questions where age_gate = '18+' and active")).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int n from question_packs where age_gate = '18+' and active")).rows[0].n, 0);
  console.log('PASS BE-32 destination, request, redaction, content-only, D33 and idempotency');
} finally {
  await db.close();
}
