// QA-06: starts qa/functions/purchase_harness.ts (Deno) for the purchase contract tests and wires
// the database's push dispatch (pg_net + Vault `functions_url`) to it. See that file for what is
// real and what is faked. Local stack only: the secrets below are made-up FIXTURE values.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inject } from 'vitest';
import { sql } from './helpers';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const stack = inject('stack');

export const WEBHOOK_SECRET = 'FIXTURE-revenuecat-webhook-secret';
const REST_KEY = 'FIXTURE-revenuecat-rest-key';
const INTERNAL_SECRET = 'FIXTURE-internal-function-secret';

export type Subscriber = Record<string, unknown>;
export type HarnessState = {
  lookups: { user: string; authorized: boolean }[];
  dispatches: {
    type: string;
    record_id: string;
    couple_id: string;
    couple_question_id: string | null;
    actor_user_id: string;
    /** Header/query-parameter names (never values) the database's request arrived with. */
    _transport: Transport;
  }[];
  sent: {
    to: string;
    title: string;
    body: string;
    channelId: string;
    data: { type: string; url: string };
  }[];
  /** notify's answers; `type` is the dispatch's push type, `replay` marks h.replay calls. */
  results: { type: string | null; replay: boolean; status: number; body: unknown }[];
  /** The database's daily-reminder requests (private.dispatch_daily_reminders). */
  reminders: ({ method: string } & Transport)[];
};
/**
 * How a database request carried its credentials: header/query-parameter names (never values)
 * and whether the bearer is the internal function secret.
 */
export type Transport = {
  authorization_header: boolean;
  bearer_matches: boolean;
  query_keys: string[];
};

/**
 * How the database container reaches this machine. Docker Desktop and OrbStack resolve
 * host.docker.internal; on Linux (CI) the Supabase network's gateway is the host.
 * Override with QA_HOST_FROM_DB.
 */
function hostFromDb(): string {
  if (process.env.QA_HOST_FROM_DB) return process.env.QA_HOST_FROM_DB;
  if (process.platform !== 'linux') return 'host.docker.internal';
  const port = new URL(stack.dbUrl).port || '5432';
  const name = execFileSync(
    'docker',
    ['ps', '--filter', `publish=${port}`, '--format', '{{.Names}}'],
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n')[0];
  const gateway = execFileSync(
    'docker',
    ['inspect', '-f', '{{range .NetworkSettings.Networks}}{{.Gateway}} {{end}}', name],
    { encoding: 'utf8' },
  )
    .trim()
    .split(' ')[0];
  if (!gateway) throw new Error(`no Docker gateway for ${name}`);
  return gateway;
}

export type Harness = {
  url: string;
  /** POST a webhook body to the real revenuecat handler. `auth: null` sends no header. */
  webhook(
    payload: unknown,
    auth?: string | null,
    init?: { method?: string; rawBody?: string },
  ): Promise<{ status: number; body: unknown }>;
  /** What the fake RevenueCat REST API answers for a user from now on. */
  setSubscriber(user: string, subscriber: Subscriber): Promise<void>;
  failLookup(user: string, status: number): Promise<void>;
  /**
   * Sends a dispatch body to the real notify handler the way a correct pg_net call would
   * (Authorization: Bearer INTERNAL_FUNCTION_SECRET), and returns notify's answer.
   */
  replay(dispatch: Record<string, unknown>): Promise<{ status: number; body: unknown }>;
  /** The notify handler's clock (null = real time). The revenuecat handler shares it. */
  setClock(now: Date | null): Promise<void>;
  reset(): Promise<void>;
  state(): Promise<HarnessState>;
  /** Waits until every pg_net request issued since `mark()` has been answered by the harness. */
  mark(): Promise<number>;
  drain(since: number): Promise<void>;
  stop(): Promise<void>;
};

async function control(url: string, pathName: string, method: string, body?: unknown) {
  const res = await fetch(`${url}${pathName}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`harness ${method} ${pathName}: ${res.status}`);
  return res.json();
}

/** Kills the Deno child and waits for it to exit (SIGKILL after 5 s). */
async function killChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
  await exited;
  clearTimeout(timer);
}

/**
 * Where the harness listens. Never 0.0.0.0 (its control routes are unauthenticated): loopback on
 * macOS, where Docker Desktop / OrbStack forward host.docker.internal to the host's loopback, and
 * the Supabase network's gateway address on Linux, the only host address the database container
 * can reach. Override with QA_HARNESS_BIND.
 */
function bindAddress(fromDb: string): string {
  if (process.env.QA_HARNESS_BIND) return process.env.QA_HARNESS_BIND;
  return process.platform === 'linux' ? fromDb : '127.0.0.1';
}

/** Test seam for purchase-harness.test.ts: throw at a setup step to check the cleanup. */
export type StartOptions = { failAt?: 'after-ready' | 'after-vault' };

export async function startHarness(opts: StartOptions = {}): Promise<Harness> {
  const deno = process.env.DENO ?? 'deno';
  const fromDb = hostFromDb();
  const bind = bindAddress(fromDb);
  const child: ChildProcess = spawn(
    deno,
    [
      'run',
      '--allow-net',
      '--allow-env',
      '--allow-read',
      '--config',
      'supabase/functions/deno.json',
      'qa/functions/purchase_harness.ts',
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        SUPABASE_URL: stack.url,
        SUPABASE_SERVICE_ROLE_KEY: stack.serviceKey,
        REVENUECAT_WEBHOOK_SECRET: WEBHOOK_SECRET,
        REVENUECAT_REST_API_KEY: REST_KEY,
        INTERNAL_FUNCTION_SECRET: INTERNAL_SECRET,
        HARNESS_HOSTNAME: bind,
        HARNESS_PORT: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stderr = '';
  child.stderr!.on('data', (d) => (stderr += String(d)));

  // Everything this run changed on the stack, undone by cleanup() on failure or by stop().
  let created = false;
  let vaultTouched = false;
  const cleanup = async () => {
    const errors: unknown[] = [];
    if (vaultTouched) {
      await sql(
        `delete from vault.secrets where name in ('functions_url', 'internal_function_secret')`,
      ).catch((e: unknown) => errors.push(e));
    }
    if (created) {
      await sql('drop extension if exists pg_net').catch((e: unknown) => errors.push(e));
    }
    await killChild(child);
    if (errors.length) throw errors[0];
  };

  let url: string;
  try {
    const port = await new Promise<number>((resolve, reject) => {
      let out = '';
      const timer = setTimeout(
        () => reject(new Error(`purchase harness did not start in 60 s\n${stderr}`)),
        60_000,
      );
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(new Error(`cannot run ${deno} (QA-06 needs Deno on PATH): ${e.message}`));
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`purchase harness exited ${code}\n${stderr}`));
      });
      child.stdout!.on('data', (d) => {
        out += String(d);
        const m = out.match(/^READY (\d+)$/m);
        if (m) {
          clearTimeout(timer);
          resolve(Number(m[1]));
        }
      });
    });
    url = `http://${bind.includes(':') ? `[${bind}]` : bind}:${port}`;
    if (opts.failAt === 'after-ready') throw new Error(`injected failure after-ready at ${url}`);

    // Push dispatch: pg_net + Vault, as on a deployed project, pointed at this harness.
    // This replaces any functions_url / internal_function_secret already in the stack's Vault.
    created =
      (
        await sql<{ n: number }>(
          `select count(*)::int n from pg_extension where extname = 'pg_net'`,
        )
      )[0].n === 0;
    if (created) await sql('create extension pg_net');
    vaultTouched = true;
    await sql(
      `delete from vault.secrets where name in ('functions_url', 'internal_function_secret')`,
    );
    await sql(`select vault.create_secret($1, 'functions_url')`, [`http://${fromDb}:${port}`]);
    await sql(`select vault.create_secret($1, 'internal_function_secret')`, [INTERNAL_SECRET]);
    if (opts.failAt === 'after-vault') throw new Error(`injected failure after-vault at ${url}`);
  } catch (e) {
    await cleanup().catch(() => undefined);
    throw e;
  }

  const harness: Harness = {
    url,
    async webhook(payload, auth = `Bearer ${WEBHOOK_SECRET}`, init = {}) {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (auth !== null) headers.authorization = auth;
      const res = await fetch(`${url}/functions/v1/revenuecat`, {
        method: init.method ?? 'POST',
        headers,
        body:
          (init.method ?? 'POST') === 'GET' ? undefined : (init.rawBody ?? JSON.stringify(payload)),
      });
      const text = await res.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        // keep the text
      }
      return { status: res.status, body };
    },
    async replay(dispatch) {
      const { _transport: _, ...body } = dispatch;
      const res = await fetch(`${url}/functions/v1/notify`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${INTERNAL_SECRET}`,
          'x-qa-replay': '1',
        },
        body: JSON.stringify(body),
      });
      return { status: res.status, body: await res.json() };
    },
    async setSubscriber(user, subscriber) {
      await control(url, `/__rc/${user}`, 'PUT', { subscriber });
    },
    async failLookup(user, status) {
      await control(url, `/__rc/${user}`, 'PUT', { status });
    },
    async setClock(now) {
      await control(url, '/__clock', 'PUT', { now: now?.toISOString() ?? null });
    },
    async reset() {
      await control(url, '/__reset', 'POST');
    },
    async state() {
      return (await control(url, '/__state', 'GET')) as HarnessState;
    },
    async mark() {
      const r = await sql<{ v: string }>(
        `select case when is_called then last_value else 0 end::text v from net.http_request_queue_id_seq`,
      );
      return Number(r[0].v);
    },
    async drain(since) {
      const deadline = Date.now() + 20_000;
      for (;;) {
        const r = await sql<{ issued: number; answered: number; failed: number }>(
          `select (select case when is_called then last_value else 0 end from net.http_request_queue_id_seq)::int - $1 issued,
                  (select count(*) from net._http_response where id > $1)::int answered,
                  (select count(*) from net._http_response where id > $1 and status_code is null)::int failed`,
          [since],
        );
        const { issued, answered, failed } = r[0];
        if (failed > 0) throw new Error(`pg_net could not reach the purchase harness (${failed})`);
        if (answered >= issued) return;
        if (Date.now() > deadline)
          throw new Error(`pg_net: ${answered}/${issued} dispatches answered after 20 s`);
        await new Promise((r) => setTimeout(r, 100));
      }
    },
    async stop() {
      await cleanup();
    },
  };
  return harness;
}
