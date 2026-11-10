// BE-39 / MOB-49: answer pushes for a pack question open the same deep link as the daily question.
// The DB side (pack-notify.test.mjs) proves the trigger sends the pack row's couple_question_id;
// here `notify` turns it into data { type, url: bonded://question/<id> } for both answer types.
import { assertEquals } from 'jsr:@std/assert@1';
import { handle } from './index.ts';
import type { ExpoMessage } from '../_shared/push.ts';

const PACK_CQ = '00000000-0000-0000-0000-00000000b39a';

const deliver = async (type: 'partner_answered' | 'both_answered') => {
  const sent: ExpoMessage[] = [];
  const claims: Record<string, unknown>[] = [];
  const admin = {
    from: (table: string) => {
      if (table === 'couple_members') {
        return {
          select: () => ({
            eq: () => ({
              is: () => Promise.resolve({ data: [{ user_id: 'answerer' }, { user_id: 'partner' }] }),
            }),
          }),
        };
      }
      if (table === 'profiles' || table === 'notification_prefs') {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({
                  data: table === 'profiles'
                    ? { timezone: 'UTC' }
                    : { quiet_start: '23:00:00', quiet_end: '07:00:00', partner_answered: true },
                }),
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
      };
      return {
        select: () => countQuery,
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    },
    rpc: (_name: string, args: Record<string, unknown>) => {
      claims.push(args);
      return Promise.resolve({ data: [{ claim_id: 'fixture-claim' }], error: null });
    },
  };
  const response = await handle(
    new Request('http://test', {
      method: 'POST',
      body: JSON.stringify({
        type,
        record_id: `fixture-answer-${type}`,
        couple_id: 'fixture-couple',
        couple_question_id: PACK_CQ,
        actor_user_id: 'answerer',
      }),
    }),
    () => Promise.resolve(true),
    {
      admin: admin as never,
      now: () => new Date('2026-12-10T12:00:00Z'),
      send: (messages) => {
        sent.push(...messages);
        return Promise.resolve({ tickets: [], invalidTokens: [] });
      },
    },
  );
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { sent: 1, suppressed: 0 });
  return { sent, claims };
};

for (const type of ['partner_answered', 'both_answered'] as const) {
  Deno.test(`${type} for a pack question links to bonded://question/<couple_question_id>`, async () => {
    const { sent, claims } = await deliver(type);
    assertEquals(claims.length, 1);
    assertEquals(claims[0].p_user, 'partner');
    assertEquals(claims[0].p_type, type);
    assertEquals(claims[0].p_cq, PACK_CQ);
    assertEquals(sent.length, 1);
    assertEquals(sent[0].to, 'fixture-device');
    assertEquals(sent[0].channelId, type);
    assertEquals(sent[0].data, { type, url: `bonded://question/${PACK_CQ}` });
  });
}
