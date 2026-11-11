// BE-45 (D48): the little-things push. Who gets a push and when (grouping, 1 per type per hour, the D24
// cap, the toggle, quiet hours, undo and the undo/claim race) is decided by claim_little_thing_pushes()
// in the database and tested with a pinned clock in supabase/tests/little-things-push.test.mjs. Here:
// the handler delivers exactly the claims it gets, with per-gesture sound/channel, silent in quiet hours,
// no extra pushes, no text in logs, and claims kept on failure.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { handle } from './index.ts';
import {
  cleanCounts,
  gestureList,
  type LittleThingClaim,
  littleThingMessages,
} from '../_shared/little_things.ts';
import type { ExpoMessage } from '../_shared/push.ts';

const NOW = new Date('2030-03-01T12:00:13Z');
const claimOf = (over: Partial<LittleThingClaim> = {}): LittleThingClaim => ({
  user_id: 'sam',
  claim_id: 'claim-1',
  silent: false,
  partner_name: 'Maya Rose',
  gesture: 'hug',
  counts: { kiss: 3, hug: 1 },
  ...over,
});

type Calls = { rpc: string[]; updates: { values: unknown; id: string }[]; deleted: string[][] };
const adminFor = (
  claims: LittleThingClaim[] | null,
  opts: { rpcError?: boolean; tokens?: Record<string, string[]> } = {},
) => {
  const calls: Calls = { rpc: [], updates: [], deleted: [] };
  const admin = {
    rpc: (name: string, args?: unknown) => {
      calls.rpc.push(`${name}:${JSON.stringify(args ?? null)}`);
      return Promise.resolve(
        opts.rpcError ? { data: null, error: { message: 'boom' } } : { data: claims, error: null },
      );
    },
    from: (table: string) => {
      if (table === 'push_tokens') {
        return {
          select: () => ({
            eq: (_c: string, user: string) =>
              Promise.resolve({ data: (opts.tokens?.[user] ?? []).map((token) => ({ token })) }),
          }),
          delete: () => ({
            in: (_c: string, tokens: string[]) => {
              calls.deleted.push(tokens);
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      if (table === 'push_log') {
        return {
          update: (values: unknown) => ({
            eq: (_c: string, id: string) => {
              calls.updates.push({ values, id });
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { admin, calls };
};

const deliver = async (
  claims: LittleThingClaim[] | null,
  opts: {
    rpcError?: boolean;
    tokens?: Record<string, string[]>;
    sendFails?: boolean;
    invalid?: string[];
  } = {},
) => {
  const { admin, calls } = adminFor(claims, opts);
  const sent: ExpoMessage[] = [];
  const logs: string[] = [];
  const original = console.log;
  console.log = (line: string) => logs.push(line);
  let response: Response;
  try {
    response = await handle(
      new Request('http://test', {
        method: 'POST',
        body: JSON.stringify({ type: 'little_thing' }),
      }),
      () => Promise.resolve(true),
      {
        admin: admin as never,
        now: () => NOW,
        send: (messages) => {
          if (opts.sendFails) return Promise.reject(new Error('EXPO_PUSH_500'));
          sent.push(...messages);
          return Promise.resolve({ tickets: [], invalidTokens: opts.invalid ?? [] });
        },
      },
    );
  } finally {
    console.log = original;
  }
  return { response, body: await response.json(), sent, calls, logs };
};

Deno.test('copy: counts in a fixed order, plurals, "and" before the last', () => {
  assertEquals(gestureList(cleanCounts({ hug: 1, kiss: 3 })), '3 kisses and a hug');
  assertEquals(gestureList(cleanCounts({ kiss: 1 })), 'a kiss');
  assertEquals(
    gestureList(cleanCounts({ goodnight: 1, hug: 2, kiss: 1, miss_you: 2 })),
    'a kiss, 2 hugs, 2 miss yous and a goodnight',
  );
  assertEquals(cleanCounts({ kiss: 0, hug: -1, wink: 2, miss_you: 1.5, goodnight: '1' }), []);
});

Deno.test('the dispatcher event claims on the database clock and sends one push per claim', async () => {
  const { response, body, sent, calls } = await deliver([claimOf()], {
    tokens: { sam: ['device-a', 'device-b'] },
  });
  assertEquals(response.status, 200);
  assertEquals(body, { sent: 1, suppressed: 0 });
  // No clock argument: the database decides eligibility (10 s after the send) and grouping.
  assertEquals(calls.rpc, ['claim_little_thing_pushes:null']);
  assertEquals(sent.length, 2);
  assertEquals(sent[0], {
    to: 'device-a',
    title: 'Bonded',
    body: 'Maya sent you 3 kisses and a hug',
    sound: 'little_thing_hug.wav',
    channelId: 'little_thing_hug',
    priority: 'high',
    interruptionLevel: 'active',
    data: {
      type: 'little_thing',
      url: 'bonded://today',
      gesture: 'hug',
      gestures: { kiss: 3, hug: 1 },
      silent: false,
    },
  });
  assertEquals(calls.updates, [{
    values: { status: 'sent', sent_at: NOW.toISOString() },
    id: 'claim-1',
  }]);
});

Deno.test('each gesture has its own sound and channel', () => {
  for (const kind of ['kiss', 'hug', 'miss_you', 'good_morning', 'goodnight']) {
    const [m] = littleThingMessages(claimOf({ gesture: kind, counts: { [kind]: 1 } }), ['d']);
    assertEquals(m.sound, `little_thing_${kind}.wav`);
    assertEquals(m.channelId, `little_thing_${kind}`);
    assertEquals(m.data?.gesture, kind);
  }
});

Deno.test('quiet hours: delivered silently (no sound, passive, quiet channel)', async () => {
  const { sent, body } = await deliver([
    claimOf({ silent: true, gesture: 'goodnight', counts: { goodnight: 1 } }),
  ], {
    tokens: { sam: ['device-a'] },
  });
  assertEquals(body, { sent: 1, suppressed: 0 });
  assertEquals('sound' in sent[0], false);
  assertEquals(sent[0].channelId, 'little_thing_quiet');
  assertEquals(sent[0].interruptionLevel, 'passive');
  assertEquals(sent[0].priority, 'normal');
  assertEquals(sent[0].data?.silent, true);
  assertEquals(sent[0].data?.gesture, 'goodnight');
  assertEquals(sent[0].body, 'Maya sent you a goodnight');
});

Deno.test('no claims (toggle off, cap reached, held, undone) → no push at all', async () => {
  for (const claims of [[], null]) {
    const { sent, body, calls } = await deliver(claims, { tokens: { sam: ['device-a'] } });
    assertEquals(sent, []);
    assertEquals(body, { sent: 0, suppressed: 0 });
    assertEquals(calls.updates, []);
  }
});

Deno.test('no device → the claim is marked suppressed; several recipients each get theirs', async () => {
  const { sent, body, calls } = await deliver(
    [
      claimOf(),
      claimOf({ user_id: 'eve', claim_id: 'claim-2', counts: { kiss: 1 }, gesture: 'kiss' }),
    ],
    { tokens: { eve: ['device-e'] }, invalid: ['device-e'] },
  );
  assertEquals(body, { sent: 1, suppressed: 1 });
  assertEquals(sent.map((m) => m.to), ['device-e']);
  assertEquals(calls.updates[0], { values: { status: 'suppressed' }, id: 'claim-1' });
  assertEquals(calls.updates[1].id, 'claim-2');
  assertEquals(calls.deleted, [['device-e']]);
});

Deno.test('a missing or blank name falls back to "Your partner"; first word only, ≤ 30 chars', () => {
  assertEquals(
    littleThingMessages(claimOf({ partner_name: null }), ['d'])[0].body,
    'Your partner sent you 3 kisses and a hug',
  );
  assertEquals(
    littleThingMessages(claimOf({ partner_name: '   ' }), ['d'])[0].body,
    'Your partner sent you 3 kisses and a hug',
  );
  assertEquals(
    littleThingMessages(claimOf({ partner_name: 'A'.repeat(40) }), ['d'])[0].body,
    `${'A'.repeat(30)} sent you 3 kisses and a hug`,
  );
});

Deno.test('an unknown lead gesture falls back to the last listed kind; nothing describable → no message', () => {
  const [m] = littleThingMessages(claimOf({ gesture: 'wink', counts: { kiss: 2 } }), ['d']);
  assertEquals(m.channelId, 'little_thing_kiss');
  assertEquals(littleThingMessages(claimOf({ counts: {} }), ['d']), []);
});

Deno.test('claim failure → 500 and nothing sent', async () => {
  const { response, sent } = await deliver(null, { rpcError: true });
  assertEquals(response.status, 500);
  assertEquals(sent, []);
});

Deno.test('send failure → 500 and the claim stays claimed (a retry never sends twice)', async () => {
  const { response, calls } = await deliver([claimOf()], {
    tokens: { sam: ['device-a'] },
    sendFails: true,
  });
  assertEquals(response.status, 500);
  assertEquals(calls.updates, []);
});

Deno.test('logs carry counts only: no name, gesture, user id or token', async () => {
  const { logs } = await deliver([claimOf()], { tokens: { sam: ['device-a'] } });
  assert(logs.length > 0);
  const all = logs.join('\n');
  for (const secret of ['Maya', 'kiss', 'hug', 'sam', 'device-a', 'claim-1']) {
    assertEquals(all.includes(secret), false, secret);
  }
});

Deno.test('other events are unchanged: a little_thing event needs no record ids, others still do', async () => {
  const response = await handle(
    new Request('http://test', { method: 'POST', body: JSON.stringify({ type: 'nudge' }) }),
    () => Promise.resolve(true),
    { admin: {} as never },
  );
  assertEquals(response.status, 400);
  const unauth = await handle(
    new Request('http://test', { method: 'POST', body: JSON.stringify({ type: 'little_thing' }) }),
    () => Promise.resolve(false),
    { admin: {} as never },
  );
  assertEquals(unauth.status, 401);
});
