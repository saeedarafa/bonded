// QA-06: the real `revenuecat` and `notify` Edge Function handlers over HTTP, against the local
// Supabase stack, with only the outside world faked:
//   - the RevenueCat REST API (`https://api.revenuecat.com/v1/subscribers/<id>`) answers from an
//     in-memory subscriber table the test sets (`PUT /__rc/<user>`);
//   - Expo push delivery is captured in an outbox (`GET /__outbox`), never sent.
// QA-33 part 3 (BE-48): `POST /functions/v1/revenuecat-sync` runs the real handler with the real
// user authentication (Supabase Auth getUser), the fake RevenueCat API and the harness clock;
// `POST /__run/daily-reminder` runs the real daily-reminder handler once at the harness clock
// (its pushes land in the same outbox). `/functions/v1/daily-reminder` stays a transport probe for
// the database's pg_net request (BE-37), which must not run the handler.
// Authentication is the real one (REVENUECAT_WEBHOOK_SECRET / INTERNAL_FUNCTION_SECRET from the env),
// the admin client is the real service-role client from SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.
// The database reaches `POST /functions/v1/notify` through pg_net when the test points the Vault
// `functions_url` at this server.
//
// Started by qa/contract/purchases.test.ts:
//   deno run --allow-net --allow-env --allow-read --config supabase/functions/deno.json \
//     qa/functions/purchase_harness.ts
// It prints `READY <port>` on stdout. Local stacks only: it refuses a non-local SUPABASE_URL.
// It listens on HARNESS_HOSTNAME (default 127.0.0.1), never 0.0.0.0: the control routes
// (/__rc, /__state, /__clock, ...) have no authentication.
import { handle as revenuecat } from '../../supabase/functions/revenuecat/index.ts';
import { handle as notify } from '../../supabase/functions/notify/index.ts';
import { handle as revenuecatSync } from '../../supabase/functions/revenuecat-sync/index.ts';
import { handle as dailyReminder } from '../../supabase/functions/daily-reminder/index.ts';
import type { ExpoMessage } from '../../supabase/functions/_shared/push.ts';

export type Subscriber = Record<string, unknown>;
/** What the fake RevenueCat REST API answers for one user: a subscriber body or an HTTP error. */
export type RcAnswer = { subscriber: Subscriber } | { status: number };

const RC_HOST = 'https://api.revenuecat.com/v1/subscribers/';

export const createHarness = () => {
  const rc = new Map<string, RcAnswer>();
  const lookups: { user: string; authorized: boolean }[] = [];
  const dispatches: Record<string, unknown>[] = [];
  const sent: ExpoMessage[] = [];
  /** The notify handler's answers ({ sent, suppressed } or an error), for diagnosis. */
  const results: unknown[] = [];
  /** How the database's daily-reminder dispatch arrived (names and a match flag, never values). */
  const reminders: Record<string, unknown>[] = [];
  let clock: string | null = null;

  const fakeFetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith(RC_HOST)) {
      return Promise.resolve(new Response('unexpected host', { status: 599 }));
    }
    const user = decodeURIComponent(url.slice(RC_HOST.length));
    const auth = new Headers(init?.headers).get('authorization');
    const key = Deno.env.get('REVENUECAT_REST_API_KEY');
    lookups.push({ user, authorized: Boolean(key) && auth === `Bearer ${key}` });
    const answer = rc.get(user) ?? { subscriber: { entitlements: {}, subscriptions: {} } };
    return Promise.resolve(
      'status' in answer
        ? new Response('{}', { status: answer.status })
        : Response.json({ subscriber: answer.subscriber }),
    );
  }) as typeof fetch;

  const now = () => (clock ? new Date(clock) : new Date());

  /** Header/query-parameter names (never values), and whether the bearer is the internal secret. */
  const transport = (request: Request, url: URL) => {
    const secret = Deno.env.get('INTERNAL_FUNCTION_SECRET');
    return {
      authorization_header: request.headers.has('authorization'),
      bearer_matches: Boolean(secret) && request.headers.get('authorization') === `Bearer ${secret}`,
      query_keys: [...url.searchParams.keys()].sort(),
    };
  };

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === '/revenuecat' || path === '/functions/v1/revenuecat') {
      return await revenuecat(request, undefined, { fetch: fakeFetch, now });
    }
    if (path === '/functions/v1/revenuecat-sync') {
      return await revenuecatSync(request, undefined, { fetch: fakeFetch, now });
    }
    if (path === '/__run/daily-reminder' && request.method === 'POST') {
      const response = await dailyReminder(request, () => Promise.resolve(true), {
        now,
        send: (messages) => {
          sent.push(...messages);
          return Promise.resolve({ tickets: [], invalidTokens: [] });
        },
      });
      return new Response(await response.text(), { status: response.status });
    }
    if (path === '/functions/v1/notify') {
      // A test replaying a captured dispatch marks it, so `dispatches` stays what the database sent.
      if (request.headers.get('x-qa-replay') !== '1') {
        let body: Record<string, unknown>;
        try {
          body = await request.clone().json();
        } catch {
          body = { unparsable: true };
        }
        // Names only, never values: how the database's request carried its credentials.
        dispatches.push({ ...body, _transport: transport(request, url) });
      }
      const type = await request
        .clone()
        .json()
        .then((b: Record<string, unknown>) => b?.type ?? null)
        .catch(() => null);
      const response = await notify(request, undefined, {
        now,
        send: (messages) => {
          sent.push(...messages);
          return Promise.resolve({ tickets: [], invalidTokens: [] });
        },
      });
      results.push({
        type,
        replay: request.headers.get('x-qa-replay') === '1',
        status: response.status,
        body: await response.clone().json(),
      });
      return response;
    }
    if (path === '/functions/v1/daily-reminder') {
      // Only the transport is under test here (BE-37 / #126); the daily-reminder handler is not run.
      reminders.push({ method: request.method, ...transport(request, url) });
      return Response.json({ ok: true });
    }
    // Test controls. No secret: the harness only listens while a test runs, on a local stack.
    if (path.startsWith('/__rc/') && request.method === 'PUT') {
      rc.set(decodeURIComponent(path.slice('/__rc/'.length)), await request.json());
      return Response.json({ ok: true });
    }
    if (path === '/__reset' && request.method === 'POST') {
      rc.clear();
      lookups.length = 0;
      dispatches.length = 0;
      sent.length = 0;
      results.length = 0;
      reminders.length = 0;
      clock = null;
      return Response.json({ ok: true });
    }
    if (path === '/__clock' && request.method === 'PUT') {
      clock = ((await request.json()) as { now: string | null }).now;
      return Response.json({ ok: true });
    }
    if (path === '/__state' && request.method === 'GET') {
      return Response.json({ lookups, dispatches, sent, results, reminders });
    }
    return new Response('not found', { status: 404 });
  };
};

if (import.meta.main) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(supabaseUrl).hostname)) {
    console.error('purchase_harness: SUPABASE_URL must be a local stack');
    Deno.exit(2);
  }
  // Loopback on macOS; the Docker gateway address on Linux (set by qa/contract/purchase-harness.ts).
  const hostname = Deno.env.get('HARNESS_HOSTNAME') || '127.0.0.1';
  if (['0.0.0.0', '::', '[::]'].includes(hostname)) {
    console.error('purchase_harness: refusing to listen on every interface');
    Deno.exit(2);
  }
  Deno.serve({
    hostname,
    port: Number(Deno.env.get('HARNESS_PORT') ?? 0),
    onListen: ({ port }) => console.log(`READY ${port}`),
  }, createHarness());
}
