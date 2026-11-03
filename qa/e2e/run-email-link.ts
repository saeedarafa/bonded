// QA-11b (D35, CONTRACTS §10): sign-in by the email LINK on an iOS simulator against the LOCAL stack.
//
//   npm --prefix qa/e2e run email-link -- <warm|cold|used|all> --device <ios-sim-udid> [--runs N]
//
// Per case: seed `paired-day1-partner-answered` (Maya is in a couple, so a signed-in Maya lands on Today),
// empty the mail catcher, request the email IN THE APP (`auth/link-request.yaml`: the PKCE verifier lives
// in that install), read the verify link from Mailpit, then open it with `xcrun simctl openurl`. Safari
// follows Auth's 303 to bonded://auth/callback?code=… and iOS hands it to the app.
//   warm: the app is still running on 08's code step.
//   cold: the runner terminates the app first; the link launches it.
//   used: the runner follows the link once itself (redirect: manual), so Auth has consumed it; opening it
//         on the device redirects with error_code=otp_expired (what an expired link gets too). 08-email-
//         callback must show its error and its retry must lead back to a working 08 (sign in by code).
// Checks the session in the database too (auth.sessions for Maya created after the run started).
// iOS only (simctl). Env: SUPABASE_DB_URL / DB_URL (local only), MAILPIT_URL, MAESTRO.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import pg from 'pg';

import { databaseUrl, type Queryable } from '../scripts/seed-scenario.ts';
import { clearMail, MAILPIT, maestro as runFlow, MAYA, repoRoot, seed, useDevices, waitFor, type Result, type Run } from './lib.ts';

const EMAIL = 'maya@bonded.test';
const SCENARIO = 'paired-day1-partner-answered';
const STACK = 'http://127.0.0.1:54321';
const CASES = ['warm', 'cold', 'used'] as const;
type Case = (typeof CASES)[number];

const maestro = (r: Run) => runFlow({ ...r, flow: `auth/${r.flow}` });

/** The retry label of 08-email-callback (no testID yet), from the app's own locale file, never typed here. */
function retryLabel(): string {
  const en = JSON.parse(fs.readFileSync(path.join(repoRoot, 'src/i18n/locales/en.json'), 'utf8'));
  const label = en?.auth?.linkRetry;
  if (typeof label !== 'string' || !label) throw new Error('auth.linkRetry not found in src/i18n/locales/en.json');
  return label;
}

const decode = (s: string) => s.replaceAll('&amp;', '&').replaceAll('&#43;', '+').replaceAll('&#x2B;', '+');

/** The one Auth verify link in the newest mail to EMAIL (Mailpit API). Never logs the mail. */
async function verifyLink(): Promise<string> {
  return waitFor(`the sign-in mail for ${EMAIL} in ${MAILPIT}`, 30_000, async () => {
    const search = await fetch(`${MAILPIT}/api/v1/search?limit=1&query=${encodeURIComponent(`to:"${EMAIL}"`)}`).catch(() => null);
    if (!search?.ok) return null;
    const found = ((await search.json()) as { messages?: { ID: string }[] }).messages ?? [];
    if (!found.length) return null;
    const msg = await fetch(`${MAILPIT}/api/v1/message/${found[0].ID}`);
    if (!msg.ok) return null;
    const html = String(((await msg.json()) as { HTML?: string }).HTML ?? '');
    const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => decode(m[1]))
      .filter((u) => u.startsWith(`${STACK}/auth/v1/verify`));
    if (links.length !== 1) throw new Error(`expected one Auth verify link in the mail, found ${links.length}`);
    return links[0];
  });
}

/** Use the link once from the host so Auth consumes its token (the code it yields is useless here). */
async function consume(link: string) {
  const res = await fetch(link, { redirect: 'manual' });
  const loc = res.headers.get('location') ?? '';
  if (!/^bonded:\/\/auth\/callback\?code=/.test(loc)) throw new Error(`consuming the link did not redirect with a code (status ${res.status})`);
  const again = await fetch(link, { redirect: 'manual' });
  const loc2 = again.headers.get('location') ?? '';
  if (/[?&]code=/.test(loc2) || !/error/.test(loc2)) throw new Error('the used link still redirects without an error');
}

async function newSessions(db: Queryable, since: Date): Promise<number> {
  const r = await db.query('select count(*)::int as n from auth.sessions where user_id = $1 and created_at >= $2', [MAYA, since]);
  return Number(r.rows[0].n);
}

function openUrl(device: string, url: string) {
  execFileSync('xcrun', ['simctl', 'openurl', device, url]);
}

function terminate(device: string) {
  try {
    execFileSync('xcrun', ['simctl', 'terminate', device, 'app.bonded.mobile'], { stdio: 'ignore' });
  } catch {
    // already stopped
  }
}

async function runCase(db: Queryable, c: Case, device: string, run: number): Promise<Result> {
  const name = `${c} #${run}`;
  await seed(db, SCENARIO);
  await clearMail();
  const since = (await db.query('select now() as t')).rows[0].t as Date;
  if (!(await maestro({ flow: 'link-request.yaml', device, env: { EMAIL } }))) {
    return { name, ok: false, detail: 'requesting the email on 08 failed' };
  }
  let link: string;
  try {
    link = await verifyLink();
    if (c === 'used') await consume(link);
  } catch (e) {
    return { name, ok: false, detail: (e as Error).message };
  }
  if (c === 'cold') terminate(device);
  if (c === 'used') await clearMail(); // the next code must come from the new mail only
  const before = await newSessions(db, since);
  openUrl(device, link);
  const ok = c === 'used'
    ? await maestro({ flow: 'link-used.yaml', device, env: { EMAIL, RETRY_LABEL: retryLabel() } })
    : await maestro({ flow: 'link-signed-in.yaml', device });
  const after = await newSessions(db, since);
  // warm / cold: the link made a session on the device. used: the host's consume made one (before), the
  // device then signed in by code (one more). Either way at least one new session after opening.
  const dbOk = after > before;
  return { name, ok: ok && dbOk, detail: `flow ${ok ? 'ok' : 'FAILED'}, new Maya sessions ${before} -> ${after}` };
}

function arg(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(argv: string[]) {
  const id = argv.find((a, i) => !a.startsWith('--') && !['--device', '--runs'].includes(argv[i - 1] ?? ''));
  const device = arg(argv, '--device');
  const runs = Number(arg(argv, '--runs') ?? '1');
  if (!id || !['all', ...CASES].includes(id) || !device || !/^[0-9A-F-]{36}$/i.test(device) || !(runs >= 1)) {
    console.error('usage: npm --prefix qa/e2e run email-link -- <warm|cold|used|all> --device <ios-sim-udid> [--runs N]');
    process.exit(2);
  }
  useDevices(device);
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  const results: Result[] = [];
  try {
    for (let r = 1; r <= runs; r++) {
      for (const c of CASES) if (id === 'all' || id === c) results.push(await runCase(client, c, device, r));
    }
  } finally {
    await client.end();
  }
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  (${r.detail})`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((e: Error) => {
    console.error(`e2e email-link: ${e.message}`);
    process.exit(1);
  });
}
