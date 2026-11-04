// BE-32: content only. No account-wide Management API credential or generic SQL override.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { contentSql } from './content-sql.mjs';

export const DEV_REF = 'nyqbrsqqalygydtwvybb';

export function devContentSql() {
  return `begin;\nset local lock_timeout = '10s';\nset local statement_timeout = '45s';\nselect pg_advisory_xact_lock(326032);\n${contentSql({ includeAgeGated: false })}\ncommit;\n`;
}

export function devConnection(databaseUrl) {
  if (typeof databaseUrl !== 'string' || !databaseUrl.trim()) throw new Error('DEV_DB_URL_REQUIRED');
  try {
    const url = new URL(databaseUrl);
    const user = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    const direct = url.hostname === `db.${DEV_REF}.supabase.co` && user === 'postgres';
    const pooler = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname)
      && user === `postgres.${DEV_REF}`;
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || (!direct && !pooler)
      || (url.port && url.port !== '5432') || url.pathname !== '/postgres' || !password
      || url.hash || [...url.searchParams].some(([key, value]) => key !== 'sslmode' || value !== 'verify-full')
      || [user, password].some(v => /[\x00-\x1f\x7f]/.test(v))) throw new Error();
    return { host: url.hostname, user, password };
  } catch {
    // URL parsing errors may contain the entire credential. Never propagate them.
    throw new Error('DEV_DB_URL_INVALID');
  }
}

const runPsql = (env, sql) => new Promise((resolve, reject) => {
  // Credentials are child environment only; SQL on stdin. Discard psql errors/results: they may
  // contain copy, connection details or SQL. -X prevents user psqlrc from altering this execution.
  const child = spawn('psql', ['-X', '--no-password', '--set=ON_ERROR_STOP=1', '--quiet'], {
    env, stdio: ['pipe', 'ignore', 'ignore'], timeout: 60_000,
  });
  child.on('error', reject);
  child.stdin.on('error', reject);
  child.on('close', code => code === 0 ? resolve() : reject(new Error('PSQL_FAILED')));
  child.stdin.end(sql);
});

export async function loadDevContent({ projectRef, databaseUrl, caFile, run = runPsql } = {}) {
  // Both the explicit ref and actual connection identity are checked before content/process/network.
  if (projectRef !== DEV_REF) throw new Error('DEV_PROJECT_REQUIRED');
  const { host, user, password } = devConnection(databaseUrl);
  const env = {
    PATH: process.env.PATH,
    PGHOST: host, PGPORT: '5432', PGDATABASE: 'postgres', PGUSER: user, PGPASSWORD: password,
    PGSSLMODE: 'verify-full', PGSSLROOTCERT: caFile || 'system', PGCONNECT_TIMEOUT: '10',
    PGAPPNAME: 'bonded-dev-content',
  };
  // Do not inherit PGSERVICE/PGOPTIONS/PGHOSTADDR or any account-wide token from the parent.
  const sql = devContentSql();
  try {
    await run(env, sql);
  } catch {
    throw new Error('CONTENT_LOAD_FAILED');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error('NO_ARGUMENTS_ALLOWED');
    await loadDevContent({
      projectRef: process.env.SUPABASE_PROJECT_REF,
      databaseUrl: process.env.SUPABASE_DEV_DB_URL,
      caFile: process.env.SUPABASE_DEV_DB_CA_FILE,
    });
    console.log('bonded-dev content loaded (D33; no personas)');
  } catch (error) {
    console.error(['NO_ARGUMENTS_ALLOWED', 'DEV_PROJECT_REQUIRED', 'DEV_DB_URL_REQUIRED',
      'DEV_DB_URL_INVALID', 'CONTENT_LOAD_FAILED'].includes(error.message)
      ? error.message : 'CONTENT_LOAD_FAILED');
    process.exitCode = 1;
  }
}
