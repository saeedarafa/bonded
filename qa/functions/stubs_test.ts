// QA-03 / BE-23: the Edge Function stubs reject every caller that lacks the right secret, using the
// real default authenticators (supabase/functions/index_test.ts injects them; this does not).
// Secrets here are made-up test values set on the process environment, never real ones.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { handle as notify } from '../../supabase/functions/notify/index.ts';
import { handle as reminder } from '../../supabase/functions/daily-reminder/index.ts';
import { handle as revenuecat } from '../../supabase/functions/revenuecat/index.ts';
import { handle as deleteAccount } from '../../supabase/functions/delete-account/index.ts';

const INTERNAL = 'FIXTURE-internal-secret';
const REVENUECAT = 'FIXTURE-revenuecat-secret';

const withEnv = async (env: Record<string, string | undefined>, run: () => Promise<void>) => {
  const before = Object.fromEntries(Object.keys(env).map((k) => [k, Deno.env.get(k)]));
  for (const [k, v] of Object.entries(env)) {
    v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
  }
  try {
    await run();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
    }
  }
};

const req = (authorization?: string) =>
  new Request('http://test', {
    method: 'POST',
    headers: authorization === undefined ? {} : { authorization },
  });

const internalStubs = { notify, 'daily-reminder': reminder };

for (const [name, handle] of Object.entries(internalStubs)) {
  Deno.test(`${name}: only the exact INTERNAL_FUNCTION_SECRET gets in`, async () => {
    await withEnv({ INTERNAL_FUNCTION_SECRET: INTERNAL }, async () => {
      for (
        const bad of [
          undefined,
          '',
          'Bearer',
          'Bearer wrong',
          `Basic ${INTERNAL}`,
          INTERNAL,
          `Bearer ${INTERNAL}x`,
          `Bearer ${INTERNAL.slice(0, -1)}`,
        ]
      ) {
        const res = await handle(req(bad));
        assertEquals(res.status, 401, `authorization=${JSON.stringify(bad)}`);
        assertEquals(await res.json(), { error: 'UNAUTHORIZED', message: 'Unauthorized' });
      }
      // The right secret passes authentication. What happens next is the function's business: the stub
      // answers 200, the real notify (BE-08) answers 400 for a request with no event body. Only
      // 401/403 would mean the secret was refused.
      const ok = await handle(req(`Bearer ${INTERNAL}`));
      await ok.body?.cancel();
      assert(
        ok.status !== 401 && ok.status !== 403,
        `the exact secret was refused with ${ok.status}`,
      );
    });
  });

  Deno.test(`${name}: with no secret configured nobody gets in (not even an empty bearer match)`, async () => {
    await withEnv({ INTERNAL_FUNCTION_SECRET: undefined }, async () => {
      assertEquals((await handle(req(`Bearer ${INTERNAL}`))).status, 401);
      assertEquals((await handle(req('Bearer '))).status, 401);
    });
  });

  Deno.test(`${name}: the RevenueCat secret does not open an internal function`, async () => {
    await withEnv(
      { INTERNAL_FUNCTION_SECRET: INTERNAL, REVENUECAT_WEBHOOK_SECRET: REVENUECAT },
      async () => {
        assertEquals((await handle(req(`Bearer ${REVENUECAT}`))).status, 401);
      },
    );
  });
}

Deno.test('revenuecat: only the exact REVENUECAT_WEBHOOK_SECRET gets in', async () => {
  await withEnv(
    { INTERNAL_FUNCTION_SECRET: INTERNAL, REVENUECAT_WEBHOOK_SECRET: REVENUECAT },
    async () => {
      for (const bad of [undefined, 'Bearer wrong', `Bearer ${INTERNAL}`, REVENUECAT]) {
        const res = await revenuecat(req(bad));
        assertEquals(res.status, 401, `authorization=${JSON.stringify(bad)}`);
        assertEquals(await res.json(), { error: 'UNAUTHORIZED', message: 'Unauthorized' });
      }
      assertEquals((await revenuecat(req(`Bearer ${REVENUECAT}`))).status, 200);
    },
  );
});

Deno.test('revenuecat: with no secret configured nobody gets in', async () => {
  await withEnv({ REVENUECAT_WEBHOOK_SECRET: undefined }, async () => {
    assertEquals((await revenuecat(req(`Bearer ${REVENUECAT}`))).status, 401);
  });
});

Deno.test('delete-account: a request without a bearer token is 401 and never reaches the database', async () => {
  await withEnv(
    {
      SUPABASE_URL: undefined,
      SUPABASE_SERVICE_ROLE_KEY: undefined,
      INTERNAL_FUNCTION_SECRET: INTERNAL,
    },
    async () => {
      for (const bad of [undefined, '', 'Bearer', `Basic abc`]) {
        const res = await deleteAccount(req(bad));
        assertEquals(res.status, 401, `authorization=${JSON.stringify(bad)}`);
      }
      // The internal secret is not a user session.
      assertEquals((await deleteAccount(req(`Bearer ${INTERNAL}`))).status, 401);
    },
  );
});
