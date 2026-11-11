import {
  INTRO_ELIGIBILITY_STATUS,
  PACKAGE_TYPE,
  PURCHASES_ERROR_CODE,
} from 'react-native-purchases';

import { premiumState } from '@/features/premium/model';
import {
  checkIntroIneligible,
  checkTrialEligible,
  identifyPurchaser,
  loadOffering,
  purchasePlan,
  purchasesAvailable,
  resetPurchaser,
  resetPurchasesForTests,
  restorePurchases,
} from '@/features/premium/purchases';
import { fakePackage, purchasesMock } from '@/test/purchases';

const mocked = purchasesMock;
const pkg = fakePackage;

const offerings = {
  current: null,
  all: {
    default: {
      identifier: 'default',
      availablePackages: [
        pkg('$rc_monthly', PACKAGE_TYPE.MONTHLY, 'M-PRICE'),
        pkg(
          '$rc_annual',
          PACKAGE_TYPE.ANNUAL,
          'Y-PRICE',
          { price: 0, unit: 'DAY', units: 7 },
          'PM',
        ),
        pkg('$rc_lifetime', PACKAGE_TYPE.LIFETIME, 'L-PRICE'),
      ],
    },
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  resetPurchasesForTests();
  delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
});

describe('without a RevenueCat key (CI, Jest, local)', () => {
  it('is unavailable and never touches the SDK', async () => {
    expect(purchasesAvailable()).toBe(false);
    await identifyPurchaser('u1');
    await resetPurchaser();
    expect(await loadOffering('default')).toBeNull();
    expect(await purchasePlan('default', '$rc_annual', 'u1')).toEqual({
      kind: 'failed',
      reason: 'unavailable',
    });
    expect(await restorePurchases('u1')).toEqual({ kind: 'failed', reason: 'unavailable' });
    expect(mocked.configure).not.toHaveBeenCalled();
    expect(mocked.logIn).not.toHaveBeenCalled();
  });
});

describe('with a key', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = 'appl_test';
    mocked.getOfferings.mockResolvedValue(offerings);
  });

  it('configures once, quietly, with the public key', () => {
    expect(purchasesAvailable()).toBe(true);
    expect(purchasesAvailable()).toBe(true);
    expect(mocked.configure).toHaveBeenCalledTimes(1);
    expect(mocked.configure).toHaveBeenCalledWith({ apiKey: 'appl_test' });
    expect(mocked.setLogLevel).toHaveBeenCalledWith('ERROR');
  });

  it('maps the offering to yearly then monthly, prices and trial only from the store', async () => {
    const offering = await loadOffering('default');
    expect(offering).toEqual({
      id: 'default',
      plans: [
        {
          id: '$rc_annual',
          kind: 'yearly',
          price: 'Y-PRICE',
          pricePerMonth: 'PM',
          productId: 'product$rc_annual',
          amount: 0,
          currencyCode: 'XTS',
          trial: { count: 7, unit: 'day', days: 7 },
          introOffer: null,
        },
        {
          id: '$rc_monthly',
          kind: 'monthly',
          price: 'M-PRICE',
          pricePerMonth: null,
          productId: 'product$rc_monthly',
          amount: 0,
          currencyCode: 'XTS',
          trial: null,
          introOffer: null,
        },
      ],
    });
  });

  it('a paid intro price (the `day3` first year, D52) is the store string, never a trial', async () => {
    mocked.getOfferings.mockResolvedValue({
      current: null,
      all: {
        day3: {
          availablePackages: [
            pkg(
              '$rc_annual',
              PACKAGE_TYPE.ANNUAL,
              'Y',
              { price: 45, unit: 'YEAR', units: 1 },
              null,
              { price: 60 },
            ),
          ],
        },
      },
    });
    const [yearly] = (await loadOffering('day3'))!.plans;
    expect(yearly!.trial).toBeNull();
    expect(yearly!.introOffer).toEqual({ price: 'intro', amount: 45 });
  });

  it('only a free intro is a trial; a week counts as 7 days', async () => {
    mocked.getOfferings.mockResolvedValue({
      current: null,
      all: {
        default: {
          availablePackages: [
            pkg('y', PACKAGE_TYPE.ANNUAL, 'Y', { price: 0, unit: 'WEEK', units: 2 }),
            pkg('m', PACKAGE_TYPE.MONTHLY, 'M', { price: 1.99, unit: 'MONTH', units: 1 }),
          ],
        },
      },
    });
    const plans = (await loadOffering('default'))!.plans;
    expect(plans[0]!.trial).toEqual({ count: 2, unit: 'week', days: 14 });
    expect(plans[1]!.trial).toBeNull();
  });

  it('a missing offering is null; `default` falls back to the current one', async () => {
    expect(await loadOffering('day3')).toBeNull();
    mocked.getOfferings.mockResolvedValue({ current: offerings.all.default, all: {} });
    expect((await loadOffering('default'))!.plans).toHaveLength(2);
  });

  it('logIn with the Supabase user id; logOut swallows the anonymous error', async () => {
    await identifyPurchaser('u1');
    expect(mocked.logIn).toHaveBeenCalledWith('u1');
    mocked.logOut.mockRejectedValueOnce({
      code: PURCHASES_ERROR_CODE.LOG_OUT_ANONYMOUS_USER_ERROR,
    });
    await expect(resetPurchaser()).resolves.toBeUndefined();
  });

  it('purchase: success, cancel and the failure reasons', async () => {
    await loadOffering('default');
    mocked.purchasePackage.mockResolvedValueOnce({
      customerInfo: { entitlements: { active: { premium: {} } } },
    });
    expect(await purchasePlan('default', '$rc_annual', 'u1')).toEqual({
      kind: 'purchased',
      premiumHint: true,
    });
    expect(mocked.purchasePackage.mock.calls[0]?.[0].identifier).toBe('$rc_annual');

    const cases: [string, unknown][] = [
      [PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR, { kind: 'cancelled' }],
      [PURCHASES_ERROR_CODE.NETWORK_ERROR, { kind: 'failed', reason: 'network' }],
      [
        PURCHASES_ERROR_CODE.PRODUCT_ALREADY_PURCHASED_ERROR,
        { kind: 'failed', reason: 'alreadyOwned' },
      ],
      [PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR, { kind: 'failed', reason: 'pending' }],
      [PURCHASES_ERROR_CODE.STORE_PROBLEM_ERROR, { kind: 'failed', reason: 'payment' }],
      [PURCHASES_ERROR_CODE.UNKNOWN_ERROR, { kind: 'failed', reason: 'unknown' }],
    ];
    for (const [code, outcome] of cases) {
      mocked.purchasePackage.mockRejectedValueOnce({ code, message: 'receipt-secret' });
      expect(await purchasePlan('default', '$rc_annual', 'u1')).toEqual(outcome);
    }
  });

  it('never buys while RevenueCat is anonymous (logIn first, or fail)', async () => {
    await loadOffering('default');
    mocked.logIn.mockRejectedValueOnce(new Error('offline'));
    await identifyPurchaser('u1');
    mocked.logIn.mockRejectedValueOnce(new Error('offline'));
    expect(await purchasePlan('default', '$rc_annual', 'u1')).toEqual({
      kind: 'failed',
      reason: 'network',
    });
    expect(mocked.purchasePackage).not.toHaveBeenCalled();
    expect(await purchasePlan('default', '$rc_annual', null)).toEqual({
      kind: 'failed',
      reason: 'network',
    });
  });

  it('an unknown plan id is unavailable', async () => {
    expect(await purchasePlan('default', 'nope', 'u1')).toEqual({
      kind: 'failed',
      reason: 'unavailable',
    });
  });

  it('restore reports the SDK hint', async () => {
    mocked.restorePurchases.mockResolvedValueOnce({ entitlements: { active: { premium: {} } } });
    expect(await restorePurchases('u1')).toEqual({ kind: 'restored', premiumHint: true });
    expect(await restorePurchases('u1')).toEqual({ kind: 'restored', premiumHint: false });
  });

  it('never logs purchase data', async () => {
    const spies = (['log', 'warn', 'error', 'info'] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation(() => {}),
    );
    await loadOffering('default');
    mocked.purchasePackage.mockRejectedValueOnce({ code: '2', message: 'receipt-secret' });
    await purchasePlan('default', '$rc_annual', 'u1');
    await restorePurchases('u1');
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});

describe('premiumState (mirrors is_couple_premium)', () => {
  const now = Date.parse('2026-11-05T12:00:00Z');
  const row = (user_id: string, is_active: boolean, expires_at: string | null) => ({
    user_id,
    is_active,
    expires_at,
  });

  it('mine, my partner, expiry and a former partner', () => {
    expect(premiumState([row('me', true, null)], 'me', 'p', now)).toEqual({
      isPremium: true,
      mine: true,
      partner: false,
    });
    expect(premiumState([row('p', true, '2026-12-01T00:00:00Z')], 'me', 'p', now)).toEqual({
      isPremium: true,
      mine: false,
      partner: true,
    });
    expect(premiumState([row('me', true, '2026-11-01T00:00:00Z')], 'me', 'p', now).isPremium).toBe(
      false,
    );
    expect(premiumState([row('me', false, null)], 'me', 'p', now).isPremium).toBe(false);
    // A recently unpaired partner's row is readable (RLS) but doesn't cover me.
    expect(premiumState([row('old', true, null)], 'me', null, now).isPremium).toBe(false);
    expect(premiumState(undefined, 'me', 'p', now).isPremium).toBe(false);
  });
});

describe('checkTrialEligible (D52: 17 shows the trial only to an eligible person)', () => {
  const plan = {
    id: '$rc_annual',
    kind: 'yearly' as const,
    price: 'Y-PRICE',
    pricePerMonth: null,
    productId: 'yearly_trial',
    amount: 60,
    currencyCode: 'XTS',
    trial: { count: 7, unit: 'day' as const, days: 7 },
    introOffer: null,
  };
  const status = (s: INTRO_ELIGIBILITY_STATUS) =>
    mocked.checkTrialOrIntroductoryPriceEligibility.mockResolvedValue({
      yearly_trial: { status: s, description: '' },
    });

  beforeEach(() => {
    process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = 'appl_test';
    process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY = 'goog_test';
  });
  afterEach(() => {
    delete process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
  });

  it('iOS: eligible only when RevenueCat says ELIGIBLE', async () => {
    status(INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE);
    expect(await checkTrialEligible(plan, 'ios')).toBe(true);
    expect(mocked.checkTrialOrIntroductoryPriceEligibility).toHaveBeenCalledWith(['yearly_trial']);
  });

  it('iOS: INELIGIBLE, UNKNOWN, missing or an error are all "no trial"', async () => {
    status(INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_INELIGIBLE);
    expect(await checkTrialEligible(plan, 'ios')).toBe(false);
    status(INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_UNKNOWN);
    expect(await checkTrialEligible(plan, 'ios')).toBe(false);
    mocked.checkTrialOrIntroductoryPriceEligibility.mockResolvedValue({});
    expect(await checkTrialEligible(plan, 'ios')).toBe(false);
    mocked.checkTrialOrIntroductoryPriceEligibility.mockRejectedValue(new Error('x'));
    expect(await checkTrialEligible(plan, 'ios')).toBe(false);
  });

  it('Android: Play returns the trial only to an eligible account, so a trial means eligible', async () => {
    expect(await checkTrialEligible(plan, 'android')).toBe(true);
    expect(await checkTrialEligible({ ...plan, trial: null }, 'android')).toBe(false);
    expect(mocked.checkTrialOrIntroductoryPriceEligibility).not.toHaveBeenCalled();
  });

  it('no trial on the product, or no key: false without asking', async () => {
    expect(await checkTrialEligible({ ...plan, trial: null }, 'ios')).toBe(false);
    delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
    resetPurchasesForTests();
    expect(await checkTrialEligible(plan, 'ios')).toBe(false);
    expect(mocked.checkTrialOrIntroductoryPriceEligibility).not.toHaveBeenCalled();
  });
});

describe('checkIntroIneligible (D52: the store is the second gate on the day-3 gift)', () => {
  const plan = {
    id: '$rc_annual',
    kind: 'yearly' as const,
    price: 'Y-PRICE',
    pricePerMonth: null,
    productId: 'yearly_day3',
    amount: 60,
    currencyCode: 'XTS',
    trial: null,
    introOffer: { price: 'O-PRICE', amount: 45 },
  };
  const status = (s: INTRO_ELIGIBILITY_STATUS) =>
    mocked.checkTrialOrIntroductoryPriceEligibility.mockResolvedValue({
      yearly_day3: { status: s, description: '' },
    });

  beforeEach(() => {
    process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = 'appl_test';
    process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY = 'goog_test';
  });
  afterEach(() => {
    delete process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
  });

  it('iOS: only a definite INELIGIBLE blocks; unknown or an error does not', async () => {
    status(INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_INELIGIBLE);
    expect(await checkIntroIneligible(plan, 'ios')).toBe(true);
    status(INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE);
    expect(await checkIntroIneligible(plan, 'ios')).toBe(false);
    status(INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_UNKNOWN);
    expect(await checkIntroIneligible(plan, 'ios')).toBe(false);
    mocked.checkTrialOrIntroductoryPriceEligibility.mockRejectedValue(new Error('x'));
    expect(await checkIntroIneligible(plan, 'ios')).toBe(false);
  });

  it('Android: Play left out the intro price, so this account can\'t get it', async () => {
    expect(await checkIntroIneligible(plan, 'android')).toBe(false);
    expect(await checkIntroIneligible({ ...plan, introOffer: null }, 'android')).toBe(true);
  });

  it('no key: never blocks', async () => {
    delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
    resetPurchasesForTests();
    expect(await checkIntroIneligible(plan, 'ios')).toBe(false);
  });
});
