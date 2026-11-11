// BE-43 (D09): delete-account removes every voice recording the user uploaded before the Auth user.
import { assertEquals } from 'jsr:@std/assert@1';
import { handle } from './index.ts';

const USER = '00000000-0000-0000-0000-0000000043aa';
const names = (n: number) =>
  Array.from({ length: n }, (_, i) => `couple-${i % 2}/${USER}/take-${i}.m4a`);

const fakeAdmin = (opts: {
  voice?: { data: unknown; error: unknown | null };
  removeFails?: string;
  deleteError?: { status?: number; code?: string } | null;
}) => {
  const calls: string[] = [];
  const rpcArgs: Record<string, unknown>[] = [];
  const admin = {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push(`rpc:${name}`);
      rpcArgs.push(args);
      return Promise.resolve(opts.voice ?? { data: [], error: null });
    },
    auth: {
      admin: {
        deleteUser: (id: string) => {
          calls.push(`delete:${id}`);
          return Promise.resolve({ error: opts.deleteError ?? null });
        },
      },
    },
    storage: {
      from: (bucket: string) => ({
        remove: (paths: string[]) => {
          calls.push(`remove:${bucket}:${paths.length}`);
          return Promise.resolve({
            error: bucket === opts.removeFails ? { message: `fail ${USER}` } : null,
          });
        },
      }),
    },
  };
  return { admin, calls, rpcArgs };
};
const call = (admin: unknown) =>
  handle(
    new Request('http://test', { method: 'POST' }),
    () => Promise.resolve(USER),
    () => admin as never,
  );

Deno.test('delete-account removes the avatar, then all own voice objects in chunks, then the Auth user', async () => {
  const { admin, calls, rpcArgs } = fakeAdmin({ voice: { data: names(150), error: null } });
  const response = await call(admin);
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { ok: true });
  assertEquals(calls, [
    'remove:avatars:1',
    'rpc:voice_objects_of_user',
    'remove:voice:100',
    'remove:voice:50',
    `delete:${USER}`,
  ]);
  assertEquals(rpcArgs, [{ p_user: USER }]);
});

Deno.test('delete-account with no voice objects makes no voice remove call', async () => {
  const { admin, calls } = fakeAdmin({});
  assertEquals((await call(admin)).status, 200);
  assertEquals(calls, ['remove:avatars:1', 'rpc:voice_objects_of_user', `delete:${USER}`]);
});

Deno.test('delete-account keeps the Auth user when listing or removing voice objects fails', async () => {
  for (
    const opts of [
      { voice: { data: null, error: { message: `db ${USER}` } } },
      { voice: { data: names(3), error: null }, removeFails: 'voice' },
    ]
  ) {
    const { admin, calls } = fakeAdmin(opts);
    const response = await call(admin);
    assertEquals(response.status, 500);
    const body = await response.text();
    assertEquals(JSON.parse(body), { error: 'DELETE_FAILED', message: 'Could not delete account' });
    assertEquals(body.includes(USER), false);
    assertEquals(calls.some((c) => c.startsWith('delete:')), false);
  }
});

Deno.test('delete-account retry after the voice objects are gone still succeeds (idempotent)', async () => {
  const { admin } = fakeAdmin({ deleteError: { status: 404 } });
  assertEquals(await (await call(admin)).json(), { ok: true });
});
