import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';
import { INTRO_ELIGIBILITY_STATUS } from 'react-native-purchases';

import { CancelOfferSheet } from '@/features/premium/components/ExitOffer';
import { useCancelOfferGate, useExitOfferGate } from '@/features/premium/hooks';
import * as offers from '@/features/premium/offers';
import { useExitOfferDevice } from '@/features/premium/offers';
import {
  loadCancelOffer,
  resetPurchasesForTests,
  type CancelOffer,
} from '@/features/premium/purchases';
import PaywallScreen from '@/features/premium/screens/PaywallScreen';
import { recordAnalytics } from '@/test/analytics';
import { fakeOfferings, purchasesMock } from '@/test/purchases';
import { renderUi } from '@/test/render';

/**
 * MOB-76 (D57): the exit offer on the person's first × of P3/16, the iOS cancel offer, and the
 * day-3 gift at 50%. Every percentage and price comes from the store (fake prices are opaque
 * strings: `Y-PRICE` regular, `X-PRICE` the `exit30` first year).
 */

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ from: 'settings' }),
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
const mockOpenExitOffer = jest.fn<Promise<boolean>, [string, string]>();
jest.mock('@/features/premium/api', () => ({
  getEntitlements: () => mockEntitlements(),
  getOffer: () => Promise.resolve({ eligible: false, opened: false, expiresAt: null }),
  openExitOffer: (trigger: string, id: string) => mockOpenExitOffer(trigger, id),
}));

const ELIGIBLE = { status: INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE };
const INELIGIBLE = { status: INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_INELIGIBLE };

let qc: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
function renderScreen(ui: ReactElement) {
  return renderUi(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

/** The store says the person gets the `exit30` intro price (and nothing else). */
function storeSaysEligible(yes = true) {
  purchasesMock.checkTrialOrIntroductoryPriceEligibility.mockImplementation((ids: string[]) =>
    Promise.resolve(
      ids.includes('yearly_exit30') ? { yearly_exit30: yes ? ELIGIBLE : INELIGIBLE } : {},
    ),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  resetPurchasesForTests();
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = 'appl_test';
  purchasesMock.getOfferings.mockResolvedValue(fakeOfferings());
  purchasesMock.logIn.mockResolvedValue({ customerInfo: {}, created: false });
  purchasesMock.purchasePackage.mockReset();
  storeSaysEligible();
  mockEntitlements.mockResolvedValue([]);
  mockOpenExitOffer.mockResolvedValue(true);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => qc.clear());
afterAll(() => {
  delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
});

async function closeSixteen() {
  await renderScreen(<PaywallScreen />);
  await screen.findByTestId('16-plan-yearly');
  await waitFor(() => expect(mockEntitlements).toHaveBeenCalled());
  await fireEvent.press(screen.getByTestId('16-close'));
}

describe('16: exit offer on the first × (D57)', () => {
  it('server + store say yes: the sheet, every price and the % from `exit30`, no 17', async () => {
    const rec = recordAnalytics();
    await closeSixteen();
    expect(await screen.findByTestId('exit-offer-sheet')).toBeTruthy();
    expect(screen.getByTestId('exit-offer-title')).toHaveTextContent('30% off your first year');
    expect(screen.getByTestId('exit-offer-price-offer')).toHaveTextContent('X-PRICE');
    expect(screen.getByTestId('exit-offer-price-was')).toHaveTextContent('Y-PRICE');
    expect(screen.getByText('Take 30% off')).toBeTruthy();
    expect(screen.getByText('No thanks, continue free')).toBeTruthy();
    expect(screen.queryByTestId('17-sheet')).toBeNull();
    expect(mockOpenExitOffer).toHaveBeenCalledTimes(1);
    expect(mockOpenExitOffer.mock.calls[0]![0]).toBe('paywall_close');
    expect(rec.of('exit_offer_viewed')).toEqual([{ trigger: 'paywall_close', paywall: '16' }]);
    rec.stop();
  });

  it('the percentage follows the store, never a hard-coded 30', async () => {
    purchasesMock.getOfferings.mockResolvedValue(fakeOfferings({ exit30Amount: 33 }));
    await closeSixteen();
    expect(await screen.findByTestId('exit-offer-title')).toHaveTextContent(
      '45% off your first year',
    );
    expect(screen.getByText('Take 45% off')).toBeTruthy();
  });

  it('"No thanks, continue free" always closes: leaves 16, no 17', async () => {
    const rec = recordAnalytics();
    await closeSixteen();
    await fireEvent.press(await screen.findByTestId('exit-offer-no'));
    expect(mockRouter.back).toHaveBeenCalled();
    expect(screen.queryByTestId('17-sheet')).toBeNull();
    expect(rec.of('exit_offer_dismissed')).toEqual([{ trigger: 'paywall_close', paywall: '16' }]);
    rec.stop();
  });

  it('× on the sheet always closes too', async () => {
    await closeSixteen();
    await fireEvent.press(await screen.findByTestId('exit-offer-close'));
    expect(mockRouter.back).toHaveBeenCalled();
    expect(screen.queryByTestId('17-sheet')).toBeNull();
  });

  it('"Take 30% off" buys `yearly_exit30` from `exit30`', async () => {
    const rec = recordAnalytics();
    purchasesMock.purchasePackage.mockResolvedValue({
      customerInfo: { entitlements: { active: { premium: {} } } },
    });
    await closeSixteen();
    const take = await screen.findByTestId('exit-offer-take');
    // The webhook has written the entitlement by the time the app checks.
    mockEntitlements.mockResolvedValue([{ user_id: 'u1', is_active: true, expires_at: null }]);
    await fireEvent.press(take);
    await waitFor(() => expect(purchasesMock.purchasePackage).toHaveBeenCalled());
    expect(purchasesMock.purchasePackage.mock.calls[0]![0].product.identifier).toBe(
      'yearly_exit30',
    );
    await waitFor(() => expect(rec.of('exit_offer_claimed')).toHaveLength(1));
    expect(rec.of('purchase_started')[0]).toMatchObject({
      paywall: '16',
      offering: 'exit30',
      product: 'yearly_exit30',
    });
    rec.stop();
  });

  it('server says no (shown before, Premium, gift live): 17 as before', async () => {
    mockOpenExitOffer.mockResolvedValue(false);
    await closeSixteen();
    expect(await screen.findByTestId('17-sheet')).toBeTruthy();
    expect(screen.queryByTestId('exit-offer-sheet')).toBeNull();
  });

  it('store says not eligible: 17, and the server is never asked (nothing recorded)', async () => {
    storeSaysEligible(false);
    await closeSixteen();
    expect(await screen.findByTestId('17-sheet')).toBeTruthy();
    expect(mockOpenExitOffer).not.toHaveBeenCalled();
  });

  it('an RPC error reads as no: 17', async () => {
    mockOpenExitOffer.mockRejectedValue(new Error('offline'));
    await closeSixteen();
    expect(await screen.findByTestId('17-sheet')).toBeTruthy();
  });
});

describe('useExitOfferGate', () => {
  it('signed in: asked once per visit; a second × never asks again', async () => {
    const { result } = await renderHook(() => useExitOfferGate({ signedOut: false }), { wrapper });
    await waitFor(() => expect(mockEntitlements).toHaveBeenCalled());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    let first: unknown;
    let second: unknown;
    await act(async () => {
      first = await result.current();
      second = await result.current();
    });
    expect(first).toMatchObject({ productId: 'yearly_exit30' });
    expect(second).toBeNull();
    expect(mockOpenExitOffer).toHaveBeenCalledTimes(1);
  });

  it('never for a Premium couple: the server is not even asked', async () => {
    mockEntitlements.mockResolvedValue([{ user_id: 'u2', is_active: true, expires_at: null }]);
    const { result } = await renderHook(() => useExitOfferGate({ signedOut: false }), { wrapper });
    await waitFor(() => expect(mockEntitlements).toHaveBeenCalled());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    let plan: unknown;
    await act(async () => {
      plan = await result.current();
    });
    expect(plan).toBeNull();
    expect(mockOpenExitOffer).not.toHaveBeenCalled();
  });

  it('P3 before sign-in: once per device (flag), the server told later', async () => {
    useExitOfferDevice.setState({ shown: false, toRecord: false });
    const one = await renderHook(() => useExitOfferGate({ signedOut: true }), { wrapper });
    let plan: unknown;
    await act(async () => {
      plan = await one.result.current();
    });
    expect(plan).toMatchObject({ productId: 'yearly_exit30' });
    expect(mockOpenExitOffer).not.toHaveBeenCalled();
    expect(useExitOfferDevice.getState()).toMatchObject({ shown: true, toRecord: true });
    // A later P3 visit on this phone: never again.
    const two = await renderHook(() => useExitOfferGate({ signedOut: true }), { wrapper });
    await act(async () => {
      plan = await two.result.current();
    });
    expect(plan).toBeNull();
    useExitOfferDevice.setState({ shown: false, toRecord: false });
  });

  it('without a RevenueCat key: never (no prices to show)', async () => {
    delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
    const { result } = await renderHook(() => useExitOfferGate({ signedOut: true }), { wrapper });
    let plan: unknown;
    await act(async () => {
      plan = await result.current();
    });
    expect(plan).toBeNull();
  });
});

describe('Manage subscription cancel offer (D57 (2))', () => {
  const product = {
    identifier: 'yearly_trial',
    price: 60,
    priceString: 'Y-PRICE',
    subscriptionPeriod: 'P1Y',
    discounts: [{ identifier: 'cancel30', price: 42, priceString: 'C-PRICE' }],
  };
  function storeHasCancelOffer() {
    purchasesMock.getCustomerInfo.mockResolvedValue({
      entitlements: {
        active: { premium: { store: 'APP_STORE', productIdentifier: 'yearly_trial' } },
      },
    });
    purchasesMock.getProducts.mockResolvedValue([product]);
    purchasesMock.getPromotionalOffer.mockResolvedValue({ identifier: 'cancel30', signature: 's' });
  }

  it('Android: straight to the Play page; no server call, no screen', async () => {
    storeHasCancelOffer();
    const { result } = await renderHook(() => useCancelOfferGate(), { wrapper });
    expect(await result.current('android')).toBeNull();
    expect(mockOpenExitOffer).not.toHaveBeenCalled();
    expect(purchasesMock.getCustomerInfo).not.toHaveBeenCalled();
  });

  it('iOS: the store offer, then `open_exit_offer(cancel)`; the % from the store', async () => {
    storeHasCancelOffer();
    const { result } = await renderHook(() => useCancelOfferGate(), { wrapper });
    const offer = await result.current('ios');
    expect(offer).toMatchObject({ regularPrice: 'Y-PRICE', offerPrice: 'C-PRICE', percent: 30 });
    expect(mockOpenExitOffer.mock.calls[0]![0]).toBe('cancel');
  });

  it('iOS, server says shown before: straight to the store page', async () => {
    storeHasCancelOffer();
    mockOpenExitOffer.mockResolvedValue(false);
    const { result } = await renderHook(() => useCancelOfferGate(), { wrapper });
    expect(await result.current('ios')).toBeNull();
  });

  it('no own App Store subscription (partner covers us, or Play), Monthly, no discount: none', async () => {
    storeHasCancelOffer();
    purchasesMock.getCustomerInfo.mockResolvedValue({ entitlements: { active: {} } });
    expect(await loadCancelOffer('ios')).toBeNull();
    storeHasCancelOffer();
    purchasesMock.getCustomerInfo.mockResolvedValue({
      entitlements: { active: { premium: { store: 'PLAY_STORE', productIdentifier: 'x' } } },
    });
    expect(await loadCancelOffer('ios')).toBeNull();
    storeHasCancelOffer();
    purchasesMock.getProducts.mockResolvedValue([{ ...product, subscriptionPeriod: 'P1M' }]);
    expect(await loadCancelOffer('ios')).toBeNull();
    storeHasCancelOffer();
    purchasesMock.getProducts.mockResolvedValue([{ ...product, discounts: [] }]);
    expect(await loadCancelOffer('ios')).toBeNull();
  });

  it('the screen: at most one extra step; "Continue to cancel" goes on, × closes', async () => {
    const offer = {
      regularPrice: 'Y-PRICE',
      offerPrice: 'C-PRICE',
      percent: 30,
    } as unknown as CancelOffer;
    const onContinue = jest.fn();
    const onClose = jest.fn();
    await renderUi(
      <CancelOfferSheet
        visible
        offer={offer}
        onTake={() => {}}
        onContinue={onContinue}
        onClose={onClose}
      />,
    );
    expect(screen.getByTestId('cancel-offer-title')).toHaveTextContent('Stay for 30% less?');
    expect(screen.getByTestId('cancel-offer-price-offer')).toHaveTextContent('C-PRICE');
    expect(screen.getByTestId('cancel-offer-price-was')).toHaveTextContent('Y-PRICE');
    await fireEvent.press(screen.getByText('Continue to cancel'));
    expect(onContinue).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('cancel-offer-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('day-3 gift (D57)', () => {
  it('no hard-coded fallback percentage (lead 2026-11-13): only the store decides', () => {
    expect('DAY3_PERCENT' in offers).toBe(false);
  });
});
