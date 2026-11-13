import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, renderHook, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';
import { Linking, Platform } from 'react-native';
import { INTRO_ELIGIBILITY_STATUS } from 'react-native-purchases';

import { holdCancelOffer, peekHeldCancelOffer } from '@/features/premium/cancelOffer';
import { useCancelOfferGate } from '@/features/premium/hooks';
import * as offers from '@/features/premium/offers';
import {
  loadCancelOffer,
  manageSubscriptionsUrl,
  resetPurchasesForTests,
  type CancelOffer,
} from '@/features/premium/purchases';
import CancelOfferScreen from '@/features/premium/screens/CancelOfferScreen';
import PaywallScreen from '@/features/premium/screens/PaywallScreen';
import { recordAnalytics } from '@/test/analytics';
import { fakeOfferings, purchasesMock } from '@/test/purchases';
import { renderUi } from '@/test/render';

/**
 * MOB-84 (D61): no exit offer on a paywall close (16 × opens 17, the server is never asked); the
 * iOS cancel offer screen from Manage subscription or the `cancel_offer` push; the day-3 gift has
 * no hard-coded percentage. Every percentage and price comes from the store (fake prices are
 * opaque strings: `Y-PRICE` regular, `C-PRICE` the `cancel30` offer).
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

describe('16 × (D61: no exit offer on a paywall close)', () => {
  it('opens 17 as before D57; the server and the exit30 offer are never asked', async () => {
    const rec = recordAnalytics();
    await closeSixteen();
    expect(await screen.findByTestId('17-sheet')).toBeTruthy();
    expect(screen.queryByTestId('exit-offer-sheet')).toBeNull();
    expect(mockOpenExitOffer).not.toHaveBeenCalled();
    expect(purchasesMock.checkTrialOrIntroductoryPriceEligibility).not.toHaveBeenCalledWith([
      'yearly_exit30',
    ]);
    expect(rec.of('exit_offer_viewed')).toEqual([]);
    expect(rec.of('exit_sheet_viewed')).toHaveLength(1);
    rec.stop();
  });
});

describe('Manage subscription cancel offer (D61 (2), D57 (2))', () => {
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

  describe('the offer screen (MOB-84)', () => {
    const offer = {
      regularPrice: 'Y-PRICE',
      offerPrice: 'C-PRICE',
      percent: 30,
    } as unknown as CancelOffer;
    let openURL: jest.SpyInstance;
    beforeEach(() => {
      openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    });
    afterEach(() => openURL.mockRestore());

    it('from Manage subscription: the held offer shows, the server is not asked again', async () => {
      holdCancelOffer(offer);
      await renderScreen(<CancelOfferScreen />);
      expect(screen.getByTestId('cancel-offer-title')).toHaveTextContent('Stay for 30% less?');
      expect(screen.getByTestId('cancel-offer-price-offer')).toHaveTextContent('C-PRICE');
      expect(screen.getByTestId('cancel-offer-price-was')).toHaveTextContent('Y-PRICE');
      expect(mockOpenExitOffer).not.toHaveBeenCalled();
      // Read once: a later push visit asks the server itself.
      expect(peekHeldCancelOffer()).toBeNull();
    });

    it('"Continue to cancel" opens the store page at once and leaves', async () => {
      const rec = recordAnalytics();
      holdCancelOffer(offer);
      await renderScreen(<CancelOfferScreen />);
      await fireEvent.press(screen.getByText('Continue to cancel'));
      expect(openURL).toHaveBeenCalledWith(manageSubscriptionsUrl(Platform.OS));
      expect(mockRouter.back).toHaveBeenCalledTimes(1);
      expect(rec.of('exit_offer_dismissed')).toEqual([{ trigger: 'cancel' }]);
      expect(rec.of('cancel_continued')).toHaveLength(1);
      rec.stop();
    });

    it('× leaves without opening the store', async () => {
      holdCancelOffer(offer);
      await renderScreen(<CancelOfferScreen />);
      await fireEvent.press(screen.getByTestId('cancel-offer-close'));
      expect(mockRouter.back).toHaveBeenCalledTimes(1);
      expect(openURL).not.toHaveBeenCalled();
    });

    it('from the push: asks the store, then `open_exit_offer(cancel)`, then shows', async () => {
      if (Platform.OS !== 'ios') return;
      storeHasCancelOffer();
      const rec = recordAnalytics();
      await renderScreen(<CancelOfferScreen />);
      expect(await screen.findByTestId('cancel-offer-title')).toHaveTextContent(
        'Stay for 30% less?',
      );
      expect(mockOpenExitOffer).toHaveBeenCalledTimes(1);
      expect(mockOpenExitOffer.mock.calls[0]![0]).toBe('cancel');
      expect(rec.of('exit_offer_viewed')).toEqual([{ trigger: 'cancel' }]);
      rec.stop();
    });

    it('from the push, server says no (shown before, period over): the store page instead', async () => {
      storeHasCancelOffer();
      mockOpenExitOffer.mockResolvedValue(false);
      await renderScreen(<CancelOfferScreen />);
      await waitFor(() =>
        expect(openURL).toHaveBeenCalledWith(manageSubscriptionsUrl(Platform.OS)),
      );
      expect(mockRouter.back).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('cancel-offer-title')).toBeNull();
    });

    it('from the push, no running App Store subscription: the store page, server not asked', async () => {
      purchasesMock.getCustomerInfo.mockResolvedValue({ entitlements: { active: {} } });
      await renderScreen(<CancelOfferScreen />);
      await waitFor(() => expect(openURL).toHaveBeenCalled());
      expect(mockOpenExitOffer).not.toHaveBeenCalled();
    });
  });
});

describe('day-3 gift (D57)', () => {
  it('no hard-coded fallback percentage (lead 2026-11-13): only the store decides', () => {
    expect('DAY3_PERCENT' in offers).toBe(false);
  });
});
