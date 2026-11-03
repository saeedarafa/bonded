import { assertEquals } from 'jsr:@std/assert@1';
import { handle } from './index.ts';
import type { ExpoMessage } from '../_shared/push.ts';

Deno.test('premium delivery uses approved copy, packs route, quiet hours and retry claims', async () => {
  const enabled = false; // Transactional premium pushes do not use the nudges preference.
  let now = '2026-12-10T12:00:00Z';
  let claimed = false;
  let claimCalls = 0;
  const sent: ExpoMessage[] = [];
  const admin = {
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
          select: (columns: string) => ({
            eq: () => ({
              single: () =>
                Promise.resolve({
                  data: table === 'profiles'
                    ? columns === 'display_name'
                      ? { display_name: '  Maya PrivateSurname ' }
                      : { timezone: 'UTC' }
                    : { quiet_start: '23:00:00', quiet_end: '07:00:00', nudges: enabled },
                }),
            }),
          }),
        };
      }
      if (table === 'push_tokens') {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: [{ token: 'fixture-device' }] }),
          }),
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
      assertEquals(args.p_type, 'partner_premium');
      assertEquals(args.p_user, 'partner');
      assertEquals(args.p_cq, null);
      claimCalls++;
      const id = claimed ? null : 'fixture-claim';
      claimed = true;
      return Promise.resolve({ data: [{ claim_id: id }], error: null });
    },
  };
  const deliver = async () => {
    const response = await handle(
      new Request('http://test', {
        method: 'POST',
        body: JSON.stringify({
          type: 'partner_premium',
          record_id: 'fixture-premium',
          couple_id: 'fixture-couple',
          couple_question_id: null,
          actor_user_id: 'sender',
        }),
      }),
      () => Promise.resolve(true),
      {
        admin: admin as never,
        now: () => new Date(now),
        send: (messages) => {
          sent.push(...messages);
          return Promise.resolve({ tickets: [], invalidTokens: [] });
        },
      },
    );
    assertEquals(response.status, 200);
    return response.json();
  };
  now = '2026-12-10T23:00:00Z';
  assertEquals(await deliver(), { sent: 0, suppressed: 1 });
  assertEquals(claimCalls, 0);
  now = '2026-12-10T12:00:00Z';
  assertEquals(await deliver(), { sent: 1, suppressed: 0 });
  assertEquals(await deliver(), { sent: 0, suppressed: 1 });
  assertEquals(sent.length, 1);
  assertEquals(sent[0].title, "You're both Premium");
  assertEquals(sent[0].body, "Maya's plan covers you too. Every pack is open.");
  assertEquals(sent[0].channelId, 'partner_premium');
  assertEquals(sent[0].data, { type: 'partner_premium', url: 'bonded://packs' });
});
