import { assertEquals } from 'jsr:@std/assert@1';
import { deliverWidgetRefreshes, widgetRefreshMessage } from './widget_refresh.ts';
import { type ExpoBackgroundMessage, sendExpoBackgroundPush } from './push.ts';

const NOW = '2030-05-02T12:00:00.000Z';
const fake = (
  options: {
    users?: string[];
    tokens?: Record<string, string[]>;
    selectionError?: boolean;
    tokenError?: boolean;
  } = {},
) => {
  const calls: { rpc: unknown[]; tokenUsers: string[][]; deleted: string[][] } = {
    rpc: [],
    tokenUsers: [],
    deleted: [],
  };
  const tokens = options.tokens ?? { 'FIXTURE-u1': ['tok-1a', 'tok-1b'], 'FIXTURE-u2': ['tok-2'] };
  const admin = {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.rpc.push([name, args]);
      return Promise.resolve({
        data: options.selectionError
          ? null
          : (options.users ?? ['FIXTURE-u1', 'FIXTURE-u2']).map((user_id) => ({ user_id })),
        error: options.selectionError ? { message: 'FIXTURE' } : null,
      });
    },
    from: (table: string) => {
      assertEquals(table, 'push_tokens');
      return {
        select: (columns: string) => {
          assertEquals(columns, 'token');
          return {
            in: (column: string, values: string[]) => {
              assertEquals(column, 'user_id');
              calls.tokenUsers.push(values);
              return Promise.resolve({
                data: options.tokenError
                  ? null
                  : values.flatMap((user) => (tokens[user] ?? []).map((token) => ({ token }))),
                error: options.tokenError ? { message: 'FIXTURE' } : null,
              });
            },
          };
        },
        delete: () => ({
          in: (column: string, values: string[]) => {
            assertEquals(column, 'token');
            calls.deleted.push(values);
            return Promise.resolve({ error: null });
          },
        }),
      };
    },
  };
  const sent: ExpoBackgroundMessage[] = [];
  const send = (messages: ExpoBackgroundMessage[]) => {
    sent.push(...messages);
    return Promise.resolve({
      tickets: messages.map(() => ({ status: 'ok' as const })),
      invalidTokens: messages.some((m) => m.to === 'tok-1b') ? ['tok-1b'] : [],
    });
  };
  return { admin, calls, sent, send };
};

Deno.test('widget_refresh payload (BE-64, CONTRACTS §5): data-only, content-available, normal priority, nothing else', () => {
  const message = widgetRefreshMessage('ExponentPushToken[FIXTURE]');
  assertEquals(message, {
    to: 'ExponentPushToken[FIXTURE]',
    data: { type: 'widget_refresh' },
    priority: 'normal',
    _contentAvailable: true,
  });
  for (
    const key of ['title', 'body', 'sound', 'channelId', 'badge', 'subtitle', 'interruptionLevel']
  ) {
    assertEquals(key in message, false);
  }
  assertEquals(Object.keys(message.data), ['type']);
});

Deno.test('widget_refresh: one silent push per device of each due person, server clock, invalid tokens removed', async () => {
  const f = fake();
  assertEquals(await deliverWidgetRefreshes(f.admin, NOW, f.send), { widget_refreshed: 2 });
  assertEquals(f.calls.rpc, [['due_widget_refreshes', { p_now: NOW }]]);
  assertEquals(f.calls.tokenUsers, [['FIXTURE-u1', 'FIXTURE-u2']]);
  assertEquals(f.sent.map((m) => m.to), ['tok-1a', 'tok-1b', 'tok-2']);
  assertEquals(f.sent.every((m) => JSON.stringify(m.data) === '{"type":"widget_refresh"}'), true);
  assertEquals(f.calls.deleted, [['tok-1b']]);
});

Deno.test('widget_refresh: nothing due or no device sends nothing', async () => {
  const none = fake({ users: [] });
  assertEquals(await deliverWidgetRefreshes(none.admin, NOW, none.send), { widget_refreshed: 0 });
  assertEquals(none.calls.tokenUsers, []);
  assertEquals(none.sent, []);
  const noDevice = fake({ tokens: {} });
  assertEquals(await deliverWidgetRefreshes(noDevice.admin, NOW, noDevice.send), {
    widget_refreshed: 0,
  });
  assertEquals(noDevice.sent, []);
});

Deno.test('widget_refresh: failures never throw and never resend (claims are kept in SQL)', async () => {
  const selection = fake({ selectionError: true });
  assertEquals(await deliverWidgetRefreshes(selection.admin, NOW, selection.send), {
    widget_refreshed: 0,
    widget_refresh_failed: true,
  });
  assertEquals(selection.sent, []);
  const tokens = fake({ tokenError: true });
  assertEquals(
    (await deliverWidgetRefreshes(tokens.admin, NOW, tokens.send)).widget_refresh_failed,
    true,
  );
  const transport = fake();
  const result = await deliverWidgetRefreshes(transport.admin, NOW, () => {
    throw new Error('FIXTURE transport');
  });
  assertEquals(result, { widget_refreshed: 0, widget_refresh_failed: true });
  // One call to the selection only: nothing retried inside the run.
  assertEquals(transport.calls.rpc.length, 1);
});

Deno.test('widget_refresh logs counts only (no token, user id or payload)', async () => {
  const lines: string[] = [];
  const original = console.log;
  console.log = (line: string) => lines.push(String(line));
  try {
    const f = fake();
    await deliverWidgetRefreshes(f.admin, NOW, f.send);
    await deliverWidgetRefreshes(fake({ selectionError: true }).admin, NOW, f.send);
  } finally {
    console.log = original;
  }
  assertEquals(lines.map((line) => JSON.parse(line).event), [
    'widget_refresh.sent',
    'widget_refresh.failed',
  ]);
  assertEquals(lines.some((line) => /tok-|FIXTURE-u|widget_refresh"/.test(line)), false);
});

Deno.test('sendExpoBackgroundPush posts the exact background payload to Expo', async () => {
  const bodies: unknown[] = [];
  const result = await sendExpoBackgroundPush(
    [widgetRefreshMessage('ExponentPushToken[A]')],
    (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }],
          }),
        ),
      );
    },
  );
  assertEquals(bodies, [[{
    to: 'ExponentPushToken[A]',
    data: { type: 'widget_refresh' },
    priority: 'normal',
    _contentAvailable: true,
  }]]);
  assertEquals(result.invalidTokens, ['ExponentPushToken[A]']);
});
