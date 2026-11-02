// Load the product owner's content into a database (BE-05, D33).
//
//   node supabase/scripts/load-content.mjs                      # print the idempotent SQL
//   node supabase/scripts/load-content.mjs --apply "$DATABASE_URL"   # pipe it to psql
//   CONTENT_INCLUDE_AGE_GATED=true node supabase/scripts/load-content.mjs   # include 18+ packs
//
// For prod and `dev` (no seed.sql there). Local `supabase db reset` loads it through seed.sql.
import { execFileSync } from 'child_process';
import { contentSql, includeAgeGatedFromEnv } from './content-sql.mjs';

const args = process.argv.slice(2);
const sql = contentSql({ includeAgeGated: includeAgeGatedFromEnv() });
const i = args.indexOf('--apply');
if (i === -1) {
  process.stdout.write(sql);
} else {
  const url = args[i + 1];
  if (!url) { console.error('--apply needs a database URL'); process.exit(2); }
  execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-q', '-f', '-'], { input: sql, stdio: ['pipe', 'inherit', 'inherit'] });
  console.error('content loaded');
}
