import { compareRows, packsBenefit, SHIPPED, successPerks } from '@/features/premium/features';
import { perPersonMonthly, savePercent } from '@/features/premium/pricing';
import type { Plan } from '@/features/premium/purchases';

const plan = (kind: Plan['kind'], amount: number | null, currencyCode: string | null = 'XTS') =>
  ({
    id: kind,
    kind,
    price: `${kind}-PRICE`,
    pricePerMonth: null,
    productId: `p-${kind}`,
    amount,
    currencyCode,
    trial: null,
  }) satisfies Plan;

describe('savePercent (BIZ-13: 1 − yearly ÷ 12 × monthly, never overstated)', () => {
  it('from the store numbers', () => {
    expect(savePercent(plan('yearly', 60), plan('monthly', 10))).toBe(50);
  });

  it('rounds down, never up', () => {
    // 1 − 39.99 / 59.88 = 33.216…% -> 33; 1 − 49.99 / 71.88 = 30.45…% -> 30
    expect(savePercent(plan('yearly', 39.99), plan('monthly', 4.99))).toBe(33);
    expect(savePercent(plan('yearly', 49.99), plan('monthly', 5.99))).toBe(30);
    // 1 − 80 / 120 = 33.33…% -> 33 (not 34)
    expect(savePercent(plan('yearly', 80), plan('monthly', 10))).toBe(33);
  });

  it('nothing to claim: unknown amounts, other currencies, or no saving', () => {
    expect(savePercent(plan('yearly', null), plan('monthly', 10))).toBeNull();
    expect(savePercent(plan('yearly', 60), undefined)).toBeNull();
    expect(savePercent(plan('yearly', 60, 'XTS'), plan('monthly', 10, 'XXX'))).toBeNull();
    expect(savePercent(plan('yearly', 120), plan('monthly', 10))).toBeNull();
    expect(savePercent(plan('yearly', 130), plan('monthly', 10))).toBeNull();
    expect(savePercent(plan('yearly', 0), plan('monthly', 10))).toBeNull();
  });
});

describe('perPersonMonthly (yearly ÷ 12 ÷ 2, in the store currency)', () => {
  it('formats the share in the store currency', () => {
    const value = perPersonMonthly(plan('yearly', 60));
    expect(value).toMatch(/XTS/);
    expect(value).toMatch(/2[.,]50/);
  });

  it('null without a yearly amount or currency, or for monthly', () => {
    expect(perPersonMonthly(plan('yearly', null))).toBeNull();
    expect(perPersonMonthly(plan('yearly', 60, null))).toBeNull();
    expect(perPersonMonthly(plan('monthly', 10))).toBeNull();
    expect(perPersonMonthly(undefined)).toBeNull();
  });

  it('a currency code this device cannot format: null, never a guess', () => {
    expect(perPersonMonthly(plan('yearly', 60, 'not a code'))).toBeNull();
  });
});

describe('one feature list (D27, D51, D53)', () => {
  const none = {
    packs: false,
    voice: false,
    longAnswers: false,
    littleThings: false,
    streakSaver: false,
    weeklyRecap: false,
  };
  const all = { ...none, packs: true, voice: true, longAnswers: true, littleThings: true };

  it('today: daily, packs, streak saver, weekly recap (voice, long answers, little things not built)', () => {
    expect(compareRows().map((r) => r.id)).toEqual([
      'daily',
      'packs',
      'streakSaver',
      'weeklyRecap',
    ]);
    expect(SHIPPED.voice || SHIPPED.longAnswers || SHIPPED.littleThings).toBe(false);
  });

  it('a row appears in D51 order as soon as its feature ships', () => {
    expect(compareRows({ ...all, streakSaver: true, weeklyRecap: true }).map((r) => r.id)).toEqual([
      'daily',
      'packs',
      'voice',
      'longAnswers',
      'littleThings',
      'streakSaver',
      'weeklyRecap',
    ]);
    expect(compareRows({ ...none, longAnswers: true }).map((r) => r.id)).toEqual([
      'daily',
      'longAnswers',
    ]);
  });

  it('35 and 16 name only shipped features', () => {
    expect(successPerks()).toEqual(['packs', 'saver', 'recap']);
    expect(successPerks({ ...all, streakSaver: true, weeklyRecap: true })).toEqual([
      'packs',
      'saver',
      'voiceLong',
      'littleThings',
      'recap',
    ]);
    expect(successPerks({ ...none, voice: true })).toEqual(['voice']);
    expect(packsBenefit()).toBe('packs');
    expect(packsBenefit(all)).toBe('packsVoiceLong');
    expect(packsBenefit({ ...none, longAnswers: true })).toBe('packsLong');
  });
});
