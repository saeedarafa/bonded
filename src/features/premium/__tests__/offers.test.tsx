import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { INTRO_ELIGIBILITY_STATUS } from 'react-native-purchases';
import { StyleSheet } from 'react-native';

import { GiftChip } from '@/features/premium/components/GiftChip';
import {
  countdownParts,
  introPercent,
  monotonicNow,
  offerCountdown,
  offerRemainingMs,
  OFFER_WINDOW_MS,
  toServerOffer,
  type ServerOffer,
} from '@/features/premium/offers';
import { introPerPersonMonthly } from '@/features/premium/pricing';
import { resetPurchasesForTests, type Plan } from '@/features/premium/purchases';
import GiftOpenedScreen from '@/features/premium/screens/GiftOpenedScreen';
import GiftScreen from '@/features/premium/screens/GiftScreen';
import PaywallScreen from '@/features/premium/screens/PaywallScreen';
import { PERSIST_DEHYDRATE_OPTIONS } from '@/lib/queryClient';
import { expectOnlyAllowedKeys, recordAnalytics } from '@/test/analytics';
import { fakeOfferings, purchasesMock } from '@/test/purchases';
import { renderUi } from '@/test/render';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  Redirect: ({ href }: { href: string }) => {
    mockRouter.replace(href);
    return null;
  },
}));
let mockUserId = 'u1';
jest.mock('@/features/auth/session', () => ({ useSession: () => ({ userId: mockUserId }) }));
const PAIRED = {
  id: 'couple-1',
  couple_members: [
    { user_id: 'u1', left_at: null },
    { user_id: 'u2', left_at: null },
  ],
};
let mockCouple: object = PAIRED;
jest.mock('@/features/couple/api', () => ({
  getActiveCouple: () => Promise.resolve(mockCouple),
}));
jest.mock('@/features/profile/api', () => ({
  getCoupleProfiles: () =>
    Promise.resolve([
      { id: 'u1', display_name: 'Maya', avatar_url: null },
      { id: 'u2', display_name: 'Sam', avatar_url: null },
    ]),
}));
const mockEntitlements = jest.fn();
const mockGetOffer = jest.fn<Promise<ServerOffer>, [string]>();
const mockOpenOffer = jest.fn<Promise<ServerOffer>, [string]>();
const mockClaim = jest.fn<Promise<boolean>, [string]>();
jest.mock('@/features/premium/api', () => ({
  getEntitlements: () => mockEntitlements(),
  getOffer: (kind: string) => mockGetOffer(kind),
  openOffer: (kind: string) => mockOpenOffer(kind),
  claimOfferScreen: (screen: string) => mockClaim(screen),
}));

const H = 60 * 60 * 1000;
const M = 60 * 1000;
/** The server's answer as the RPC returns it (CONTRACTS §2), read by the real parser. */
const server = (row: Record<string, unknown>) => Promise.resolve(toServerOffer(row));
const NONE = () =>
  server({ eligible: false, expires_at: null, server_now: new Date().toISOString() });
/** An opened gift with `left` ms on the server's clock (its `server_now` is 3 h off the phone's). */
const opened = (left: number) => {
  const serverNow = Date.now() + 3 * H;
  return server({
    eligible: true,
    expires_at: new Date(serverNow + left).toISOString(),
    first_opened_at: new Date(serverNow + left - 12 * H).toISOString(),
    server_now: new Date(serverNow).toISOString(),
  });
};
const unopened = () =>
  server({
    eligible: true,
    expires_at: null,
    first_opened_at: null,
    server_now: new Date().toISOString(),
  });

let qc: QueryClient;
function renderScreen(ui: ReactElement) {
  return renderUi(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  resetPurchasesForTests();
  mockParams = {};
  mockUserId = 'u1';
  mockCouple = PAIRED;
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = 'appl_test';
  purchasesMock.getOfferings.mockResolvedValue(fakeOfferings());
  purchasesMock.logIn.mockResolvedValue({ customerInfo: {}, created: false });
  purchasesMock.purchasePackage.mockReset();
  purchasesMock.checkTrialOrIntroductoryPriceEligibility.mockResolvedValue({});
  mockEntitlements.mockResolvedValue([]);
  mockGetOffer.mockReset();
  mockGetOffer.mockImplementation(NONE);
  mockOpenOffer.mockReset();
  mockClaim.mockReset();
  mockClaim.mockResolvedValue(true);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { gcTime: 0 } } });
});
afterEach(() => qc.clear());
afterAll(() => {
  delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
});

describe('the server clock (CONTRACTS §2: max(0, expires_at - server_now), then monotonic)', () => {
  it('counts down from the server expires_at, whatever the phone clock says', () => {
    const offer = toServerOffer(
      {
        eligible: true,
        expires_at: '2026-11-11T14:00:00Z',
        server_now: '2026-11-11T12:00:00Z',
      },
      // The phone thinks it's a day later: ignored, the server's own clock counts.
      Date.parse('2026-11-12T12:00:00Z'),
      1_000,
    );
    expect(offer).toMatchObject({ eligible: true, opened: true, leftAtReceipt: 2 * H });
    expect(offerRemainingMs(offer, 1_000)).toBe(2 * H);
    expect(offerRemainingMs(offer, 1_000 + 30 * M)).toBe(2 * H - 30 * M);
    expect(offerRemainingMs(offer, 1_000 + 3 * H)).toBe(0);
  });

  it('never more than 12 hours, never below 0; no server_now: the phone clock at receipt', () => {
    const now = Date.parse('2026-11-11T12:00:00Z');
    const far = toServerOffer({ eligible: true, expires_at: '2026-11-13T12:00:00Z' }, now, 0);
    expect(far.leftAtReceipt).toBe(OFFER_WINDOW_MS);
    const past = toServerOffer({ eligible: false, expires_at: '2026-11-11T11:00:00Z' }, now, 0);
    expect(offerRemainingMs(past, 0)).toBe(0);
  });

  it('unopened (no expires_at yet) has no countdown; junk reads as no gift', () => {
    const offer = toServerOffer({ eligible: true, expires_at: null, first_opened_at: null });
    expect(offer).toMatchObject({ eligible: true, opened: false, expiresAt: null });
    expect(offerRemainingMs(offer, monotonicNow())).toBe(0);
    expect(toServerOffer('nonsense')).toMatchObject({ eligible: false, opened: false });
    expect(toServerOffer({ eligible: 'yes', expires_at: 'soon' })).toMatchObject({
      eligible: false,
      opened: false,
    });
  });

  it('live and spoken countdowns round up (a live offer never reads 00:00:00)', () => {
    expect(offerCountdown(12 * H)).toBe('12:00:00');
    expect(offerCountdown(11 * H + 59 * M + 41_200)).toBe('11:59:42');
    expect(offerCountdown(400)).toBe('00:00:01');
    expect(offerCountdown(0)).toBe('00:00:00');
    expect(offerCountdown(-5)).toBe('00:00:00');
    expect(countdownParts(11 * H + 41 * M + 5_000)).toEqual({ hours: 11, minutes: 42 });
  });

  it('the offer is never written to disk (a restored clock must not show before the server)', () => {
    const query = (queryKey: unknown[]) =>
      ({ queryKey, state: { status: 'success' } }) as unknown as Parameters<
        typeof PERSIST_DEHYDRATE_OPTIONS.shouldDehydrateQuery
      >[0];
    expect(PERSIST_DEHYDRATE_OPTIONS.shouldDehydrateQuery(query(['offer', 'day3']))).toBe(false);
  });
});

describe('prices and percentage only from the store', () => {
  const plan = (amount: number | null, intro: number | null): Plan => ({
    id: '$rc_annual',
    kind: 'yearly',
    price: 'Y',
    pricePerMonth: null,
    productId: 'p',
    amount,
    currencyCode: 'XTS',
    trial: null,
    introOffer: intro === null ? null : { price: 'O', amount: intro },
  });
  it('introPercent rounds down; unknown is null', () => {
    expect(introPercent(plan(60, 45))).toBe(25);
    expect(introPercent(plan(59.99, 44.99))).toBe(25);
    expect(introPercent(plan(60, 46))).toBe(23);
    expect(introPercent(plan(60, null))).toBeNull();
    expect(introPercent(plan(null, 45))).toBeNull();
    expect(introPercent(undefined)).toBeNull();
  });
  it('per person a month from the intro price ÷ 24', () => {
    expect(introPerPersonMonthly(plan(60, 48))).toMatch(/2\.00/);
    expect(introPerPersonMonthly(plan(60, null))).toBeNull();
  });
});

describe('15 Gift opened (coupon)', () => {
  it('the real countdown from the server, every price from the `day3` offering', async () => {
    mockGetOffer.mockImplementation(() => opened(2 * H + 3 * M + 30_000));
    await renderScreen(<GiftOpenedScreen />);
    const chip = await screen.findByTestId('15-countdown');
    expect(screen.getByText(/^Offer ends in 02:03:\d\d$/)).toBeTruthy();
    expect(chip.props.accessibilityLabel).toBe('Offer ends in 2 hours 4 minutes');
    expect(await screen.findByText('O-PRICE')).toBeTruthy();
    expect(screen.getByTestId('15-was')).toHaveTextContent('Y-PRICE');
    expect(screen.getByTestId('15-title')).toHaveTextContent('50% off Premium, for you both');
    expect(screen.getByText('Claim 50% off')).toBeTruthy();
    expect(screen.getByText('Your offer waits on Today until it ends.')).toBeTruthy();
    for (const perk of [
      'All question packs',
      'Voice answers',
      'Longer answers',
      'More little things',
      'Streak saver',
      'Full weekly recap',
    ])
      expect(screen.getByText(perk)).toBeTruthy();
    expect(mockGetOffer).toHaveBeenCalledWith('day3');
    // Reading the gift never starts or claims anything.
    expect(mockOpenOffer).not.toHaveBeenCalled();
    expect(mockClaim).not.toHaveBeenCalled();

    purchasesMock.purchasePackage.mockResolvedValue({ customerInfo: {} });
    mockEntitlements.mockResolvedValue([{ user_id: 'u1', is_active: true, expires_at: null }]);
    await fireEvent.press(screen.getByTestId('15-claim'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/success'));
    // Bought from the `day3` offering's yearly package (the one carrying the intro price).
    const bought = purchasesMock.purchasePackage.mock.calls[0]?.[0];
    expect(bought.product.introPrice.priceString).toBe('O-PRICE');
  });

  it('15 "Claim": purchase events as paywall 15 on the day3 offering (MOB-24d)', async () => {
    const rec = recordAnalytics();
    mockGetOffer.mockImplementation(() => opened(H));
    await renderScreen(<GiftOpenedScreen />);
    await screen.findByTestId('15-countdown');
    purchasesMock.purchasePackage.mockResolvedValue({ customerInfo: {} });
    mockEntitlements.mockResolvedValue([{ user_id: 'u1', is_active: true, expires_at: null }]);
    await fireEvent.press(screen.getByTestId('15-claim'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/success'));
    expect(rec.of('purchase_started')).toEqual([
      { paywall: '15', product: 'yearly_day3', offering: 'day3' },
    ]);
    expect(rec.of('purchase_completed')).toEqual([
      { paywall: '15', product: 'yearly_day3', is_trial: false, before_sign_in: false },
    ]);
    expect(rec.of('gift_offer_claimed')).toEqual([{ offer_kind: 'day3' }]);
    // Never a price.
    expect(JSON.stringify(rec.captured)).not.toMatch(/PRICE/);
    expectOnlyAllowedKeys(rec.captured);
    rec.stop();
  });

  it('15 "Claim" cancelled in the store: purchase_cancelled, no claim', async () => {
    const rec = recordAnalytics();
    mockGetOffer.mockImplementation(() => opened(H));
    await renderScreen(<GiftOpenedScreen />);
    await screen.findByTestId('15-countdown');
    purchasesMock.purchasePackage.mockRejectedValue(
      Object.assign(new Error('cancelled'), { userCancelled: true }),
    );
    await fireEvent.press(screen.getByTestId('15-claim'));
    await waitFor(() => expect(rec.of('purchase_cancelled')).toHaveLength(1));
    expect(rec.of('purchase_cancelled')[0]).toEqual({ paywall: '15', product: 'yearly_day3' });
    expect(rec.of('gift_offer_claimed')).toEqual([]);
    rec.stop();
  });

  it('the percentage follows the store, never a hard-coded 50', async () => {
    purchasesMock.getOfferings.mockResolvedValue(fakeOfferings({ day3Amount: 42 }));
    mockGetOffer.mockImplementation(() => opened(H));
    await renderScreen(<GiftOpenedScreen />);
    await waitFor(() =>
      expect(screen.getByTestId('15-title')).toHaveTextContent('30% off Premium, for you both'),
    );
    expect(screen.getByText('Claim 30% off')).toBeTruthy();
  });

  // The partner sees the same clock: both phones read the one server `expires_at`.
  it.each(['u1', 'u2'])("the same clock on %s's phone", async (user) => {
    mockUserId = user;
    mockGetOffer.mockImplementation(() => opened(5 * H + 30_000));
    await renderScreen(<GiftOpenedScreen />);
    await screen.findByTestId('15-countdown');
    expect(screen.getByText(/^Offer ends in 05:00:\d\d$/)).toBeTruthy();
  });

  it('"Not now" just closes: no 17, no paywall (D52)', async () => {
    mockGetOffer.mockImplementation(() => opened(H));
    await renderScreen(<GiftOpenedScreen />);
    await fireEvent.press(await screen.findByTestId('15-later'));
    expect(mockRouter.back).toHaveBeenCalled();
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(screen.queryByTestId('17-sheet')).toBeNull();
  });

  it('no intro price from the store: the claim says so and never sells the full price', async () => {
    purchasesMock.getOfferings.mockResolvedValue(fakeOfferings({ extra: false }));
    mockGetOffer.mockImplementation(() => opened(H));
    await renderScreen(<GiftOpenedScreen />);
    await screen.findByTestId('15-countdown');
    await waitFor(() => expect(screen.queryByTestId('15-price')).toBeNull());
    await fireEvent.press(screen.getByTestId('15-claim'));
    expect(await screen.findByTestId('15-notice-unavailable')).toBeTruthy();
    expect(purchasesMock.purchasePackage).not.toHaveBeenCalled();
    expect(mockRouter.push).not.toHaveBeenCalledWith('/paywall');
  });

  it('when the clock runs out it ends, asks the server again, and offers nothing else', async () => {
    mockGetOffer
      .mockImplementationOnce(() => opened(1_200))
      .mockImplementation(() =>
        server({
          eligible: false,
          expires_at: new Date(Date.now() - 1_000).toISOString(),
          server_now: new Date().toISOString(),
        }),
      );
    await renderScreen(<GiftOpenedScreen />);
    expect(await screen.findByTestId('15-countdown')).toBeTruthy();
    expect(await screen.findByTestId('15-ended', {}, { timeout: 4_000 })).toBeTruthy();
    await waitFor(() => expect(mockGetOffer).toHaveBeenCalledTimes(2));
    await fireEvent.press(screen.getByTestId('15-back'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/today');
    expect(mockRouter.replace).not.toHaveBeenCalledWith('/paywall');
  });

  it('not opened yet: 14 opens it first', async () => {
    mockGetOffer.mockImplementation(unopened);
    await renderScreen(<GiftOpenedScreen />);
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/gift'));
  });

  it('premium (the partner pays) suppresses the offer and never asks the server', async () => {
    mockEntitlements.mockResolvedValue([{ user_id: 'u2', is_active: true, expires_at: null }]);
    mockGetOffer.mockImplementation(() => opened(H));
    await renderScreen(<GiftOpenedScreen />);
    expect(await screen.findByTestId('15-ended')).toBeTruthy();
    expect(mockGetOffer).not.toHaveBeenCalled();
  });
});

describe('14 gift', () => {
  it('live: the gift; Open starts the shared clock (open_offer) and goes to 15', async () => {
    mockGetOffer.mockImplementation(unopened);
    mockOpenOffer.mockImplementation(() => opened(12 * H));
    await renderScreen(<GiftScreen />);
    expect(await screen.findByText('3 days in a row! You earned a gift.')).toBeTruthy();
    expect(screen.getByText('Just for you two. Sam sees the same gift.')).toBeTruthy();
    expect(screen.getByLabelText('3-day streak badge')).toBeTruthy();
    expect(mockOpenOffer).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('14-open'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/gift/opened'));
    expect(mockOpenOffer).toHaveBeenCalledWith('day3');
    // 15 reads the opened clock straight from the answer, without waiting for another read.
    expect(qc.getQueryData<ServerOffer>(['offer', 'day3'])?.opened).toBe(true);
  });

  it('open fails (offline): says so and stays', async () => {
    mockGetOffer.mockImplementation(unopened);
    mockOpenOffer.mockRejectedValue({ kind: 'NETWORK', message: 'offline' });
    await renderScreen(<GiftScreen />);
    await fireEvent.press(await screen.findByTestId('14-open'));
    expect(await screen.findByTestId('14-error')).toBeTruthy();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('"Not now" closes without starting the clock', async () => {
    mockGetOffer.mockImplementation(unopened);
    await renderScreen(<GiftScreen />);
    await fireEvent.press(await screen.findByTestId('14-later'));
    expect(mockRouter.back).toHaveBeenCalled();
    expect(mockOpenOffer).not.toHaveBeenCalled();
  });

  it('not live: straight to Today', async () => {
    await renderScreen(<GiftScreen />);
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/today'));
  });

  it('the store says this person already used an intro offer (second gate): no gift', async () => {
    mockGetOffer.mockImplementation(unopened);
    purchasesMock.checkTrialOrIntroductoryPriceEligibility.mockResolvedValue({
      product$rc_annual: {
        status: INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_INELIGIBLE,
        description: '',
      },
    });
    await renderScreen(<GiftScreen />);
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/today'));
    expect(screen.queryByTestId('14-open')).toBeNull();
  });
});

describe('Today gift chip (D52)', () => {
  it('opened: "50% off · ends in 11:41:30 · Open" -> 15', async () => {
    mockGetOffer.mockImplementation(() => opened(11 * H + 41 * M + 30_000));
    await renderScreen(<GiftChip />);
    const chip = await screen.findByTestId('today-gift-chip');
    await waitFor(() =>
      expect(screen.getByTestId('today-gift-chip-label')).toHaveTextContent(
        /^50% off · ends in 11:41:(30|29|28)$/,
      ),
    );
    expect(chip.props.accessibilityLabel).toBe(
      'Your gift: 50% off Premium, ends in 11 hours 42 minutes. Open',
    );
    await fireEvent.press(chip);
    expect(mockRouter.push).toHaveBeenCalledWith('/gift/opened');
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it('counts down every second (PO bug 2026-11-12: "12:00" never moved)', async () => {
    jest.useFakeTimers();
    try {
      const label = () => screen.getByTestId('today-gift-chip-label');
      mockGetOffer.mockImplementation(() => opened(12 * H));
      await renderScreen(<GiftChip />);
      await waitFor(() => expect(label()).toHaveTextContent('50% off · ends in 12:00:00'));
      await act(async () => {
        jest.advanceTimersByTime(1_000);
      });
      expect(label()).toHaveTextContent('50% off · ends in 11:59:59');
      await act(async () => {
        jest.advanceTimersByTime(60_000);
      });
      expect(label()).toHaveTextContent('50% off · ends in 11:58:59');
      // The a11y label stays in hours and minutes (not re-spoken every second).
      expect(screen.getByTestId('today-gift-chip').props.accessibilityLabel).toBe(
        'Your gift: 50% off Premium, ends in 11 hours 59 minutes. Open',
      );

      // A refetch (resume, focus) shows the server's real time left: never back up to 12:00:00.
      mockGetOffer.mockImplementation(() => opened(11 * H + 58 * M + 30_000));
      await act(async () => {
        await qc.refetchQueries();
      });
      await waitFor(() => expect(label()).toHaveTextContent('50% off · ends in 11:58:30'));
      await act(async () => {
        jest.advanceTimersByTime(1_000);
      });
      expect(label()).toHaveTextContent('50% off · ends in 11:58:29');
    } finally {
      jest.useRealTimers();
    }
  });

  it('not opened yet: "You earned a gift · Open" -> 14', async () => {
    mockGetOffer.mockImplementation(unopened);
    await renderScreen(<GiftChip />);
    await fireEvent.press(await screen.findByTestId('today-gift-chip'));
    expect(screen.getByTestId('today-gift-chip-label')).toHaveTextContent('You earned a gift');
    expect(mockRouter.push).toHaveBeenCalledWith('/gift');
  });

  it('#358 AX5: label and "Open" stop at 200% and "Open" never shrinks, so words stay whole', async () => {
    mockGetOffer.mockImplementation(unopened);
    await renderScreen(<GiftChip />);
    await screen.findByTestId('today-gift-chip');
    expect(screen.getByTestId('today-gift-chip-label').props.maxFontSizeMultiplier).toBe(2);
    const open = screen.getByTestId('today-gift-chip-open');
    expect(open.props.maxFontSizeMultiplier).toBe(2);
    expect(StyleSheet.flatten(open.props.style)).toMatchObject({ flexShrink: 0 });
  });

  it('hides the moment the clock runs out; no extension, nothing in its place', async () => {
    mockGetOffer
      .mockImplementationOnce(() => opened(1_200))
      .mockImplementation(() =>
        server({ eligible: false, expires_at: new Date().toISOString(), server_now: null }),
      );
    await renderScreen(<GiftChip />);
    expect(await screen.findByTestId('today-gift-chip')).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('today-gift-chip')).toBeNull(), {
      timeout: 4_000,
    });
    await act(async () => {
      await qc.refetchQueries();
    });
    expect(screen.queryByTestId('today-gift-chip')).toBeNull();
  });

  it('no gift: no chip', async () => {
    await renderScreen(<GiftChip />);
    await waitFor(() => expect(mockGetOffer).toHaveBeenCalled());
    expect(screen.queryByTestId('today-gift-chip')).toBeNull();
  });

  it('premium: no chip, and the server is never asked', async () => {
    mockEntitlements.mockResolvedValue([{ user_id: 'u1', is_active: true, expires_at: null }]);
    mockGetOffer.mockImplementation(() => opened(H));
    await renderScreen(<GiftChip />);
    await waitFor(() => expect(mockEntitlements).toHaveBeenCalled());
    expect(screen.queryByTestId('today-gift-chip')).toBeNull();
    expect(mockGetOffer).not.toHaveBeenCalled();
  });
});

describe('16 / 34 (D52): only `default`; the gift never leaks into a paywall', () => {
  it('a live gift still shows `default` on 16, without a countdown or the offer price', async () => {
    mockGetOffer.mockImplementation(() => opened(H));
    await renderScreen(<PaywallScreen />);
    expect(await screen.findByText('Y-PRICE a year for both')).toBeTruthy();
    expect(screen.queryByText(/O-PRICE|Offer ends in/)).toBeNull();
    expect(mockGetOffer).not.toHaveBeenCalled();
  });

  it('from a pack too', async () => {
    mockParams = { from: 'pack' };
    await renderScreen(<PaywallScreen />);
    expect(await screen.findByText('Y-PRICE/yr')).toBeTruthy();
    expect(screen.queryByText(/O-PRICE/)).toBeNull();
  });
});

describe('gift analytics (MOB-24c, §3.9)', () => {
  it('14 viewed once and "Not now" dismissed; 15 "Not now" dismissed too', async () => {
    const rec = recordAnalytics();
    mockGetOffer.mockImplementation(unopened);
    await renderScreen(<GiftScreen />);
    await fireEvent.press(await screen.findByTestId('14-later'));
    expect(rec.captured).toEqual([
      { event: 'gift_offer_viewed', props: { offer_kind: 'day3' } },
      { event: 'gift_offer_dismissed', props: { offer_kind: 'day3' } },
    ]);
    screen.unmount();
    mockGetOffer.mockImplementation(() => opened(H));
    await renderScreen(<GiftOpenedScreen />);
    await fireEvent.press(await screen.findByTestId('15-later'));
    expect(rec.of('gift_offer_dismissed')).toHaveLength(2);
    expectOnlyAllowedKeys(rec.captured);
    rec.stop();
  });
});
