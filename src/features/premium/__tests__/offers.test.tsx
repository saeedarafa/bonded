import { dehydrate, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { offerRemainingMs, OFFER_WINDOW_MS } from '@/features/premium/offers';
import { resetPurchasesForTests } from '@/features/premium/purchases';
import GiftOpenedScreen from '@/features/premium/screens/GiftOpenedScreen';
import GiftScreen from '@/features/premium/screens/GiftScreen';
import PaywallScreen from '@/features/premium/screens/PaywallScreen';
import WinbackScreen from '@/features/premium/screens/WinbackScreen';
import { fakeOfferings, purchasesMock } from '@/test/purchases';
import { PERSIST_DEHYDRATE_OPTIONS } from '@/lib/queryClient';
import { renderUi } from '@/test/render';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
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
type Offer = { eligible: boolean; expiresAt: string | null };
const mockEntitlements = jest.fn();
const mockGetOffer = jest.fn<Promise<Offer>, [string]>();
const mockClocks = jest.fn<Promise<{ kind: string; expiresAt: string }[]>, []>();
jest.mock('@/features/premium/api', () => ({
  getEntitlements: () => mockEntitlements(),
  getOffer: (kind: string) => mockGetOffer(kind),
  getOfferClocks: () => mockClocks(),
}));

const H = 60 * 60 * 1000;
const NONE: Offer = { eligible: false, expiresAt: null };
let qc: QueryClient;
function renderScreen(ui: ReactElement) {
  return renderUi(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
/** "02:03:0x": the server clock, read to the minute (a second may tick during the test). */
const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}`;
};

beforeEach(() => {
  jest.clearAllMocks();
  resetPurchasesForTests();
  mockUserId = 'u1';
  mockCouple = PAIRED;
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = 'appl_test';
  purchasesMock.getOfferings.mockResolvedValue(fakeOfferings());
  purchasesMock.logIn.mockResolvedValue({ customerInfo: {}, created: false });
  purchasesMock.purchasePackage.mockReset();
  mockEntitlements.mockResolvedValue([]);
  mockGetOffer.mockReset();
  mockGetOffer.mockResolvedValue(NONE);
  mockClocks.mockReset();
  mockClocks.mockResolvedValue([]);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => qc.clear());
afterAll(() => {
  delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
});

describe('offerRemainingMs (server clock, skew-tolerant)', () => {
  const now = Date.parse('2026-11-05T12:00:00Z');
  it('counts down to the server expires_at', () => {
    expect(offerRemainingMs('2026-11-05T14:00:00Z', now)).toBe(2 * H);
  });
  it('never more than the 24-hour window (device clock behind), never below 0', () => {
    expect(offerRemainingMs('2026-11-07T12:00:00Z', now)).toBe(OFFER_WINDOW_MS);
    expect(offerRemainingMs('2026-11-05T11:00:00Z', now)).toBe(0);
    expect(offerRemainingMs(null, now)).toBe(0);
    expect(offerRemainingMs('nonsense', now)).toBe(0);
  });
});

describe('15 Gift opened', () => {
  it('eligible: the countdown runs to the server expires_at; trial and price from `intro`', async () => {
    const expiresAt = new Date(Date.now() + 2 * H + 3 * 60_000 + 30_000).toISOString();
    mockGetOffer.mockImplementation((kind) =>
      Promise.resolve(kind === 'intro' ? { eligible: true, expiresAt } : NONE),
    );
    await renderScreen(<GiftOpenedScreen />);
    expect(await screen.findByTestId('15-countdown')).toBeTruthy();
    expect(
      screen.getByText(new RegExp(`^Gift ends in ${clock(2 * H + 3 * 60_000)}:\\d\\d$`)),
    ).toBeTruthy();
    expect(await screen.findByText('7 days of Premium, free for you both')).toBeTruthy();
    expect(await screen.findByText('Then I-PRICE/year instead of Y-PRICE')).toBeTruthy();
    expect(screen.getByText('Start our free 7 days')).toBeTruthy();
    expect(mockGetOffer).toHaveBeenCalledWith('intro');

    purchasesMock.purchasePackage.mockResolvedValue({ customerInfo: {} });
    mockEntitlements.mockResolvedValue([{ user_id: 'u1', is_active: true, expires_at: null }]);
    await fireEvent.press(screen.getByTestId('15-claim'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/success'));
    // Bought from the `intro` offering's package.
    expect(purchasesMock.purchasePackage.mock.calls[0]?.[0].product.priceString).toBe('I-PRICE');
  });

  // The partner sees the same clock: both phones read the one server `expires_at`.
  const shared = Date.now() + 5 * H + 30_000;
  it.each(['u1', 'u2'])("the same clock on %s's phone", async (user) => {
    mockUserId = user;
    mockGetOffer.mockResolvedValue({ eligible: true, expiresAt: new Date(shared).toISOString() });
    await renderScreen(<GiftOpenedScreen />);
    await screen.findByTestId('15-countdown');
    expect(
      screen.getByText(new RegExp(`^Gift ends in ${clock(shared - Date.now())}:\\d\\d$`)),
    ).toBeTruthy();
  });

  it('expired or ineligible: "ended" and the usual paywall', async () => {
    mockGetOffer.mockResolvedValue({
      eligible: false,
      expiresAt: new Date(Date.now() - H).toISOString(),
    });
    await renderScreen(<GiftOpenedScreen />);
    expect(await screen.findByTestId('15-ended')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('15-paywall'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/paywall');
  });

  it('premium (the partner pays) suppresses the offer and never asks the server', async () => {
    mockEntitlements.mockResolvedValue([{ user_id: 'u2', is_active: true, expires_at: null }]);
    mockGetOffer.mockResolvedValue({
      eligible: true,
      expiresAt: new Date(Date.now() + H).toISOString(),
    });
    await renderScreen(<GiftOpenedScreen />);
    expect(await screen.findByTestId('15-ended')).toBeTruthy();
    expect(mockGetOffer).not.toHaveBeenCalled();
  });
});

describe('14 gift', () => {
  it('eligible: shows the gift; Open goes to 15', async () => {
    mockGetOffer.mockResolvedValue({
      eligible: true,
      expiresAt: new Date(Date.now() + H).toISOString(),
    });
    await renderScreen(<GiftScreen />);
    expect(await screen.findByText('You both earned a gift')).toBeTruthy();
    expect(await screen.findByText('New couples only. Sam sees the same gift.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('14-open'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/gift/opened');
  });

  it('not eligible: straight to Today', async () => {
    await renderScreen(<GiftScreen />);
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/today'));
  });
});

describe('paywall offering (D28): reads existing clocks, never starts one', () => {
  const at = (ms: number) => new Date(Date.now() + ms).toISOString();
  const noOfferCall = async () => {
    await waitFor(() => expect(mockClocks).toHaveBeenCalled());
    expect(mockGetOffer).not.toHaveBeenCalled();
  };
  // Whatever the state, opening a paywall never asks `get_offer` (that would start a clock).
  afterEach(() => expect(mockGetOffer).not.toHaveBeenCalled());

  it('no clock: `default`, no countdown, no get_offer call', async () => {
    // Even if the server would grant one, opening the paywall must not start a clock.
    mockGetOffer.mockResolvedValue({ eligible: true, expiresAt: at(H) });
    await renderScreen(<PaywallScreen />);
    expect(await screen.findByText('Y-PRICE/year')).toBeTruthy();
    expect(screen.queryByTestId('16-offer-countdown')).toBeNull();
    expect(screen.queryByText(/I-PRICE|W-PRICE/)).toBeNull();
    await noOfferCall();
  });

  it('an expired clock: `default`', async () => {
    mockClocks.mockResolvedValue([{ kind: 'intro', expiresAt: at(-H) }]);
    await renderScreen(<PaywallScreen />);
    expect(await screen.findByText('Y-PRICE/year')).toBeTruthy();
    expect(screen.queryByTestId('16-offer-countdown')).toBeNull();
    await noOfferCall();
  });

  it('a running intro clock: the `intro` offering with its countdown', async () => {
    mockClocks.mockResolvedValue([{ kind: 'intro', expiresAt: at(3 * H + 30_000) }]);
    await renderScreen(<PaywallScreen />);
    expect(await screen.findByText('I-PRICE/year')).toBeTruthy();
    expect(screen.getByTestId('16-offer-countdown')).toBeTruthy();
    expect(screen.getByText(new RegExp(`Ends in ${clock(3 * H)}`))).toBeTruthy();
    await noOfferCall();
  });

  it('win-back running wins over intro', async () => {
    mockClocks.mockResolvedValue([
      { kind: 'intro', expiresAt: at(2 * H) },
      { kind: 'winback', expiresAt: at(H) },
    ]);
    await renderScreen(<PaywallScreen />);
    expect(await screen.findByText('W-PRICE/year')).toBeTruthy();
    await noOfferCall();
  });

  it('a running clock but premium: `default`, the clocks are not even read', async () => {
    mockEntitlements.mockResolvedValue([{ user_id: 'u2', is_active: true, expires_at: null }]);
    mockClocks.mockResolvedValue([{ kind: 'intro', expiresAt: at(H) }]);
    await renderScreen(<PaywallScreen />);
    expect(await screen.findByTestId('16-premium')).toBeTruthy();
    expect(mockClocks).not.toHaveBeenCalled();
    expect(mockGetOffer).not.toHaveBeenCalled();
  });

  it('a running clock but RevenueCat has no such offering: `default`', async () => {
    purchasesMock.getOfferings.mockResolvedValue(fakeOfferings({ extra: false }));
    mockClocks.mockResolvedValue([{ kind: 'intro', expiresAt: at(H) }]);
    await renderScreen(<PaywallScreen />);
    expect(await screen.findByText('Y-PRICE/year')).toBeTruthy();
    expect(screen.queryByTestId('16-offer-countdown')).toBeNull();
    await noOfferCall();
  });

  it('a solo user (no partner yet): `default`, the clocks are not read', async () => {
    mockCouple = { id: 'couple-1', couple_members: [{ user_id: 'u1', left_at: null }] };
    mockGetOffer.mockResolvedValue({ eligible: true, expiresAt: at(H) });
    await renderScreen(<PaywallScreen />);
    expect(await screen.findByText('Y-PRICE/year')).toBeTruthy();
    expect(screen.queryByTestId('16-offer-countdown')).toBeNull();
    expect(mockClocks).not.toHaveBeenCalled();
  });

  it('the clocks cannot be read: `default`, still no get_offer fallback', async () => {
    mockClocks.mockRejectedValue({ code: 'NETWORK', message: 'offline' });
    await renderScreen(<PaywallScreen />);
    expect(await screen.findByText('Y-PRICE/year')).toBeTruthy();
    expect(screen.queryByTestId('16-offer-countdown')).toBeNull();
    await noOfferCall();
  });

  it('the clocks are never written to the on-disk cache', async () => {
    mockClocks.mockResolvedValue([{ kind: 'intro', expiresAt: at(H) }]);
    await renderScreen(<PaywallScreen />);
    expect(await screen.findByTestId('16-offer-countdown')).toBeTruthy();
    const keys = dehydrate(qc, PERSIST_DEHYDRATE_OPTIONS).queries.map((q) => q.queryKey);
    expect(keys).not.toContainEqual(['offer', 'clocks', 'couple-1']);
    expect(qc.getQueryData(['offer', 'clocks', 'couple-1'])).toHaveLength(1);
  });
});

describe('36 Win-back', () => {
  it('both prices from RevenueCat, the server countdown, no computed discount', async () => {
    mockGetOffer.mockImplementation((kind) =>
      Promise.resolve(
        kind === 'winback'
          ? { eligible: true, expiresAt: new Date(Date.now() + 4 * H + 30_000).toISOString() }
          : NONE,
      ),
    );
    await renderScreen(<WinbackScreen />);
    expect(await screen.findByTestId('36-countdown')).toBeTruthy();
    expect(screen.getByText(new RegExp(`Ends in ${clock(4 * H)}`))).toBeTruthy();
    expect(await screen.findByText('W-PRICE/year')).toBeTruthy();
    expect(await screen.findByText('Usual price Y-PRICE/year')).toBeTruthy();
    expect(screen.queryByText(/%/)).toBeNull();
    await fireEvent.press(screen.getByTestId('36-no'));
    expect(mockRouter.back).toHaveBeenCalled();
  });
});
