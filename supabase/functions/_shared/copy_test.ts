// BE-52 (PO 2026-11-11, D34/D48/D50/D52): the PO-approved push copy in supabase/content/notifications.json
// is used verbatim, everything else stays placeholder, and no push copy ever carries a price.
// Handler tests check the copy as sent: notify/voice_test.ts (voice message), notify/little_thing_test.ts
// (little_thing), daily-reminder/index_test.ts (trial_ending, offer_ending).
import { assert, assertEquals } from 'jsr:@std/assert@1';
import copy from '../../content/notifications.json' with { type: 'json' };
import { template as littleThing } from './little_things.ts';
import { cancelOffer, offerEnding, trialEnding } from '../daily-reminder/index.ts';
import { VOICE_MESSAGE } from '../notify/index.ts';

// A currency symbol or code, an amount with decimals, or a number next to a currency word.
export const PRICE =
  /[$€£¥₹₩₽¢]|\b(?:USD|EUR|GBP|CHF|JPY|CAD|AUD|SEK|NOK|DKK)\b|\d+[.,]\d{2}\b|\d+\s*(?:dollars?|euros?|pounds?|bucks)\b|\b(?:free|only)\s+for\s+\d/i;

/** Every user-visible string of the push copy: title, body, variants, gesture phrases, separators. */
const copyStrings = (node: unknown, path = ''): [string, string][] => {
  if (typeof node === 'string') return [[path, node]];
  if (!node || typeof node !== 'object') return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    // Rule text (trigger, pref, behaviour notes), ids and links are not shown to users.
    ['trigger', 'pref', 'priority', 'url', 'status', 'quiet_hours_behaviour'].includes(key)
      ? []
      : copyStrings(value, path ? `${path}.${key}` : key)
  );
};

Deno.test('the price pattern catches prices and lets the approved copy through', () => {
  for (const bad of ['$4.99', '4,99 €', 'USD 5', '£3', 'only 2.50 a month', '10 dollars', '¥500']) {
    assert(PRICE.test(bad), bad);
  }
  for (
    const fine of [
      '25% off Premium for you both.',
      'Your free trial ends in 2 days',
      '{count} kisses',
    ]
  ) {
    assertEquals(PRICE.test(fine), false, fine);
  }
});

Deno.test('no push copy contains a currency symbol or a price', () => {
  const strings = copyStrings(copy.types);
  assert(strings.length > 30, `walked ${strings.length} strings`);
  for (const [path, text] of strings) assertEquals(PRICE.test(text), false, `${path}: ${text}`);
});

Deno.test('approved copy (PO 2026-11-11) is exactly the PO text', () => {
  assertEquals(trialEnding, {
    ...trialEnding,
    title: 'Your free trial ends in 2 days',
    body: 'Keep Premium for both of you, or cancel anytime in Settings.',
    url: 'bonded://today',
  });
  assertEquals(offerEnding, {
    ...offerEnding,
    title: 'Your 50% off ends soon',
    body: 'You and {partner} earned half off Premium for a year. Tap to claim it.',
    partner_fallback: 'your partner',
    url: 'bonded://today',
  });
  // BE-62 (c), PO 2026-11-13 (D61).
  assertEquals(cancelOffer, {
    ...cancelOffer,
    title: 'Before you go: 30% off',
    body: 'Keep Premium with {partner} for 30% less your first year. Yours until your plan ends.',
    partner_fallback: 'your partner',
    url: 'bonded://subscription/offer',
  });
  assertEquals(VOICE_MESSAGE, {
    status: 'approved',
    title: '{partner} sent a voice message',
    body: 'Tap to listen.',
  });
  assertEquals(littleThing.title, 'Bonded');
  assertEquals(littleThing.body, '{partner} sent you {gestures}');
  assertEquals(littleThing.gestures, {
    kiss: { one: 'a kiss', other: '{count} kisses' },
    hug: { one: 'a hug', other: '{count} hugs' },
    miss_you: { one: 'a miss you', other: '{count} miss yous' },
    good_morning: { one: 'a good morning', other: '{count} good mornings' },
    goodnight: { one: 'a goodnight', other: '{count} goodnights' },
  });
});

Deno.test('exactly the approved entries are marked approved; the rest stays placeholder', () => {
  const approved: string[] = [];
  const walk = (node: unknown, path: string) => {
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    if (o.status === 'approved') approved.push(path);
    for (const [k, v] of Object.entries(o)) walk(v, path ? `${path}.${k}` : k);
  };
  walk(copy.types, '');
  assertEquals(approved.sort(), [
    'cancel_offer',
    'little_thing',
    'offer_ending',
    'thread_activity.single_reaction',
    'thread_activity.voice_message',
    'trial_ending',
  ]);
  assertEquals(copy.status, 'placeholder');
  // single_reaction no longer says "loved" (D45 emoji reactions); approved with the lead default the
  // PO accepted 2026-11-11 ("fix the unused single_reaction copy").
  assertEquals(copy.types.thread_activity.single_reaction, {
    status: 'approved',
    title: '{partner} reacted',
    body: '{partner} reacted to your answer.',
  });
});
