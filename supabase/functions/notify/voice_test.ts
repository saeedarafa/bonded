// BE-43 (D46): pushes about voice content carry no content: a voice message says "sent a voice
// message", a voice answer uses the normal copy; no path, duration or signed URL in the payload.
import { assertEquals } from 'jsr:@std/assert@1';
import { handle, VOICE_MESSAGE } from './index.ts';
import type { ExpoMessage } from '../_shared/push.ts';

const PATH = 'c0ffee00-0000-4000-8000-000000000001/5a3e0000-0000-4000-8000-000000000002/take.m4a';

const adminFor = (row: Record<string, unknown> | null, lookups: string[]) => ({
  from: (table: string) => {
    if (table === 'couple_members') {
      return {
        select: () => ({
          eq: () => ({
            is: () => Promise.resolve({ data: [{ user_id: 'sender' }, { user_id: 'partner' }] }),
          }),
        }),
      };
    }
    if (table === 'profiles' || table === 'notification_prefs') {
      return {
        select: (columns?: string) => ({
          eq: () => ({
            single: () =>
              Promise.resolve({
                data: table === 'profiles'
                  ? columns === 'display_name'
                    ? { display_name: '  Maya PrivateSurname ' }
                    : { timezone: 'UTC' }
                  : {
                    quiet_start: '23:00:00',
                    quiet_end: '07:00:00',
                    replies: true,
                    partner_answered: true,
                  },
              }),
          }),
        }),
      };
    }
    if (table === 'thread_messages') {
      return {
        select: (columns: string) => ({
          eq: (_column: string, id: string) => ({
            maybeSingle: () => {
              lookups.push(`${columns}:${id}`);
              return Promise.resolve({ data: row, error: null });
            },
          }),
        }),
      };
    }
    if (table === 'push_tokens') {
      return {
        select: () => ({ eq: () => Promise.resolve({ data: [{ token: 'fixture-device' }] }) }),
      };
    }
    const countQuery = {
      eq: (..._args: unknown[]) => countQuery,
      in: (..._args: unknown[]) => Promise.resolve({ count: 0 }),
      gte: (..._args: unknown[]) => Promise.resolve({ count: 0 }),
    };
    return {
      select: () => countQuery,
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    };
  },
  rpc: () => Promise.resolve({ data: [{ claim_id: 'fixture-claim' }], error: null }),
});

const deliver = async (type: string, row: Record<string, unknown> | null) => {
  const sent: ExpoMessage[] = [];
  const lookups: string[] = [];
  const response = await handle(
    new Request('http://test', {
      method: 'POST',
      body: JSON.stringify({
        type,
        record_id: 'fixture-record',
        couple_id: 'fixture-couple',
        couple_question_id: 'fixture-cq',
        actor_user_id: 'sender',
      }),
    }),
    () => Promise.resolve(true),
    {
      admin: adminFor(row, lookups) as never,
      now: () => new Date('2026-11-11T12:00:00Z'),
      send: (messages) => {
        sent.push(...messages);
        return Promise.resolve({ tickets: [], invalidTokens: [] });
      },
    },
  );
  assertEquals(response.status, 200);
  return { sent, lookups };
};

Deno.test('a voice thread message pushes "sent a voice message" without any content', async () => {
  const { sent, lookups } = await deliver('thread_activity', {
    kind: 'voice',
    voice_path: PATH,
    voice_duration_ms: 42000,
  });
  assertEquals(lookups, ['kind:fixture-record']);
  assertEquals(sent.length, 1);
  // BE-52: the PO-approved copy (notifications.json thread_activity.voice_message), first name only.
  assertEquals(VOICE_MESSAGE, {
    status: 'approved',
    title: '{partner} sent a voice message',
    body: 'Tap to listen.',
  });
  assertEquals(sent[0].title, 'Maya sent a voice message');
  assertEquals(sent[0].body, 'Tap to listen.');
  assertEquals(sent[0].data, {
    type: 'thread_activity',
    url: 'bonded://question/fixture-cq/thread',
  });
  const raw = JSON.stringify(sent);
  for (const secret of [PATH, 'take.m4a', '42000', 'voice_path', 'duration', 'PrivateSurname']) {
    assertEquals(raw.includes(secret), false, secret);
  }
});

Deno.test('a text message or a reaction keeps the generic thread copy', async () => {
  for (const row of [{ kind: 'text' }, null]) {
    const { sent } = await deliver('thread_activity', row);
    assertEquals(sent[0].body, 'New activity in your conversation.');
    assertEquals(sent[0].title, 'Bonded');
  }
});

Deno.test('a voice answer uses the normal answered copy and never looks up content', async () => {
  const { sent, lookups } = await deliver('partner_answered', { kind: 'voice', voice_path: PATH });
  assertEquals(lookups, []);
  assertEquals(sent[0].body, 'Your partner shared an update.');
  assertEquals(JSON.stringify(sent).includes(PATH), false);
});
