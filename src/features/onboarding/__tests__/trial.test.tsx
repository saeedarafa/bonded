import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { BackHandler } from 'react-native';
import { INTRO_ELIGIBILITY_STATUS, PURCHASES_ERROR_CODE } from 'react-native-purchases';

import { usePendingInvite } from '@/features/auth/pendingInvite';
import { createPendingPurchaseStore, usePendingPurchase } from '@/features/premium/pendingPurchase';
import { trialReminderDay, zeroPrice } from '@/features/premium/pricing';
import { resetPurchasesForTests, type Plan } from '@/features/premium/purchases';
import { expectOnlyAllowedKeys, recordAnalytics } from '@/test/analytics';
import { memoryStorage } from '@/test/memoryStorage';
import { fakeOfferings, purchasesMock } from '@/test/purchases';
import { renderUi } from '@/test/render';
import { useToast } from '@/ui';

import { nextStep } from '../flow';
import { TrialPaywallScreen } from '../screens/TrialPaywallScreen';
import { useOnboarding } from '../store';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
let mockStatus: 'signedIn' | 'signedOut' = 'signedOut';
jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ status: mockStatus, userId: mockStatus === 'signedIn' ? 'u1' : null }),
}));
const mockEntitlements = jest.fn(() => Promise.resolve([]));
const mockGetOffer = jest.fn();
jest.mock('@/features/premium/api', () => ({
  getEntitlements: () => mockEntitlements(),
  getOffer: () => mockGetOffer(),
  syncRevenueCat: jest.fn(() => Promise.resolve('ok')),
}));

const ELIGIBLE = {
  product$rc_annual: { status: INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE },
};

let qc: QueryClient;
async function renderP3() {
  return renderUi(
    <QueryClientProvider client={qc}>
      <TrialPaywallScreen />
    </QueryClientProvider>,
  );
}

const consoleSpies: jest.SpyInstance[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  resetPurchasesForTests();
  mockStatus = 'signedOut';
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = 'appl_test';
  purchasesMock.getOfferings.mockResolvedValue(fakeOfferings());
  purchasesMock.logIn.mockResolvedValue({ customerInfo: {}, created: false });
  purchasesMock.purchasePackage.mockReset();
  purchasesMock.restorePurchases.mockResolvedValue({ entitlements: { active: {} } });
  purchasesMock.checkTrialOrIntroductoryPriceEligibility.mockResolvedValue(ELIGIBLE);
  usePendingPurchase.getState().clear();
  usePendingInvite.getState().clear();
  useToast.getState().hide();
  const s = useOnboarding.getState();
  s.reset();
  s.setNames({ displayName: 'Maya', partnerName: 'Sam' });
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const m of ['log', 'warn', 'error', 'info'] as const) {
    consoleSpies.push(jest.spyOn(console, m).mockImplementation(() => {}));
  }
});

// No purchase, receipt or price data may reach the console.
const PURCHASE_DATA = /PRICE|receipt|premium|\$rc_|appl_test|u1/i;
afterEach(() => {
  // P3 never starts an offer clock (D52) and never shows 16.
  expect(mockGetOffer).not.toHaveBeenCalled();
  expect(mockRouter.push).not.toHaveBeenCalledWith('/paywall');
  for (const spy of consoleSpies.splice(0)) {
    const logged = spy.mock.calls.flat().map(String).join('\n');
    expect(logged).not.toMatch(PURCHASE_DATA);
    spy.mockRestore();
  }
  qc.clear();
});

afterAll(() => {
  delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
});

/** Every string rendered on screen (hidden badge text included), joined. */
function allText(): string {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'string') out.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') walk((node as { children?: unknown }).children);
  };
  walk(screen.toJSON());
  return out.join('\n');
}

describe('P3 soft trial paywall (D50, MOB-62)', () => {
  it('flow: P2 → P3 → sign-in; a joiner holding an invite skips P3', () => {
    expect(nextStep('/plan/yours')).toBe('/plan/trial');
    expect(nextStep('/plan/trial')).toBe('/sign-in');
    expect(nextStep('/plan/yours', { joining: true })).toBe('/sign-in');
  });

  it('yearly pre-selected: save %, per person a month and the yearly total, all from the offering', async () => {
    await renderP3();
    const yearly = await screen.findByTestId('P3-plan-yearly');
    expect(yearly.props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId('P3-plan-monthly').props.accessibilityState).toMatchObject({
      checked: false,
    });
    expect(await screen.findByText('Get closer to Sam, starting tonight')).toBeTruthy();
    expect(screen.getByText('Sam is included at no extra cost')).toBeTruthy();
    // 60 ÷ 12 ÷ 2 in the store currency; the store's own yearly price string.
    expect(screen.getByText(/^XTS\s?2\.50$/)).toBeTruthy();
    expect(screen.getByText('per person / month')).toBeTruthy();
    expect(screen.getByText('Y-PRICE a year for both')).toBeTruthy();
    expect(screen.getByText('Best value · save 50%', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText('M-PRICE')).toBeTruthy();
    expect(await screen.findByText('No free trial')).toBeTruthy();
    // Timeline: Today / Day 5 / Day 7 for the store's 7-day trial.
    expect(screen.getByTestId('P3-timeline-today')).toBeTruthy();
    expect(screen.getByTestId('P3-timeline-reminder').props.accessibilityLabel).toBe(
      'Day 5. We remind you with a notification',
    );
    // PO 2026-11-11 (D50, MOB-68): a reminder only, no email until there is an email provider.
    expect(screen.getByTestId('P3-timeline').props.accessibilityLabel).not.toMatch(/email/i);
    expect(screen.queryByText(/email/i)).toBeNull();
    expect(screen.getByTestId('P3-timeline-end').props.accessibilityLabel).toBe(
      'Day 7. Your plan starts. Cancel before in 2 taps',
    );
    expect(screen.getByText('Try 7 days free')).toBeTruthy();
    expect(screen.getByTestId('P3-billing')).toHaveTextContent(
      /^XTS\s?0\.00 today\. Cancel anytime in 2 taps\.$/,
    );
    expect(screen.getByTestId('P3-restore')).toBeTruthy();
    // No ratings, reviews or user counts.
    expect(allText()).not.toMatch(/★|rating|review|users|couples use/i);
  });

  it('no hard-coded price: another currency and other amounts show no "$" anywhere', async () => {
    purchasesMock.getOfferings.mockResolvedValue({
      current: null,
      all: {
        default: {
          ...fakeOfferings({ extra: false, monthlyAmount: 8, yearlyAmount: 48 }).all.default,
          availablePackages: fakeOfferings({
            extra: false,
            monthlyAmount: 8,
            yearlyAmount: 48,
          }).all.default.availablePackages.map((p) => ({
            ...p,
            product: { ...p.product, currencyCode: 'EUR' },
          })),
        },
      },
    });
    await renderP3();
    await screen.findByText('Try 7 days free');
    const text = allText();
    expect(text).not.toContain('$');
    // 1 − 48 ÷ 96 = 50%; 48 ÷ 24 = 2 a person a month; zero in euros.
    expect(text).toMatch(/2[.,]00/);
    expect(text).toMatch(/0[.,]00/);
    expect(text).toContain('€');
  });

  it('not trial-eligible (iOS says no): no trial copy, "Get Premium for both", monthly is "Flexible"', async () => {
    purchasesMock.checkTrialOrIntroductoryPriceEligibility.mockResolvedValue({});
    await renderP3();
    expect(await screen.findByTestId('P3-plan-yearly')).toBeTruthy();
    await waitFor(() =>
      expect(purchasesMock.checkTrialOrIntroductoryPriceEligibility).toHaveBeenCalled(),
    );
    expect(screen.queryByTestId('P3-timeline')).toBeNull();
    expect(screen.queryByText(/days free/)).toBeNull();
    expect(screen.getByText('Get Premium for both')).toBeTruthy();
    expect(screen.getByText('Flexible, cancel anytime')).toBeTruthy();
    expect(screen.getByTestId('P3-billing')).toHaveTextContent('Billed yearly. Cancel anytime.');
  });

  it('monthly picked: no timeline, no trial button', async () => {
    await renderP3();
    await screen.findByText('Try 7 days free');
    await fireEvent.press(screen.getByTestId('P3-plan-monthly'));
    expect(screen.queryByTestId('P3-timeline')).toBeNull();
    expect(screen.getByText('Get Premium for both')).toBeTruthy();
    expect(screen.getByTestId('P3-billing')).toHaveTextContent('Billed monthly. Cancel anytime.');
  });

  it('× → 17 → "Continue with free" → sign-in on the free plan', async () => {
    await renderP3();
    await screen.findByText('Try 7 days free');
    await fireEvent.press(screen.getByTestId('P3-close'));
    expect(screen.getByTestId('17-sheet')).toBeTruthy();
    expect(screen.getByText('Try Premium free for 7 days')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('17-leave'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/sign-in');
    expect(purchasesMock.purchasePackage).not.toHaveBeenCalled();
  });

  it('17 opens once: back on P3, × goes straight to sign-in', async () => {
    purchasesMock.checkTrialOrIntroductoryPriceEligibility.mockResolvedValue({});
    await renderP3();
    await screen.findByTestId('P3-plan-yearly');
    await fireEvent.press(screen.getByTestId('P3-close'));
    // Not eligible: 17's main button is "Get Premium", back to P3's plans.
    await fireEvent.press(screen.getByText('Get Premium'));
    expect(mockRouter.replace).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('P3-close'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/sign-in');
  });

  it('Android back opens 17 like the ×', async () => {
    const spy = jest.spyOn(BackHandler, 'addEventListener');
    await renderP3();
    await screen.findByText('Try 7 days free');
    const handler = spy.mock.calls.at(-1)![1] as () => boolean;
    let handled = false;
    await waitFor(() => {
      handled = handler();
    });
    expect(handled).toBe(true);
    expect(await screen.findByTestId('17-sheet')).toBeTruthy();
    spy.mockRestore();
  });

  it('buys signed out under the anonymous id, marks it for sign-in, then goes to sign-in', async () => {
    purchasesMock.purchasePackage.mockResolvedValue({
      customerInfo: { entitlements: { active: { premium: {} } } },
    });
    await renderP3();
    await fireEvent.press(await screen.findByText('Try 7 days free'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/sign-in'));
    expect(purchasesMock.purchasePackage).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: '$rc_annual' }),
    );
    // No logIn before sign-in; the purchase waits for logIn(uid) + revenuecat-sync.
    expect(purchasesMock.logIn).not.toHaveBeenCalled();
    expect(usePendingPurchase.getState().pending).toBe(true);
    // Premium is never taken from the SDK: no entitlement read before sign-in.
    expect(mockEntitlements).not.toHaveBeenCalled();
    expect(useToast.getState().toast?.message).toBe(
      "You're in. Sign in so Premium stays with your account.",
    );
  });

  it('17 "Try Premium free for 7 days" buys the yearly trial too', async () => {
    purchasesMock.purchasePackage.mockResolvedValue({
      customerInfo: { entitlements: { active: {} } },
    });
    await renderP3();
    await fireEvent.press(await screen.findByTestId('P3-plan-monthly'));
    await fireEvent.press(screen.getByTestId('P3-close'));
    await fireEvent.press(screen.getByTestId('17-main'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/sign-in'));
    expect(purchasesMock.purchasePackage).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: '$rc_annual' }),
    );
  });

  it('a cancelled purchase stays on P3 and marks nothing', async () => {
    purchasesMock.purchasePackage.mockRejectedValue({
      code: PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR,
      userCancelled: true,
    });
    await renderP3();
    await fireEvent.press(await screen.findByText('Try 7 days free'));
    await waitFor(() => expect(purchasesMock.purchasePackage).toHaveBeenCalled());
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(usePendingPurchase.getState().pending).toBe(false);
  });

  it('a refused payment opens 57', async () => {
    purchasesMock.purchasePackage.mockRejectedValue({
      code: PURCHASES_ERROR_CODE.STORE_PROBLEM_ERROR,
    });
    await renderP3();
    await fireEvent.press(await screen.findByText('Try 7 days free'));
    expect(await screen.findByTestId('57-sheet')).toBeTruthy();
    expect(usePendingPurchase.getState().pending).toBe(false);
  });

  it('Restore signed out: a found purchase is marked and moves on; nothing found says so', async () => {
    await renderP3();
    await screen.findByText('Try 7 days free');
    await fireEvent.press(screen.getByTestId('P3-restore'));
    await waitFor(() =>
      expect(useToast.getState().toast?.message).toBe(
        'No purchases to restore on this store account.',
      ),
    );
    expect(mockRouter.replace).not.toHaveBeenCalled();

    purchasesMock.restorePurchases.mockResolvedValue({
      entitlements: { active: { premium: {} } },
    });
    await fireEvent.press(screen.getByTestId('P3-restore'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/sign-in'));
    expect(usePendingPurchase.getState().pending).toBe(true);
    expect(purchasesMock.logIn).not.toHaveBeenCalled();
  });

  it('a signed-in new account (D40) buys as itself and goes to `/` (the setup)', async () => {
    mockStatus = 'signedIn';
    purchasesMock.purchasePackage.mockResolvedValue({
      customerInfo: { entitlements: { active: {} } },
    });
    await renderP3();
    await fireEvent.press(await screen.findByText('Try 7 days free'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/'));
    expect(purchasesMock.logIn).toHaveBeenCalledWith('u1');
    expect(usePendingPurchase.getState().pending).toBe(false);
  });

  it('a joiner never sees P3: straight to sign-in, no offering loaded', async () => {
    usePendingInvite.getState().set({ code: '4827', token: 'tok_tok_tok_tok_tok' });
    await renderP3();
    expect(mockRouter.replace).toHaveBeenCalledWith('/sign-in');
    expect(screen.queryByTestId('P3-screen')).toBeNull();
  });

  it('no RevenueCat key: nothing to sell, P3 steps aside to sign-in', async () => {
    delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
    await renderP3();
    expect(mockRouter.replace).toHaveBeenCalledWith('/sign-in');
    expect(purchasesMock.getOfferings).not.toHaveBeenCalled();
  });

  it('offering error: retry, and "Continue with free" without 17', async () => {
    purchasesMock.getOfferings.mockRejectedValue({ code: PURCHASES_ERROR_CODE.NETWORK_ERROR });
    await renderP3();
    // The offering query retries once (useOffering) before it shows the error.
    expect(await screen.findByTestId('P3-error', {}, { timeout: 5000 })).toBeTruthy();
    await fireEvent.press(screen.getByTestId('P3-close'));
    expect(screen.queryByTestId('17-sheet')).toBeNull();
    expect(mockRouter.replace).toHaveBeenCalledWith('/sign-in');
  });
});

describe('P3 analytics (MOB-24c, ANALYTICS §3.9)', () => {
  let rec: ReturnType<typeof recordAnalytics>;
  beforeEach(() => {
    rec = recordAnalytics();
  });
  afterEach(() => {
    expectOnlyAllowedKeys(rec.captured);
    expect(JSON.stringify(rec.captured)).not.toMatch(/\$|PRICE|rc_|Maya|Sam/);
    rec.stop();
  });

  it('viewed once (onboarding, trial eligibility), then a trial bought before sign-in', async () => {
    purchasesMock.purchasePackage.mockResolvedValue({
      customerInfo: { entitlements: { active: { premium: {} } } },
    });
    await renderP3();
    await fireEvent.press(await screen.findByText('Try 7 days free'));
    await waitFor(() => expect(rec.of('purchase_completed')).toHaveLength(1));
    expect(rec.of('paywall_viewed')).toEqual([
      { paywall: 'P3', trigger: 'onboarding', offering: 'default', trial_eligible: true },
    ]);
    expect(rec.of('purchase_started')).toEqual([
      { paywall: 'P3', product: 'yearly_trial', offering: 'default' },
    ]);
    expect(rec.of('purchase_completed')).toEqual([
      { paywall: 'P3', product: 'yearly_trial', is_trial: true, before_sign_in: true },
    ]);
  });

  it('× → 17 → "Continue with free": closed, exit sheet, continued free (17)', async () => {
    await renderP3();
    await fireEvent.press(await screen.findByTestId('P3-plan-monthly'));
    await fireEvent.press(screen.getByTestId('P3-close'));
    await fireEvent.press(screen.getByTestId('17-leave'));
    expect(rec.of('paywall_plan_selected')).toEqual([{ paywall: 'P3', product: 'monthly' }]);
    expect(rec.of('paywall_closed')).toEqual([{ paywall: 'P3' }]);
    expect(rec.of('exit_sheet_viewed')).toEqual([{}]);
    expect(rec.of('continued_free')).toEqual([{ paywall: '17' }]);
  });
});

describe('P3 helpers', () => {
  const plan = (currencyCode: string | null) =>
    ({ id: 'y', kind: 'yearly', currencyCode }) as unknown as Plan;

  it('zero in the store currency, or null', () => {
    expect(zeroPrice(plan('XTS'))).toMatch(/^XTS\s?0\.00$/);
    expect(zeroPrice(plan(null))).toBeNull();
    expect(zeroPrice(undefined)).toBeNull();
  });

  it('the reminder day matches the server (start + 4 days, or 2 days before the end)', () => {
    expect(trialReminderDay(7)).toBe(5);
    expect(trialReminderDay(14)).toBe(5);
    expect(trialReminderDay(3)).toBe(2);
    expect(trialReminderDay(2)).toBeNull();
  });

  it('a P3 purchase survives an app restart until it is synced', () => {
    const disk = memoryStorage();
    createPendingPurchaseStore(disk).getState().mark();
    const after = createPendingPurchaseStore(disk);
    expect(after.getState().pending).toBe(true);
    after.getState().clear();
    expect(createPendingPurchaseStore(disk).getState().pending).toBe(false);
  });
});
