import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { BackHandler, StyleSheet } from 'react-native';
import { INTRO_ELIGIBILITY_STATUS, PURCHASES_ERROR_CODE } from 'react-native-purchases';

import JoinDoneScreen from '@/features/pairing/screens/JoinDoneScreen';
import { confirmTiming } from '@/features/premium/hooks';
import { resetPurchasesForTests } from '@/features/premium/purchases';
import PaywallScreen from '@/features/premium/screens/PaywallScreen';
import PremiumSuccessScreen from '@/features/premium/screens/PremiumSuccessScreen';
import { expectOnlyAllowedKeys, recordAnalytics } from '@/test/analytics';
import { fakeOfferings, purchasesMock } from '@/test/purchases';
import { renderUi } from '@/test/render';
import { useToast } from '@/ui';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/features/auth/session', () => ({ useSession: () => ({ userId: 'u1' }) }));
jest.mock('@/features/couple/api', () => ({
  getActiveCouple: () =>
    Promise.resolve({
      id: 'couple-1',
      couple_members: [
        { user_id: 'u1', left_at: null },
        { user_id: 'u2', left_at: null },
      ],
    }),
}));
jest.mock('@/features/profile/api', () => ({
  getCoupleProfiles: () =>
    Promise.resolve([
      { id: 'u1', display_name: 'Maya', avatar_url: null },
      { id: 'u2', display_name: 'Sam', avatar_url: null },
    ]),
}));
type Row = { user_id: string; is_active: boolean; expires_at: string | null };
const mockEntitlements = jest.fn<Promise<Row[]>, []>();
const mockGetOffer = jest.fn(() => Promise.resolve({ eligible: false, expiresAt: null }));
jest.mock('@/features/premium/api', () => ({
  getEntitlements: () => mockEntitlements(),
  getOffer: () => mockGetOffer(),
  getOfferClocks: () => Promise.resolve([]),
}));

const MINE: Row = { user_id: 'u1', is_active: true, expires_at: null };
const PARTNERS: Row = { user_id: 'u2', is_active: true, expires_at: null };

let qc: QueryClient;
function renderScreen(ui: ReactElement) {
  return renderUi(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const consoleSpies: jest.SpyInstance[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  resetPurchasesForTests();
  mockParams = {};
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = 'appl_test';
  purchasesMock.getOfferings.mockResolvedValue(fakeOfferings());
  purchasesMock.logIn.mockResolvedValue({ customerInfo: {}, created: false });
  purchasesMock.purchasePackage.mockReset();
  purchasesMock.restorePurchases.mockResolvedValue({ entitlements: { active: {} } });
  purchasesMock.checkTrialOrIntroductoryPriceEligibility.mockResolvedValue({});
  mockEntitlements.mockReset();
  mockEntitlements.mockResolvedValue([]);
  confirmTiming.attempts = 3;
  confirmTiming.intervalMs = 5;
  useToast.getState().hide();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // No purchase, receipt or price data may reach the console (or anything else).
  for (const m of ['log', 'warn', 'error', 'info'] as const) {
    consoleSpies.push(jest.spyOn(console, m).mockImplementation(() => {}));
  }
});

// React's own act() warnings may appear; purchase data never may.
const PURCHASE_DATA = /PRICE|receipt|premium|\$rc_|appl_test|u1/i;
afterEach(() => {
  // No paywall state (16, 34, purchase, restore, errors) ever starts an offer clock (D28).
  expect(mockGetOffer).not.toHaveBeenCalled();
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

describe('16 Paywall (D52)', () => {
  it('without a RevenueCat key: "Not available right now", no SDK call, no crash', async () => {
    delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
    await renderScreen(<PaywallScreen />);
    expect(await screen.findByTestId('16-unavailable')).toBeTruthy();
    expect(screen.getByText('Not available right now')).toBeTruthy();
    expect(purchasesMock.configure).not.toHaveBeenCalled();
    expect(purchasesMock.getOfferings).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('16-back'));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('D55 (MOB-71): from a locked History day, headed "Unlock all your history with Premium"', async () => {
    mockParams = { from: 'history' };
    await renderScreen(<PaywallScreen />);
    expect(await screen.findByTestId('16-plan-yearly')).toBeTruthy();
    expect(screen.getByTestId('16-title')).toHaveTextContent(
      'Unlock all your history with Premium',
    );
    expect(screen.queryByText('Get closer to Sam, starting tonight')).toBeNull();
    // Still 16 (benefits, × opens 17), not the pack paywall.
    expect(screen.getByTestId('16-benefits')).toBeTruthy();
    expect(screen.queryByTestId('34-screen')).toBeNull();
  });

  it('an empty offering is also "Not available right now"', async () => {
    purchasesMock.getOfferings.mockResolvedValue({ current: null, all: {} });
    await renderScreen(<PaywallScreen />);
    expect(await screen.findByTestId('16-unavailable')).toBeTruthy();
  });

  it('D52: the P3 layout without a trial; every price from the offering', async () => {
    await renderScreen(<PaywallScreen />);
    expect(await screen.findByTestId('16-plan-yearly')).toBeTruthy();
    expect(await screen.findByText('Get closer to Sam, starting tonight')).toBeTruthy();
    // Three benefits, naming only shipped features (D27).
    expect(
      screen.getByText('Questions made with relationship psychology, picked for you two'),
    ).toBeTruthy();
    expect(screen.getByText('All question packs')).toBeTruthy();
    expect(screen.getByText('Sam is included at no extra cost')).toBeTruthy();
    expect(screen.queryByText(/voice|longer answers/i)).toBeNull();
    // Yearly: per person a month = 60 ÷ 12 ÷ 2 in the store currency; the store's yearly price.
    expect(screen.getByText(/^XTS\s?2\.50$/)).toBeTruthy();
    expect(screen.getByText('per person / month')).toBeTruthy();
    expect(screen.getByText('Y-PRICE a year for both')).toBeTruthy();
    expect(screen.getByText('Best value · save 50%', { includeHiddenElements: true })).toBeTruthy();
    // Monthly.
    expect(screen.getByText('M-PRICE')).toBeTruthy();
    expect(screen.getByText('per month')).toBeTruthy();
    expect(screen.getByText('Flexible, cancel anytime')).toBeTruthy();
    expect(screen.getByText('Sam included')).toBeTruthy();
    expect(screen.getByText('Cancel anytime in 2 taps')).toBeTruthy();
    expect(screen.getByTestId('16-buy')).toBeTruthy();
    expect(screen.getByText('Get Premium for both')).toBeTruthy();
    expect(screen.getByText('Billed yearly. Cancel anytime.')).toBeTruthy();
    // No trial anywhere on 16, although the store's yearly plan has one (BIZ-16).
    expect(screen.queryByText(/trial|days? free|no charge|\$0/i)).toBeNull();
    expect(screen.queryByTestId('16-steps')).toBeNull();
    // × top-left, the pair, Restore; yearly selected first.
    expect(screen.getByLabelText('Close, continue with the free plan')).toBeTruthy();
    expect(screen.getByTestId('16-restore')).toBeTruthy();
    expect(screen.getByTestId('16-plan-yearly').props.accessibilityState).toEqual({
      checked: true,
    });
    // Only `default` is ever loaded (the retired `intro` / `winback` are never shown).
    expect(screen.queryByText(/I-PRICE|W-PRICE/)).toBeNull();
  });

  it('no price literal: other store prices, other numbers on screen', async () => {
    purchasesMock.getOfferings.mockResolvedValue(
      fakeOfferings({ monthlyAmount: 20, yearlyAmount: 180 }),
    );
    await renderScreen(<PaywallScreen />);
    // 1 − 180 ÷ 240 = 25%; 180 ÷ 24 = 7.50.
    expect(
      await screen.findByText('Best value · save 25%', { includeHiddenElements: true }),
    ).toBeTruthy();
    expect(screen.getByText(/^XTS\s?7\.50$/)).toBeTruthy();
    expect(screen.queryByText(/50%|2\.50/)).toBeNull();
  });

  it('the store gives no amounts: the yearly price itself, no save claim', async () => {
    purchasesMock.getOfferings.mockResolvedValue(
      fakeOfferings({ monthlyAmount: 0, yearlyAmount: 0 }),
    );
    await renderScreen(<PaywallScreen />);
    expect(await screen.findByText('Y-PRICE')).toBeTruthy();
    expect(screen.getByText('per year')).toBeTruthy();
    expect(screen.getByText('Best value', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByText(/save|per person/i, { includeHiddenElements: true })).toBeNull();
  });

  it('monthly selected: the same button, billed monthly', async () => {
    await renderScreen(<PaywallScreen />);
    await fireEvent.press(await screen.findByTestId('16-plan-monthly'));
    expect(screen.getByText('Get Premium for both')).toBeTruthy();
    expect(screen.getByText('Billed monthly. Cancel anytime.')).toBeTruthy();
  });

  it('an offering error shows a retry', async () => {
    purchasesMock.getOfferings.mockRejectedValue({ code: PURCHASES_ERROR_CODE.NETWORK_ERROR });
    await renderScreen(<PaywallScreen />);
    expect(await screen.findByTestId('16-error', {}, { timeout: 4000 })).toBeTruthy();
    purchasesMock.getOfferings.mockResolvedValue(fakeOfferings());
    await fireEvent.press(screen.getByTestId('16-retry'));
    expect(await screen.findByTestId('16-plan-yearly')).toBeTruthy();
  });

  it('purchase success: waits for the server entitlement, then 35', async () => {
    purchasesMock.purchasePackage.mockResolvedValue({
      customerInfo: { entitlements: { active: { premium: {} } } },
    });
    // The webhook lands a moment later: free until the purchase, the first poll after it still
    // free, then premium. Scripted *before* the press: the confirm poll runs on real timers, so
    // setting it after the press let a slow runner spend every attempt on the old `[]` (CI flake).
    let polls = 0;
    mockEntitlements.mockImplementation(() => {
      if (purchasesMock.purchasePackage.mock.calls.length === 0) return Promise.resolve([]);
      polls += 1;
      return Promise.resolve(polls === 1 ? [] : [MINE]);
    });
    await renderScreen(<PaywallScreen />);
    await fireEvent.press(await screen.findByTestId('16-buy'));
    await waitFor(() =>
      expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/success', params: {} }),
    );
    expect(polls).toBeGreaterThanOrEqual(2);
    expect(purchasesMock.logIn).toHaveBeenCalledWith('u1');
    expect(purchasesMock.purchasePackage.mock.calls[0]?.[0].identifier).toBe('$rc_annual');
  });

  it('the SDK hint alone never makes premium: a slow server shows "Check again"', async () => {
    purchasesMock.purchasePackage.mockResolvedValue({
      customerInfo: { entitlements: { active: { premium: {} } } },
    });
    await renderScreen(<PaywallScreen />);
    await fireEvent.press(await screen.findByTestId('16-buy'));
    expect(await screen.findByTestId('16-notice-confirming')).toBeTruthy();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    mockEntitlements.mockResolvedValue([MINE]);
    await fireEvent.press(screen.getByTestId('16-check-again'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
  });

  it('cancel: nothing changes', async () => {
    purchasesMock.purchasePackage.mockRejectedValue({
      code: PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR,
      userCancelled: true,
    });
    await renderScreen(<PaywallScreen />);
    await waitFor(() => expect(mockEntitlements).toHaveBeenCalledTimes(1));
    await fireEvent.press(await screen.findByTestId('16-buy'));
    await waitFor(() => expect(purchasesMock.purchasePackage).toHaveBeenCalled());
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(screen.queryByTestId('57-sheet')).toBeNull();
    expect(screen.queryByTestId(/16-notice/)).toBeNull();
    expect(mockEntitlements).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('16-plan-yearly')).toBeTruthy();
  });

  it('payment refused: 57 "Nothing was charged", Try again buys again', async () => {
    purchasesMock.purchasePackage.mockRejectedValue({
      code: PURCHASES_ERROR_CODE.STORE_PROBLEM_ERROR,
    });
    await renderScreen(<PaywallScreen />);
    await fireEvent.press(await screen.findByTestId('16-buy'));
    expect(await screen.findByTestId('57-sheet')).toBeTruthy();
    expect(screen.getByText("Payment didn't go through")).toBeTruthy();
    expect(screen.getByText(/Nothing was charged/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('57-retry'));
    await waitFor(() => expect(purchasesMock.purchasePackage).toHaveBeenCalledTimes(2));
  });

  it('network and already purchased show inline notices', async () => {
    purchasesMock.purchasePackage.mockRejectedValueOnce({
      code: PURCHASES_ERROR_CODE.NETWORK_ERROR,
    });
    await renderScreen(<PaywallScreen />);
    await fireEvent.press(await screen.findByTestId('16-buy'));
    expect(await screen.findByTestId('16-notice-network')).toBeTruthy();

    purchasesMock.purchasePackage.mockRejectedValueOnce({
      code: PURCHASES_ERROR_CODE.PRODUCT_ALREADY_PURCHASED_ERROR,
    });
    await fireEvent.press(screen.getByTestId('16-buy'));
    expect(await screen.findByTestId('16-notice-alreadyOwned')).toBeTruthy();
    purchasesMock.restorePurchases.mockResolvedValue({
      entitlements: { active: { premium: {} } },
    });
    mockEntitlements.mockResolvedValue([MINE]);
    await fireEvent.press(screen.getByTestId('16-notice-restore'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
  });

  it('restore: server confirms -> 35', async () => {
    purchasesMock.restorePurchases.mockResolvedValue({
      entitlements: { active: { premium: {} } },
    });
    await renderScreen(<PaywallScreen />);
    mockEntitlements.mockResolvedValue([MINE]);
    await fireEvent.press(await screen.findByTestId('16-restore'));
    await waitFor(() =>
      expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/success', params: {} }),
    );
    expect(purchasesMock.restorePurchases).toHaveBeenCalledTimes(1);
  });

  it('restore with nothing to restore: a toast, no navigation', async () => {
    await renderScreen(<PaywallScreen />);
    await fireEvent.press(await screen.findByTestId('16-restore'));
    await waitFor(() =>
      expect(useToast.getState().toast?.message).toBe(
        'No purchases to restore on this store account.',
      ),
    );
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('× opens 17: shipped rows only, the D51 subtitle; not trial-eligible -> "Get Premium"', async () => {
    await renderScreen(<PaywallScreen />);
    await screen.findByTestId('16-plan-yearly');
    await fireEvent.press(screen.getByTestId('16-close'));
    expect(await screen.findByTestId('17-sheet')).toBeTruthy();
    expect(screen.getByText('Keep it free for now?')).toBeTruthy();
    expect(
      screen.getByText(
        'You’ll always get one new question a day together. Premium adds everything below.',
      ),
    ).toBeTruthy();
    for (const row of ['daily', 'packs', 'streakSaver', 'weeklyRecap']) {
      expect(screen.getByTestId(`17-row-${row}`)).toBeTruthy();
    }
    // Not in this build (D27): absent, not greyed.
    // D55 (MOB-71): "History: Last 2 days / Everything" only behind `SHIPPED.premiumHistory`.
    for (const row of ['voice', 'longAnswers', 'littleThings', 'premiumHistory']) {
      expect(screen.queryByTestId(`17-row-${row}`)).toBeNull();
    }
    expect(screen.queryByText('Last 2 days')).toBeNull();
    expect(screen.queryByText(/Couple report|Voice|Longer answers|Hugs/)).toBeNull();
    expect(screen.getByLabelText('Question packs: free No, Premium All')).toBeTruthy();
    // RevenueCat did not say ELIGIBLE: no trial copy.
    await waitFor(() =>
      expect(purchasesMock.checkTrialOrIntroductoryPriceEligibility).toHaveBeenCalled(),
    );
    expect(screen.getByTestId('17-main')).toBeTruthy();
    expect(screen.getByText('Get Premium')).toBeTruthy();
    expect(screen.queryByText(/free for \d|trial/i)).toBeNull();
    // "Get Premium" goes back to 16's plans; it buys nothing by itself.
    await fireEvent.press(screen.getByTestId('17-main'));
    await waitFor(() => expect(screen.queryByTestId('17-sheet')).toBeNull());
    expect(purchasesMock.purchasePackage).not.toHaveBeenCalled();
    expect(screen.getByTestId('16-buy')).toBeTruthy();
    // Close again, then "Continue with free" leaves.
    await fireEvent.press(screen.getByTestId('16-close'));
    await fireEvent.press(await screen.findByTestId('17-leave'));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('17 for a trial-eligible person: "Try Premium free for 7 days" buys the yearly trial', async () => {
    purchasesMock.checkTrialOrIntroductoryPriceEligibility.mockResolvedValue({
      product$rc_annual: { status: INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE },
    });
    purchasesMock.purchasePackage.mockResolvedValue({ customerInfo: {} });
    mockEntitlements.mockImplementation(() =>
      Promise.resolve(purchasesMock.purchasePackage.mock.calls.length ? [MINE] : []),
    );
    await renderScreen(<PaywallScreen />);
    await screen.findByTestId('16-plan-yearly');
    // 16 itself never shows the trial, eligible or not.
    expect(screen.queryByText(/trial|free for/i)).toBeNull();
    await fireEvent.press(screen.getByTestId('16-close'));
    expect(await screen.findByText('Try Premium free for 7 days')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('17-main'));
    await waitFor(() =>
      expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/success', params: {} }),
    );
    expect(purchasesMock.purchasePackage.mock.calls[0]?.[0].identifier).toBe('$rc_annual');
  });

  it('17 trial length follows the store (14 days), never a fixed 7', async () => {
    purchasesMock.getOfferings.mockResolvedValue(fakeOfferings({ trialDays: 14 }));
    purchasesMock.checkTrialOrIntroductoryPriceEligibility.mockResolvedValue({
      product$rc_annual: { status: INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE },
    });
    await renderScreen(<PaywallScreen />);
    await screen.findByTestId('16-plan-yearly');
    await fireEvent.press(screen.getByTestId('16-close'));
    expect(await screen.findByText('Try Premium free for 14 days')).toBeTruthy();
  });

  it('17 with no trial on the product: "Get Premium", eligibility never asked', async () => {
    purchasesMock.getOfferings.mockResolvedValue(fakeOfferings({ trialDays: null }));
    await renderScreen(<PaywallScreen />);
    await screen.findByTestId('16-plan-yearly');
    await fireEvent.press(screen.getByTestId('16-close'));
    expect(await screen.findByText('Get Premium')).toBeTruthy();
    // The trial is never asked about (only the D57 exit offer's own product may be).
    const asked = purchasesMock.checkTrialOrIntroductoryPriceEligibility.mock.calls.flat(2);
    expect(asked.filter((id) => id !== 'yearly_exit30')).toEqual([]);
  });

  it('Android back on 16 opens 17 (once), like ×', async () => {
    const listeners: (() => boolean)[] = [];
    const spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_e, handler) => {
      listeners.push(handler as () => boolean);
      return { remove: () => listeners.splice(listeners.indexOf(handler as () => boolean), 1) };
    });
    await renderScreen(<PaywallScreen />);
    await screen.findByTestId('16-plan-yearly');
    await waitFor(() => expect(listeners).toHaveLength(1));
    let handled = false;
    await act(() => {
      handled = listeners[0]!();
    });
    expect(handled).toBe(true);
    expect(await screen.findByTestId('17-sheet')).toBeTruthy();
    // While 17 is open, back belongs to the sheet (it closes it), not to 16.
    expect(listeners).toHaveLength(0);
    expect(mockRouter.back).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("covered by the partner's plan: nothing to sell", async () => {
    mockEntitlements.mockResolvedValue([PARTNERS]);
    await renderScreen(<PaywallScreen />);
    expect(await screen.findByTestId('16-premium')).toBeTruthy();
    expect(screen.getByText("You're on Sam's plan. Nothing to pay.")).toBeTruthy();
    expect(screen.queryByTestId('16-buy')).toBeNull();
  });

  it('a former partner (unpaired, RLS-readable) does not cover me', async () => {
    mockEntitlements.mockResolvedValue([{ user_id: 'old', is_active: true, expires_at: null }]);
    await renderScreen(<PaywallScreen />);
    await waitFor(() => expect(qc.getQueryData(['entitlements'])).toHaveLength(1));
    await waitFor(() => expect(qc.getQueryData(['couple', 'active'])).toBeTruthy());
    expect(await screen.findByTestId('16-buy')).toBeTruthy();
    expect(screen.queryByTestId('16-premium')).toBeNull();
  });
});

describe('34 Paywall from a pack', () => {
  it('D53: 17 rows, "Save [X]%" from the store, "Get Premium for both", no trial', async () => {
    mockParams = { from: 'pack', pack: 'Future Us', packId: 'p-9' };
    purchasesMock.purchasePackage.mockResolvedValue({ customerInfo: {} });
    purchasesMock.checkTrialOrIntroductoryPriceEligibility.mockResolvedValue({
      product$rc_annual: { status: INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE },
    });
    mockEntitlements.mockResolvedValue([]);
    await renderScreen(<PaywallScreen />);
    expect(await screen.findByTestId('34-buy')).toBeTruthy();
    expect(screen.getByText('Unlock Future Us and every other pack')).toBeTruthy();
    expect(screen.getByTestId('34-compare')).toBeTruthy();
    for (const row of ['daily', 'packs', 'streakSaver', 'weeklyRecap']) {
      expect(screen.getByTestId(`34-row-${row}`)).toBeTruthy();
    }
    expect(screen.queryByTestId('34-row-voice')).toBeNull();
    expect(screen.queryByText(/Couple report/)).toBeNull();
    // Plan cards: the store's prices; save % computed from the store's numbers.
    expect(screen.getByTestId('34-plan-yearly')).toBeTruthy();
    expect(screen.getByTestId('34-plan-monthly')).toBeTruthy();
    expect(screen.getByText('Y-PRICE/yr')).toBeTruthy();
    expect(screen.getByText('Save 50%')).toBeTruthy();
    expect(screen.getByText('M-PRICE/mo')).toBeTruthy();
    expect(screen.getByText('Flexible')).toBeTruthy();
    expect(screen.getByText('Get Premium for both')).toBeTruthy();
    expect(screen.getByText('Covers you both. Cancel anytime in 2 taps.')).toBeTruthy();
    // No trial on 34, even for an eligible person; eligibility is not even asked.
    expect(screen.queryByText(/trial|days? free/i)).toBeNull();
    expect(purchasesMock.checkTrialOrIntroductoryPriceEligibility).not.toHaveBeenCalled();
    // Close goes straight back (no 17 on a pack paywall).
    await fireEvent.press(screen.getByTestId('34-close'));
    expect(mockRouter.back).toHaveBeenCalled();
    expect(screen.queryByTestId('17-sheet')).toBeNull();

    mockEntitlements.mockResolvedValue([MINE]);
    await fireEvent.press(screen.getByTestId('34-buy'));
    await waitFor(() =>
      expect(mockRouter.replace).toHaveBeenCalledWith({
        pathname: '/success',
        params: { pack: 'Future Us', packId: 'p-9' },
      }),
    );
  });

  it('without a key: the same safe state', async () => {
    delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
    mockParams = { from: 'pack' };
    await renderScreen(<PaywallScreen />);
    expect(await screen.findByTestId('34-unavailable')).toBeTruthy();
  });

  it('#366 AX5: the unavailable state scrolls, the title stops at 200%, Back is reachable', async () => {
    delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
    mockParams = { from: 'pack' };
    await renderScreen(<PaywallScreen />);
    const state = await screen.findByTestId('34-unavailable');
    // Inside a scroll view (centred while it fits, scrolls when taller than an iPhone SE).
    expect(state.parent?.parent?.type).toBe('RCTScrollView');
    const own = StyleSheet.flatten(state.props.style);
    expect(own.flex).toBeUndefined();
    expect(own.flexGrow).toBe(1);
    // Texts take the full width so no word runs past the right edge.
    expect(own.alignItems).toBe('stretch');
    const title = screen.getByRole('header', { name: 'Not available right now' });
    expect(title.props.maxFontSizeMultiplier).toBe(2);
    expect(title.props.numberOfLines).toBeUndefined();
    await fireEvent.press(screen.getByTestId('34-back'));
    expect(mockRouter.back).toHaveBeenCalled();
  });
});

describe('Analytics: money funnel (MOB-24c, ANALYTICS §3.9)', () => {
  let rec: ReturnType<typeof recordAnalytics>;
  beforeEach(() => {
    rec = recordAnalytics();
  });
  afterEach(() => {
    expectOnlyAllowedKeys(rec.captured);
    // Never a price, a product id or a person's name.
    expect(JSON.stringify(rec.captured)).not.toMatch(/\$|€|PRICE|rc_|Maya|Sam/);
    rec.stop();
  });

  it('16 from Settings: viewed once with its trigger, plan picked, purchase started and completed', async () => {
    mockParams = { from: 'settings' };
    purchasesMock.purchasePackage.mockResolvedValue({ customerInfo: {} });
    await renderScreen(<PaywallScreen />);
    await fireEvent.press(await screen.findByTestId('16-plan-monthly'));
    await fireEvent.press(screen.getByTestId('16-buy'));
    await waitFor(() => expect(rec.of('purchase_completed')).toHaveLength(1));
    expect(rec.of('paywall_viewed')).toEqual([
      { paywall: '16', trigger: 'settings', offering: 'default' },
    ]);
    expect(rec.of('paywall_plan_selected')).toEqual([{ paywall: '16', product: 'monthly' }]);
    expect(rec.of('purchase_started')).toEqual([
      { paywall: '16', product: 'monthly', offering: 'default' },
    ]);
    expect(rec.of('purchase_completed')).toEqual([
      { paywall: '16', product: 'monthly', is_trial: false, before_sign_in: false },
    ]);
    // `plan` on the person (only once identified; the recorder is anonymous here).
  });

  it('cancelled and refused purchases: the outcome and the failure kind, never a message', async () => {
    purchasesMock.purchasePackage.mockRejectedValueOnce({
      code: PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR,
      userCancelled: true,
    });
    purchasesMock.purchasePackage.mockRejectedValueOnce({
      code: PURCHASES_ERROR_CODE.STORE_PROBLEM_ERROR,
    });
    mockParams = { from: 'pack', pack: 'Deep talks', packId: 'p1' };
    await renderScreen(<PaywallScreen />);
    await fireEvent.press(await screen.findByTestId('34-buy'));
    await waitFor(() => expect(rec.of('purchase_cancelled')).toHaveLength(1));
    await fireEvent.press(screen.getByTestId('34-buy'));
    await waitFor(() => expect(rec.of('purchase_failed')).toHaveLength(1));
    expect(rec.of('paywall_viewed')).toEqual([
      { paywall: '34', trigger: 'pack', offering: 'default' },
    ]);
    expect(rec.of('purchase_cancelled')).toEqual([{ paywall: '34', product: 'yearly' }]);
    expect(rec.of('purchase_failed')).toEqual([
      { paywall: '34', product: 'yearly', error_code: 'payment' },
    ]);
    expect(JSON.stringify(rec.captured)).not.toMatch(/Deep talks|p1/);
  });

  it('× then "Continue with free": paywall_closed, exit_sheet_viewed, continued_free', async () => {
    mockParams = { from: 'streak_saver' };
    await renderScreen(<PaywallScreen />);
    await screen.findByTestId('16-plan-yearly');
    await fireEvent.press(screen.getByTestId('16-close'));
    await fireEvent.press(await screen.findByTestId('17-leave'));
    expect(rec.events()).toEqual([
      'paywall_viewed',
      'paywall_closed',
      'exit_sheet_viewed',
      'continued_free',
    ]);
    expect(rec.of('paywall_viewed')[0]).toMatchObject({ trigger: 'streak_saver' });
    expect(rec.of('paywall_closed')).toEqual([{ paywall: '16' }]);
    expect(rec.of('continued_free')).toEqual([{ paywall: '17' }]);
  });

  it('17 trial button: the purchase counts for 17 and as a trial', async () => {
    purchasesMock.checkTrialOrIntroductoryPriceEligibility.mockResolvedValue({
      product$rc_annual: { status: INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE },
    });
    purchasesMock.purchasePackage.mockResolvedValue({ customerInfo: {} });
    await renderScreen(<PaywallScreen />);
    await screen.findByTestId('16-plan-yearly');
    await fireEvent.press(screen.getByTestId('16-close'));
    await screen.findByText('Try Premium free for 7 days');
    await fireEvent.press(screen.getByTestId('17-main'));
    await waitFor(() => expect(rec.of('purchase_completed')).toHaveLength(1));
    expect(rec.of('purchase_started')).toEqual([
      { paywall: '17', product: 'yearly', offering: 'default' },
    ]);
    expect(rec.of('purchase_completed')).toEqual([
      { paywall: '17', product: 'yearly', is_trial: true, before_sign_in: false },
    ]);
  });

  it('16 from a locked History day (D55): trigger history (MOB-24d)', async () => {
    mockParams = { from: 'history' };
    await renderScreen(<PaywallScreen />);
    await screen.findByTestId('16-plan-yearly');
    await waitFor(() =>
      expect(rec.of('paywall_viewed')).toEqual([
        expect.objectContaining({ paywall: '16', trigger: 'history' }),
      ]),
    );
  });

  it('no trigger for an unknown source: no paywall_viewed rather than a wrong one', async () => {
    mockParams = { from: 'somewhere' };
    await renderScreen(<PaywallScreen />);
    await screen.findByTestId('16-plan-yearly');
    expect(rec.of('paywall_viewed')).toEqual([]);
  });

  it('already premium: no paywall_viewed', async () => {
    mockParams = { from: 'settings' };
    mockEntitlements.mockResolvedValue([PARTNERS]);
    await renderScreen(<PaywallScreen />);
    await screen.findByTestId('16-premium');
    expect(rec.of('paywall_viewed')).toEqual([]);
  });
});

describe('35 You are both Premium', () => {
  it('names the partner and opens the pack', async () => {
    mockParams = { pack: 'Future Us', packId: 'p-9' };
    await renderScreen(<PremiumSuccessScreen />);
    expect(
      await screen.findByText('We just told Sam. Every pack is open for the two of you.'),
    ).toBeTruthy();
    expect(screen.getByText("You're both Premium")).toBeTruthy();
    expect(screen.getByText('Premium')).toBeTruthy();
    // Only shipped features (D53, D27).
    expect(screen.getByText('All question packs unlocked')).toBeTruthy();
    expect(screen.getByText('Streak saver ready')).toBeTruthy();
    expect(screen.getByText('Full weekly recap')).toBeTruthy();
    expect(screen.queryByText(/Voice|Longer answers|hugs/i)).toBeNull();
    await fireEvent.press(screen.getByText('Start Future Us'));
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/packs/[packId]',
      params: { packId: 'p-9' },
    });
  });
});

describe("J8 on the partner's plan", () => {
  it('shows "Premium · on Sam\'s plan" when the partner covers me', async () => {
    mockEntitlements.mockResolvedValue([PARTNERS]);
    await renderScreen(<JoinDoneScreen />);
    expect(await screen.findByTestId('J8-partner-plan')).toBeTruthy();
    expect(screen.getByText("Premium · on Sam's plan")).toBeTruthy();
    expect(screen.getByText("Sam's subscription covers you too. Nothing to pay.")).toBeTruthy();
    expect(await screen.findByText("You're in, Maya!")).toBeTruthy();
  });

  it('no card when nobody is premium, or when the plan is my own', async () => {
    await renderScreen(<JoinDoneScreen />);
    await waitFor(() => expect(qc.getQueryData(['entitlements'])).toEqual([]));
    expect(screen.queryByTestId('J8-partner-plan')).toBeNull();
    screen.unmount();

    qc.clear();
    mockEntitlements.mockResolvedValue([MINE, PARTNERS]);
    await renderScreen(<JoinDoneScreen />);
    await waitFor(() => expect(qc.getQueryData(['entitlements'])).toHaveLength(2));
    expect(screen.queryByTestId('J8-partner-plan')).toBeNull();
  });
});
