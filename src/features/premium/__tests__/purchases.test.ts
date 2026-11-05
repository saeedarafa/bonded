import { PACKAGE_TYPE, PURCHASES_ERROR_CODE } from 'react-native-purchases';

import { premiumState } from '@/features/premium/model';
import {
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
          trial: { count: 7, unit: 'day', days: 7 },
        },
        { id: '$rc_monthly', kind: 'monthly', price: 'M-PRICE', pricePerMonth: null, trial: null },
      ],
    });
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
    expect(await loadOffering('winback')).toBeNull();
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
