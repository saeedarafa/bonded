import { assertEquals } from 'jsr:@std/assert@1';
import { handle } from './index.ts';
import type { ExpoMessage } from '../_shared/push.ts';
const allow = () => Promise.resolve(true);
const request = () =>
  new Request('http://test', { method: 'POST', body: '{"p_now":"2000-01-01"}' });
const clock = () => new Date('2026-11-03T21:00:00Z');
const reminder = {
  user_id: 'FIXTURE-user',
  claim_id: 'FIXTURE-claim',
  type: 'ritual_reminder',
  streak: 3,
  partner_name: 'Sam',
  partner_answered: true,
};
const fixture = (
  options: {
    tokens?: string[];
    selectionError?: boolean;
    sendError?: boolean;
    noRows?: boolean;
    weekly?: boolean;
    recapError?: boolean;
    trial?: boolean;
    trialError?: boolean;
    offer?: boolean;
    offerError?: boolean;
  } = {},
) => {
  const messages: ExpoMessage[] = [];
  const updates: unknown[] = [];
  const deletions: unknown[] = [];
  const claimed = new Set<string>();
  const admin = {
    rpc: (name: string, args: unknown) => {
      assertEquals(
        ['due_reminders', 'due_weekly_recaps', 'due_trial_endings', 'due_offer_endings'].includes(
          name,
        ),
        true,
      );
      assertEquals(args, { p_now: clock().toISOString() });
      const rows = name === 'due_offer_endings'
        ? options.offer
          ? [{ user_id: reminder.user_id, claim_id: 'FIXTURE-offer-claim', minutes_left: 120 }]
          : []
        : name === 'due_trial_endings'
        ? options.trial
          ? [{ user_id: reminder.user_id, claim_id: 'FIXTURE-trial-claim', days_left: 3 }]
          : []
        : name === 'due_weekly_recaps'
        ? options.weekly
          ? [{ user_id: reminder.user_id, claim_id: reminder.claim_id, days_together: 6 }]
          : []
        : options.weekly || options.trial || options.offer
        ? []
        : [reminder];
      const data = claimed.has(name) || options.noRows ? [] : rows;
      claimed.add(name);
      return Promise.resolve({
        data,
        error: (name === 'due_reminders'
            ? options.selectionError
            : name === 'due_trial_endings'
            ? options.trialError
            : name === 'due_offer_endings'
            ? options.offerError
            : options.recapError)
          ? {}
          : null,
      });
    },
    from: (table: string) => ({
      select: () => ({
        eq: () =>
          Promise.resolve({
            data: (options.tokens ?? ['valid', 'invalid']).map((token) => ({ token })),
          }),
      }),
      update: (value: unknown) => ({
        eq: (key: string, id: string) => {
          updates.push({ table, key, id, value });
          return Promise.resolve({ error: null });
        },
      }),
      delete: () => ({
        in: (_key: string, ids: string[]) => {
          deletions.push(ids);
          return Promise.resolve({ error: null });
        },
      }),
    }),
  } as never;
  const send = (values: ExpoMessage[]) => {
    messages.push(...values);
    if (options.sendError) throw new Error('FIXTURE transport failure');
    return Promise.resolve({ tickets: [{ status: 'ok' as const }], invalidTokens: ['invalid'] });
  };
  return { deps: { admin, now: clock, send }, messages, updates, deletions };
};
Deno.test('reminders authenticate before any database or push access', async () => {
  const f = fixture();
  assertEquals((await handle(request(), () => Promise.resolve(false), f.deps)).status, 401);
  assertEquals(f.messages.length, 0);
});
Deno.test('reminders use server clock, approved content, Today routing, cleanup and persistent claims', async () => {
  const f = fixture();
  assertEquals(await (await handle(request(), allow, f.deps)).json(), { sent: 1 });
  assertEquals(f.messages.length, 2);
  assertEquals(f.messages[0].body, 'Sam already answered. Your turn.');
  assertEquals(f.messages[0].data, { type: 'ritual_reminder', url: 'bonded://today' });
  assertEquals(f.messages[0].channelId, 'ritual_reminder');
  assertEquals(f.deletions, [['invalid']]);
  assertEquals(f.updates, [{
    table: 'push_log',
    key: 'id',
    id: 'FIXTURE-claim',
    value: { status: 'sent', sent_at: clock().toISOString() },
  }]);
  assertEquals(await (await handle(request(), allow, f.deps)).json(), { sent: 0 });
  assertEquals(f.messages.length, 2);
});
Deno.test('no tokens suppresses the claim and sends nothing', async () => {
  const f = fixture({ tokens: [] });
  assertEquals(await (await handle(request(), allow, f.deps)).json(), { sent: 0 });
  assertEquals(f.messages.length, 0);
  assertEquals(f.updates, [{
    table: 'push_log',
    key: 'id',
    id: 'FIXTURE-claim',
    value: { status: 'suppressed' },
  }]);
});
Deno.test('selection error fails closed', async () => {
  const f = fixture({ selectionError: true });
  assertEquals((await handle(request(), allow, f.deps)).status, 500);
  assertEquals(f.messages.length, 0);
});
Deno.test('Sunday recap uses days-only copy, recap routing and persistent retry claims', async () => {
  const f = fixture({ weekly: true });
  assertEquals(await (await handle(request(), allow, f.deps)).json(), { sent: 1 });
  assertEquals(f.messages[0].title, 'Your week together');
  assertEquals(f.messages[0].body, 'You showed up 6 of 7 days. See your recap.');
  assertEquals(f.messages[0].channelId, 'weekly_recap');
  assertEquals(f.messages[0].data, { type: 'weekly_recap', url: 'bonded://history/recap' });
  assertEquals(await (await handle(request(), allow, f.deps)).json(), { sent: 0 });
  assertEquals(f.messages.length, 2);
});
Deno.test('recap selection fails closed and absent devices or uncertain sends keep claims', async () => {
  const bad = fixture({ weekly: true, recapError: true });
  assertEquals((await handle(request(), allow, bad.deps)).status, 500);
  assertEquals(bad.messages, []);
  const absent = fixture({ weekly: true, tokens: [] });
  assertEquals(await (await handle(request(), allow, absent.deps)).json(), { sent: 0 });
  assertEquals(absent.updates.length, 1);
  const uncertain = fixture({ weekly: true, sendError: true });
  assertEquals((await handle(request(), allow, uncertain.deps)).status, 500);
  assertEquals(await (await handle(request(), allow, uncertain.deps)).json(), { sent: 0 });
  assertEquals(uncertain.messages.length, 2);
  assertEquals(uncertain.updates, []);
});
Deno.test('unknown send outcome never releases claim or duplicates on retry', async () => {
  const f = fixture({ sendError: true });
  assertEquals((await handle(request(), allow, f.deps)).status, 500);
  assertEquals(f.updates, []);
  assertEquals(await (await handle(request(), allow, f.deps)).json(), { sent: 0 });
  assertEquals(f.messages.length, 2);
});
Deno.test('last call and nameless ritual use their content variants without answer text', async () => {
  const before = { ...reminder };
  try {
    Object.assign(reminder, { type: 'last_call' });
    const last = fixture();
    await handle(request(), allow, last.deps);
    assertEquals(last.messages[0].title, 'Your 3-day streak is waiting');
    assertEquals(last.messages[0].channelId, 'last_call');
    Object.assign(reminder, { type: 'ritual_reminder', partner_name: '' });
    const ritual = fixture();
    await handle(request(), allow, ritual.deps);
    assertEquals(ritual.messages[0].body, "It's your ritual time. Today's question is waiting.");
  } finally {
    Object.assign(reminder, before);
  }
});

Deno.test('trial_ending (BE-48): day-5 claim sends placeholder copy, no price, today link', async () => {
  const f = fixture({ trial: true, tokens: ['valid'] });
  const response = await handle(request(), allow, f.deps);
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { sent: 1 });
  assertEquals(f.messages.length, 1);
  const [message] = f.messages;
  assertEquals(message.channelId, 'trial_ending');
  assertEquals(message.data, { type: 'trial_ending', url: 'bonded://today' });
  assertEquals(typeof message.title, 'string');
  assertEquals(/[$€£]|\d+[.,]\d{2}/.test(`${message.title} ${message.body}`), false);
  assertEquals(f.updates.length, 1);
  assertEquals((f.updates[0] as { id: string }).id, 'FIXTURE-trial-claim');
  // Replay: the claim is consumed in SQL, so a second cron call sends nothing.
  const again = await handle(request(), allow, f.deps);
  assertEquals(await again.json(), { sent: 0 });
  assertEquals(f.messages.length, 1);
});

Deno.test('trial_ending (BE-48): no device suppresses the claim; selection failure is a 500', async () => {
  const none = fixture({ trial: true, tokens: [] });
  assertEquals(await (await handle(request(), allow, none.deps)).json(), { sent: 0 });
  assertEquals(none.messages.length, 0);
  assertEquals((none.updates[0] as { value: unknown }).value, { status: 'suppressed' });
  const failing = fixture({ trial: true, trialError: true });
  const response = await handle(request(), allow, failing.deps);
  assertEquals(response.status, 500);
  assertEquals(await response.json(), {
    error: 'INTERNAL_ERROR',
    message: 'Trial selection failed',
  });
  assertEquals(failing.messages.length, 0);
});

Deno.test('offer_ending (BE-47): one claim per partner, placeholder copy without price, today link', async () => {
  const f = fixture({ offer: true, tokens: ['valid'] });
  const response = await handle(request(), allow, f.deps);
  assertEquals(await response.json(), { sent: 1 });
  assertEquals(f.messages.length, 1);
  const [message] = f.messages;
  assertEquals(message.channelId, 'offer_ending');
  assertEquals(message.data, { type: 'offer_ending', url: 'bonded://today' });
  assertEquals(/[$€£%]|\d+[.,]\d{2}/.test(`${message.title} ${message.body}`), false);
  assertEquals((f.updates[0] as { id: string }).id, 'FIXTURE-offer-claim');
  assertEquals(await (await handle(request(), allow, f.deps)).json(), { sent: 0 });
  assertEquals(f.messages.length, 1);
});

Deno.test('offer_ending (BE-47): no device suppresses; selection failure is a 500', async () => {
  const none = fixture({ offer: true, tokens: [] });
  assertEquals(await (await handle(request(), allow, none.deps)).json(), { sent: 0 });
  assertEquals((none.updates[0] as { value: unknown }).value, { status: 'suppressed' });
  const failing = fixture({ offer: true, offerError: true });
  const response = await handle(request(), allow, failing.deps);
  assertEquals(response.status, 500);
  assertEquals(await response.json(), {
    error: 'INTERNAL_ERROR',
    message: 'Offer selection failed',
  });
  assertEquals(failing.messages.length, 0);
});
