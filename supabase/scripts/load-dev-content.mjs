// BE-32: content only. Deliberately has no generic project/URL override.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentSql } from './content-sql.mjs';

export const DEV_REF = 'nyqbrsqqalygydtwvybb';

export function devContentSql() {
  return `begin;\nset local lock_timeout = '10s';\nset local statement_timeout = '45s';\nselect pg_advisory_xact_lock(326032);\n${contentSql({ includeAgeGated: false })}\ncommit;\n`;
}

export async function loadDevContent({ projectRef, accessToken, fetchImpl = fetch } = {}) {
  // Validate before reading content, secrets or making any request. Never fall back to a linked ref.
  if (projectRef !== DEV_REF) throw new Error('DEV_PROJECT_REQUIRED');
  if (typeof accessToken !== 'string' || !accessToken.trim()) throw new Error('ACCESS_TOKEN_REQUIRED');
  let response;
  try {
    response = await fetchImpl(`https://api.supabase.com/v1/projects/${DEV_REF}/database/query`, {
      method: 'POST',
      redirect: 'error',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: devContentSql(), read_only: false }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    // Fetch errors can include request details. Never echo them, response bodies or SQL in CI logs.
    throw new Error('CONTENT_LOAD_NETWORK_ERROR');
  }
  if (!response.ok) throw new Error('CONTENT_LOAD_REJECTED');
  // Consume without logging: the API may return SQL results or query text.
  await response.body?.cancel();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error('NO_ARGUMENTS_ALLOWED');
    await loadDevContent({
      projectRef: process.env.SUPABASE_PROJECT_REF,
      accessToken: process.env.SUPABASE_ACCESS_TOKEN,
    });
    console.log('bonded-dev content loaded (D33; no personas)');
  } catch (error) {
    console.error(['NO_ARGUMENTS_ALLOWED', 'DEV_PROJECT_REQUIRED', 'ACCESS_TOKEN_REQUIRED',
      'CONTENT_LOAD_NETWORK_ERROR', 'CONTENT_LOAD_REJECTED'].includes(error.message)
      ? error.message : 'CONTENT_LOAD_FAILED');
    process.exitCode = 1;
  }
}
