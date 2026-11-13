// QA-05b: qa/fixtures/push-payloads.json `more_messages` against the server's message builders, so
// the fixture the app tests read (§5) is what the functions really send. Pure: no database, no
// network. The scheduled types (ritual_reminder, last_call, weekly_recap) are compared with real
// daily-reminder pushes in qa/contract/scheduled-push.test.ts; trial/offer endings here use the
// exported templates (their real-DB sends are pinned in purchases-be48 and offers).
import { assertEquals } from 'jsr:@std/assert@1';
import { littleThingMessages } from '../../supabase/functions/_shared/little_things.ts';
import { VOICE_MESSAGE } from '../../supabase/functions/notify/index.ts';
import { cancelOffer, offerEnding, trialEnding } from '../../supabase/functions/daily-reminder/index.ts';
import fixture from '../fixtures/push-payloads.json' with { type: 'json' };

type Message = {
  case: string;
  type: string;
  title: string;
  body: string;
  channelId?: string;
  sound?: string;
  priority?: string;
  interruptionLevel?: string;
  data: Record<string, unknown>;
};
const more = fixture.more_messages as Message[];
/** QA-52: pending (types the app does not route yet) + offer_messages (cancel_offer, routed since MOB-84). */
const pending = [...(fixture.pending_messages as Message[]), ...(fixture.offer_messages as Message[])];
const byCase = (name: string): Message => {
  const m = [...more, ...pending].find((x) => x.case === name);
  if (!m) throw new Error(`push-payloads.json more_messages has no case "${name}"`);
  return m;
};
/** The Expo message as the fixture writes it (fixture-only keys dropped). */
const expo = (m: Message, to: string): unknown => {
  const { case: _c, type: _t, to_user: _u, ...rest } = m as Message & { to_user?: string };
  return { to, ...rest };
};
const TOKEN = 'ExponentPushToken[FIXTURE-qa05b]';
const CLAIM = { user_id: 'u', claim_id: 'c', partner_name: 'Maya Lopez' };

Deno.test('little thing with sound: littleThingMessages builds exactly the fixture message', () => {
  const [m, ...rest] = littleThingMessages(
    { ...CLAIM, silent: false, gesture: 'hug', counts: { kiss: 3, hug: 1 } },
    [TOKEN],
  );
  assertEquals(rest, []);
  assertEquals<unknown>(m, expo(byCase('little thing with sound'), TOKEN));
});

Deno.test('little thing silent: no sound, quiet channel, passive (quiet hours or BE-53 off)', () => {
  const [m, ...rest] = littleThingMessages(
    { ...CLAIM, silent: true, gesture: 'hug', counts: { hug: 1 } },
    [TOKEN],
  );
  assertEquals(rest, []);
  assertEquals<unknown>(m, expo(byCase('little thing silent (quiet hours or sounds off)'), TOKEN));
  assertEquals('sound' in m, false);
});

Deno.test('thread voice message: approved copy filled with the first name, no content', () => {
  const m = byCase('thread voice message');
  assertEquals(m.title, VOICE_MESSAGE.title.replaceAll('{partner}', 'Maya'));
  assertEquals(m.body, VOICE_MESSAGE.body);
  assertEquals(Object.keys(m.data).sort(), ['type', 'url']);
});

Deno.test('trial, offer endings and cancel offer: the fixture copy is the approved template (no price)', () => {
  // Offer pushes name the partner (BE-59 (c), BE-62 (c)); the fixtures go to Maya, so `{partner}` = Sam.
  const fill = (v: string | undefined) => v?.replaceAll('{partner}', 'Sam');
  for (
    const [name, t] of [
      ['trial ending', trialEnding],
      ['offer ending', offerEnding],
      ['cancel offer', cancelOffer],
    ] as const
  ) {
    const m = byCase(name);
    assertEquals([m.title, m.body, m.data.url], [fill(t.title), fill(t.body), t.url]);
    assertEquals(m.channelId, m.type, name);
    assertEquals(/\{\w+\}/.test(`${m.title} ${m.body}`), false, `${name}: placeholder left`);
    assertEquals(/[$€£¥]|\d+[.,]\d{2}/.test(`${m.title} ${m.body}`), false, name);
  }
});

Deno.test('more_messages and messages together cover every CONTRACTS §5 push type', () => {
  const types = new Set([...fixture.messages, ...more, ...pending].map((m) => m.type));
  const section5 = [
    'ritual_reminder',
    'partner_answered',
    'both_answered',
    'thread_activity',
    'last_call',
    'nudge',
    'partner_joined',
    'partner_premium',
    'weekly_recap',
    'trial_ending',
    'offer_ending',
    'cancel_offer',
    'little_thing',
  ];
  assertEquals(section5.filter((t) => !types.has(t)), []);
  for (const m of [...fixture.messages, ...more, ...pending]) assertEquals(m.data.type, m.type, m.case);
});
