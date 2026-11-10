import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { PURCHASES_ERROR_CODE } from 'react-native-purchases';

import JoinDoneScreen from '@/features/pairing/screens/JoinDoneScreen';
import { confirmTiming } from '@/features/premium/hooks';
import { resetPurchasesForTests } from '@/features/premium/purchases';
import PaywallScreen from '@/features/premium/screens/PaywallScreen';
import PremiumSuccessScreen from '@/features/premium/screens/PremiumSuccessScreen';
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

describe('16 Intro paywall', () => {
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

  it('an empty offering is also "Not available right now"', async () => {
    purchasesMock.getOfferings.mockResolvedValue({ current: null, all: {} });
    await renderScreen(<PaywallScreen />);
    expect(await screen.findByTestId('16-unavailable')).toBeTruthy();
  });

  it('plan cards show only the offering prices and its trial', async () => {
    await renderScreen(<PaywallScreen />);
    expect(await screen.findByTestId('16-plan-yearly')).toBeTruthy();
    expect(screen.getByText('Y-PRICE/year')).toBeTruthy();
    expect(screen.getByText('PM-PRICE/mo, billed yearly')).toBeTruthy();
    expect(screen.getByText('7 days free')).toBeTruthy();
    expect(screen.getByText('M-PRICE/month')).toBeTruthy();
    expect(screen.getByText('No trial')).toBeTruthy();
    expect(screen.getByText('Best value', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText('Start 7-day free trial')).toBeTruthy();
    expect(screen.getByText('Day 7')).toBeTruthy();
    expect(screen.getByText('No charge today')).toBeTruthy();
    expect(
      await screen.findByText('Sam gets Premium too, with no second subscription.'),
    ).toBeTruthy();
    expect(screen.getByText('Premium')).toBeTruthy();
    // Yearly is selected first.
    expect(screen.getByTestId('16-plan-yearly').props.accessibilityState).toEqual({
      checked: true,
    });
  });

  it('the trial length follows the store (14 days), never a fixed 7', async () => {
    purchasesMock.getOfferings.mockResolvedValue(fakeOfferings({ trialDays: 14 }));
    await renderScreen(<PaywallScreen />);
    expect(await screen.findByText('Start 14-day free trial')).toBeTruthy();
    expect(screen.getByText('14 days free')).toBeTruthy();
    expect(screen.getByText('Day 14')).toBeTruthy();
    expect(screen.queryByText(/7/)).toBeNull();
  });

  it('no intro offer: no trial copy, no steps, no "No charge today"', async () => {
    purchasesMock.getOfferings.mockResolvedValue(fakeOfferings({ trialDays: null }));
    await renderScreen(<PaywallScreen />);
    expect(await screen.findByText('Get Premium')).toBeTruthy();
    expect(screen.queryByTestId('16-steps')).toBeNull();
    expect(screen.queryByText(/free trial|days free|No charge today/)).toBeNull();
    expect(screen.getAllByText('No trial')).toHaveLength(2);
  });

  it('monthly selected: its CTA, no trial steps', async () => {
    await renderScreen(<PaywallScreen />);
    await fireEvent.press(await screen.findByTestId('16-plan-monthly'));
    expect(screen.getByText('Get Premium')).toBeTruthy();
    expect(screen.queryByTestId('16-steps')).toBeNull();
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

  it('close opens 17; "Continue with free" leaves, the gold button stays', async () => {
    await renderScreen(<PaywallScreen />);
    await screen.findByTestId('16-plan-yearly');
    await fireEvent.press(screen.getByTestId('16-close'));
    expect(await screen.findByTestId('17-sheet')).toBeTruthy();
    expect(screen.getByText('Keep it free for now?')).toBeTruthy();
    expect(screen.getByText('Try Premium free for 7 days')).toBeTruthy();
    expect(screen.queryByText(/Couple report/)).toBeNull();
    await fireEvent.press(screen.getByTestId('17-stay'));
    await waitFor(() => expect(screen.queryByTestId('17-sheet')).toBeNull());
    await fireEvent.press(screen.getByTestId('16-close'));
    await fireEvent.press(await screen.findByTestId('17-leave'));
    expect(mockRouter.back).toHaveBeenCalled();
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
  it('pack title, comparison table (shipped rows only), store-settings line', async () => {
    mockParams = { from: 'pack', pack: 'Future Us', packId: 'p-9' };
    purchasesMock.purchasePackage.mockResolvedValue({ customerInfo: {} });
    mockEntitlements.mockResolvedValue([]);
    await renderScreen(<PaywallScreen />);
    expect(await screen.findByTestId('34-buy')).toBeTruthy();
    expect(screen.getByText('Unlock Future Us and every other pack')).toBeTruthy();
    expect(screen.getByTestId('34-compare')).toBeTruthy();
    expect(screen.getByText('Streak saver')).toBeTruthy();
    expect(screen.queryByText(/Couple report/)).toBeNull();
    expect(
      screen.getByText('Covers you both. Cancel anytime in your store settings.'),
    ).toBeTruthy();
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
