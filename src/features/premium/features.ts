/**
 * The one list of what Premium adds (D51, D53), used by every paywall that names features: 17's
 * table, 34's table, 16's benefits and 35's list. D27 / REL-BIZ-03: a feature appears only once it
 * is in the build. When a feature ships, its task flips its flag here and every screen follows:
 * - `voice`: MOB-55 / MOB-56 (D46 voice answers and messages)
 * - `longAnswers`: MOB-54 (D46 answers up to 2,000 characters)
 * - `littleThings`: MOB-58 / MOB-59 (D48 more hugs, kisses and goodnights)
 */
export const SHIPPED = {
  packs: true,
  voice: false,
  longAnswers: false,
  littleThings: false,
  streakSaver: true,
  weeklyRecap: true,
} as const;

export type Shipped = { [K in keyof typeof SHIPPED]: boolean };
export type FeatureId = keyof Shipped;

/** Labels under `premium.compare` in the locale file. */
export type CompareKey =
  | 'daily'
  | 'packs'
  | 'voice'
  | 'longAnswers'
  | 'littleThings'
  | 'saver'
  | 'recap'
  | 'yes'
  | 'none'
  | 'all'
  | 'longFree'
  | 'longPremium'
  | 'aFew'
  | 'lotsMore'
  | 'basic'
  | 'full';

/** A Free / Premium row: i18n keys under `premium.compare`. */
export type CompareRow = {
  id: 'daily' | FeatureId;
  feature: CompareKey;
  free: CompareKey;
  premium: CompareKey;
};

/** Perks under `premium.success`. */
export type SuccessPerk =
  'packs' | 'saver' | 'voiceLong' | 'voice' | 'longAnswers' | 'littleThings' | 'recap';

/** D51's order. The daily question is always free and always listed. */
const ROWS: CompareRow[] = [
  { id: 'daily', feature: 'daily', free: 'yes', premium: 'yes' },
  { id: 'packs', feature: 'packs', free: 'none', premium: 'all' },
  { id: 'voice', feature: 'voice', free: 'none', premium: 'yes' },
  { id: 'longAnswers', feature: 'longAnswers', free: 'longFree', premium: 'longPremium' },
  { id: 'littleThings', feature: 'littleThings', free: 'aFew', premium: 'lotsMore' },
  { id: 'streakSaver', feature: 'saver', free: 'none', premium: 'yes' },
  { id: 'weeklyRecap', feature: 'recap', free: 'basic', premium: 'full' },
];

/** 17 and 34: only rows whose feature is in this build (never greyed, never "later"). */
export function compareRows(shipped: Shipped = SHIPPED): CompareRow[] {
  return ROWS.filter((r) => r.id === 'daily' || shipped[r.id]);
}

/** 35 "You're both Premium": i18n keys under `premium.success`, in the board's order. */
export function successPerks(shipped: Shipped = SHIPPED): SuccessPerk[] {
  const perks: SuccessPerk[] = [];
  if (shipped.packs) perks.push('packs');
  if (shipped.streakSaver) perks.push('saver');
  if (shipped.voice && shipped.longAnswers) perks.push('voiceLong');
  else if (shipped.voice) perks.push('voice');
  else if (shipped.longAnswers) perks.push('longAnswers');
  if (shipped.littleThings) perks.push('littleThings');
  if (shipped.weeklyRecap) perks.push('recap');
  return perks;
}

/** 16's second benefit: i18n key under `premium.benefits`, naming only shipped features. */
export function packsBenefit(
  shipped: Shipped = SHIPPED,
): 'packsVoiceLong' | 'packsVoice' | 'packsLong' | 'packs' {
  if (shipped.voice && shipped.longAnswers) return 'packsVoiceLong';
  if (shipped.voice) return 'packsVoice';
  if (shipped.longAnswers) return 'packsLong';
  return 'packs';
}
