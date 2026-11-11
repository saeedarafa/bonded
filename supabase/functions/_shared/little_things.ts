// BE-45 (D48): little-things push. The database decides who gets a push and when
// (claim_little_thing_pushes: grouping, 1 per type per hour, D24 cap, toggle, quiet hours, undo);
// this module only turns a claim into Expo messages. Names and counts live only in the payload.
import type { ExpoMessage } from './push.ts';
import copy from '../../content/notifications.json' with { type: 'json' };

export const LITTLE_THING_KINDS = ['kiss', 'hug', 'miss_you', 'good_morning', 'goodnight'] as const;
export type LittleThingKind = (typeof LITTLE_THING_KINDS)[number];

/** One row of `claim_little_thing_pushes()` (CONTRACTS §4). */
export type LittleThingClaim = {
  user_id: string;
  claim_id: string;
  silent: boolean;
  partner_name: string | null;
  gesture: string;
  counts: Record<string, number>;
};

type Plural = { one: string; other: string };
type Template = {
  title: string;
  body: string;
  gestures: Record<LittleThingKind, Plural>;
  list_separator: string;
  list_last_separator: string;
  url: string;
};

// The PO's entry in notifications.json wins; this fallback only keeps the function working if the
// key is removed while the copy is being rewritten.
const fallback: Template = {
  title: 'Bonded',
  body: '{partner} sent you {gestures}',
  gestures: {
    kiss: { one: 'a kiss', other: '{count} kisses' },
    hug: { one: 'a hug', other: '{count} hugs' },
    miss_you: { one: 'a miss you', other: '{count} miss yous' },
    good_morning: { one: 'a good morning', other: '{count} good mornings' },
    goodnight: { one: 'a goodnight', other: '{count} goodnights' },
  },
  list_separator: ', ',
  list_last_separator: ' and ',
  url: 'bonded://today',
};
export const template: Template =
  (copy.types as unknown as Record<string, Template | undefined>).little_thing ?? fallback;

/** Sound and channel per gesture (CONTRACTS §5). The app bundles the sounds and creates the channels. */
export const LITTLE_THING_SOUNDS: Record<LittleThingKind, string> = {
  kiss: 'little_thing_kiss.wav',
  hug: 'little_thing_hug.wav',
  miss_you: 'little_thing_miss_you.wav',
  good_morning: 'little_thing_good_morning.wav',
  goodnight: 'little_thing_goodnight.wav',
};
export const LITTLE_THING_QUIET_CHANNEL = 'little_thing_quiet';
export const channelFor = (kind: LittleThingKind): string => `little_thing_${kind}`;

const isKind = (value: unknown): value is LittleThingKind =>
  typeof value === 'string' && (LITTLE_THING_KINDS as readonly string[]).includes(value);

/** Positive integer counts for known kinds only, in the fixed copy order. */
export const cleanCounts = (counts: unknown): [LittleThingKind, number][] => {
  const source = counts && typeof counts === 'object' ? counts as Record<string, unknown> : {};
  return LITTLE_THING_KINDS.flatMap((kind) => {
    const n = source[kind];
    return typeof n === 'number' && Number.isInteger(n) && n > 0 ? [[kind, n]] : [];
  });
};

export const firstName = (name: string | null | undefined): string =>
  typeof name === 'string' ? (name.trim().split(/\s+/)[0] ?? '').slice(0, 30) : '';

/** "3 kisses and a hug", "a kiss, 2 hugs and a goodnight". */
export const gestureList = (
  counts: [LittleThingKind, number][],
  t: Template = template,
): string => {
  const parts = counts.map(([kind, n]) =>
    (n === 1 ? t.gestures[kind].one : t.gestures[kind].other).replaceAll('{count}', String(n))
  );
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(t.list_separator)}${t.list_last_separator}${parts.at(-1)}`;
};

/** Expo messages for one claim, or [] if the claim carries nothing we can describe. */
export const littleThingMessages = (
  claim: LittleThingClaim,
  tokens: string[],
  t: Template = template,
): ExpoMessage[] => {
  const counts = cleanCounts(claim.counts);
  if (!counts.length) return [];
  const gesture: LittleThingKind = isKind(claim.gesture) ? claim.gesture : counts.at(-1)![0];
  const partner = firstName(claim.partner_name) || 'Your partner';
  const fill = (s: string) =>
    s.replaceAll('{partner}', partner).replaceAll('{gestures}', gestureList(counts, t));
  const data = {
    type: 'little_thing',
    url: t.url,
    gesture,
    gestures: Object.fromEntries(counts),
    silent: claim.silent,
  };
  return tokens.map((to) =>
    claim.silent
      // Quiet hours (D48): delivered without sound or alert; the quiet channel has no sound.
      ? {
        to,
        title: fill(t.title),
        body: fill(t.body),
        channelId: LITTLE_THING_QUIET_CHANNEL,
        priority: 'normal' as const,
        interruptionLevel: 'passive' as const,
        data,
      }
      : {
        to,
        title: fill(t.title),
        body: fill(t.body),
        sound: LITTLE_THING_SOUNDS[gesture],
        channelId: channelFor(gesture),
        priority: 'high' as const,
        interruptionLevel: 'active' as const,
        data,
      }
  );
};
