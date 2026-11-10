// QA-06b: the purchase harness itself (security follow-ups on #128). If setup fails part-way, the
// Deno child is stopped and the stack is left as it was (no harness Vault entries, pg_net dropped if
// this run created it); stop() returns only after the child has exited; the harness never listens
// on every interface.
import { afterEach, describe, expect, it } from 'vitest';
import { sql } from './helpers';
import { startHarness } from './purchase-harness';

const vaultNames = async () =>
  (
    await sql<{ name: string }>(
      `select name from vault.secrets where name in ('functions_url', 'internal_function_secret') order by name`,
    )
  ).map((r) => r.name);
const hasPgNet = async () =>
  (await sql<{ n: number }>(`select count(*)::int n from pg_extension where extname = 'pg_net'`))[0]
    .n > 0;
/** True when nothing answers at `url` any more. */
const gone = async (url: string) =>
  fetch(`${url}/__state`).then(
    () => false,
    () => true,
  );

describe('purchase harness lifecycle (QA-06b)', () => {
  let pgNetBefore: boolean;
  afterEach(async () => {
    // Leave the stack as the next file expects it, whatever happened.
    await sql(`delete from vault.secrets where name in ('functions_url', 'internal_function_secret')`);
    if (!pgNetBefore) await sql('drop extension if exists pg_net');
  });

  it('listens on loopback (macOS) or the Docker gateway (Linux), never 0.0.0.0; stop() waits for the exit and undoes the stack changes', async () => {
    pgNetBefore = await hasPgNet();
    const h = await startHarness();
    const host = new URL(h.url).hostname;
    expect(['0.0.0.0', '[::]']).not.toContain(host);
    if (process.platform !== 'linux') expect(host).toBe('127.0.0.1');
    expect(await vaultNames()).toEqual(['functions_url', 'internal_function_secret']);
    expect(await hasPgNet()).toBe(true);
    await h.stop();
    expect(await gone(h.url)).toBe(true);
    expect(await vaultNames()).toEqual([]);
    expect(await hasPgNet()).toBe(pgNetBefore);
  });

  it.each(['after-ready', 'after-vault'] as const)(
    'a failure %s kills the child and removes what setup added',
    async (failAt) => {
      pgNetBefore = await hasPgNet();
      const err = await startHarness({ failAt }).then(
        () => null,
        (e: Error) => e,
      );
      expect(err?.message).toMatch(`injected failure ${failAt}`);
      const url = err!.message.match(/at (http:\S+)/)![1];
      expect(await gone(url)).toBe(true);
      expect(await vaultNames()).toEqual([]);
      expect(await hasPgNet()).toBe(pgNetBefore);
    },
  );

  it('the harness refuses to listen on every interface', async () => {
    pgNetBefore = await hasPgNet();
    const before = process.env.QA_HARNESS_BIND;
    process.env.QA_HARNESS_BIND = '0.0.0.0';
    try {
      await expect(startHarness()).rejects.toThrow(/exited 2[\s\S]*every interface/);
    } finally {
      if (before === undefined) delete process.env.QA_HARNESS_BIND;
      else process.env.QA_HARNESS_BIND = before;
    }
    expect(await vaultNames()).toEqual([]);
    expect(await hasPgNet()).toBe(pgNetBefore);
  });
});
